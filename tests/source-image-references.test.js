'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../src/lib/sourceImageReferences');
test('extracts article images and lazy originals, excluding navigation, duplicates and unsafe URLs',()=>{
 const html='<img src="https://example.com/nav.jpg"><div class="se-main-container"><div><img class="se-image-resource" src="https://img.example.com/product.jpg?type=w2" data-src="https://img.example.com/product.jpg?type=w800&amp;x=1" alt="제품 &amp; 사용법"></div><img src="https://img.example.com/product.jpg?type=w2&amp;x=1"><img src="javascript:alert(1)"><img><img class="profile" src="/profile.jpg"><img width="1" src="/pixel.png"><img src="/steps.webp"></div><img src="https://example.com/footer.jpg">';
 const refs=R.extract(html,'https://blog.example.com/article');assert.equal(refs.length,2);assert.equal(refs[0].url,'https://img.example.com/product.jpg?type=w800&x=1');assert.equal(refs[0].alt,'제품 & 사용법');assert.equal(refs[1].url,'https://blog.example.com/steps.webp');
 assert.deepEqual(R.extract('<meta property="og:image" content="https://img.example.com/cover.jpg">','https://example.com'),[{url:'https://img.example.com/cover.jpg',alt:''}]);
});
test('reference downloads are bounded, deduplicated, cached on resume and never counted as generated images',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-source-images-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sourceUrl='https://blog.example.com/post',logs=[],calls=[],options={jobDir:path.join(root,'job1'),inputBrief:{urls:[sourceUrl]},searchResults:[{inputKind:'link',inputValue:sourceUrl,imageCandidates:Array.from({length:10},(_,i)=>({url:'https://img.example.com/'+i+'.jpg',alt:'상품 '+i}))}]};
 const deps={download:async(url,opts)=>{calls.push({url,...opts});return Buffer.from(url);},normalize:async b=>b,log:m=>logs.push(m)};
 const refs=await R.prepare(options,deps);assert.equal(refs.length,6);assert.equal(calls.length,6);assert(calls.every(c=>c.referer==='https://blog.example.com/'));assert(logs.some(s=>s.includes('6장')));
 assert.equal(R.attachments({sourceImageReferences:refs},'writer').length,0);assert.equal(R.attachments({sourceImageReferences:refs},'image').length,6);
 const resumed=await R.prepare({...options,jobDir:path.join(root,'job2'),sourceImageReferences:refs},deps);assert.equal(calls.length,6);assert.equal(resumed.length,6);assert(resumed.every(r=>r.path.includes('job2')));assert(refs.every(r=>fs.existsSync(r.path)));
 const copied=path.join(root,'copied-source.jpg');fs.copyFileSync(refs[0].path,copied);assert.match(R.reusedReference({titleImagePath:copied},{sourceImageReferences:refs}),/재사용/);
 const pending=require('../src/lib/codexRunner')._private.pendingImageWriterResult({title:'제목',article:'본문',titleImagePrompt:'새 대표 이미지',bodyImages:[{sequence:1,sectionHeading:'활용',prompt:'새 본문 이미지'}]},{titleImagePath:refs[0].path,titleImageVerified:true,bodyImages:[{sequence:1,sectionHeading:'활용',path:refs[1].path,summaryVerified:true}]},{sourceImageReferences:refs,includeTitleImage:true,maxBodyImages:1});assert.equal(pending.titleImagePrompt,'새 대표 이미지');assert.deepEqual(pending.bodyImages.map(i=>i.sequence),[1]);
 assert.equal(R.reusedReference({titleImagePath:'fresh-generated.jpg'},{sourceImageReferences:refs}), '');
});
test('one failed image or unreadable link never stops reference preparation; keyword-only jobs fetch no images',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-source-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sourceUrl='https://blog.example.com/post';let reads=0;
 const options={jobDir:root,inputBrief:{urls:[sourceUrl]},searchResults:[],readInputLink:async()=>{reads++;return {imageCandidates:[{url:'https://img.example.com/bad.jpg'},{url:'https://img.example.com/good.jpg'}]};}};
 const result=await R.prepare(options,{download:async u=>{if(u.includes('bad'))throw Error('HTTP 403');return Buffer.from('image');},normalize:async b=>b});assert.equal(result.length,1);assert.equal(reads,1);
 assert.deepEqual(await R.prepare({...options,inputBrief:{urls:[]}}, {download:()=>{throw Error('not allowed');}}),[]);
 assert.deepEqual(await R.prepare({...options,sourceImageReferences:[],readInputLink:async()=>{throw Error('link unreadable');}}),[]);
});
test('image fetch rejects local destinations and non-image content before accepting references',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','100.100.100.200','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(R.publicAddress(ip),false,ip);
 assert.equal(R.publicAddress('8.8.8.8'),true);assert.equal(R.publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(()=>R.fetchImage('http://127.0.0.1/private'),/공개 이미지/);
 await assert.rejects(()=>R.fetchImage('file:///private'),/HTTP/);
 await assert.rejects(()=>R.normalizeImage(Buffer.from('<svg><script>bad</script></svg>')),/형식/);
 const oversized=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(oversized);oversized.writeUInt32BE(20000,16);oversized.writeUInt32BE(20000,20);await assert.rejects(()=>R.normalizeImage(oversized),/크기/);
});
test('normalizes real raster bytes for bounded visual input and the image worker receives reference paths',async t=>{
 const {createCanvas}=require('@napi-rs/canvas'),canvas=createCanvas(1600,900),ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,1600,900);
 const bytes=await R.normalizeImage(canvas.toBuffer('image/png'));assert.equal(bytes.subarray(0,2).toString('hex'),'ffd8');assert(bytes.length<100000);
 const prompt=require('../src/lib/codexRunner')._private.buildImageWorkerPrompt({jobDir:os.tmpdir(),runtimeRoot:os.tmpdir(),sourceImageReferences:[{path:'/tmp/reference.jpg',sourceUrl:'https://example.com',alt:'제품 구조'}],writerResult:{title:'제목',article:'제품 설명',titleImagePrompt:'product'}});
 assert(prompt.includes('Inspect them before generation'));assert(prompt.includes('reference-image input'));assert(prompt.includes('/tmp/reference.jpg'));assert(prompt.includes('preserve the supported product shape'));assert(prompt.includes('distinct'));
});
test('default request contains the complete user template and leaves room for extra instructions',()=>{
 const value=require('../src/lib/defaultWritingRequest');assert(value.length<1600);for(const section of ['1. 입력 내용 반영','2. 정확하고 충분한 설명','3. 약 2,000자 구성','4. 읽기 쉬운 편집'])assert(value.includes(section));assert(value.includes('글자수만을 이유로 작업을 중단하지 마세요.'));
});
