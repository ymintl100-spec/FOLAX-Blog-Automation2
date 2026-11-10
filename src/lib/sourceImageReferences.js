'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),dns=require('node:dns').promises,net=require('node:net');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const decode=s=>String(s||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
function imageUrl(value,base){if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(decode(value),base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';u.hash='';return u.href;}catch{return '';}}
function extract(html,base){
  html=String(html||'');const root=html.match(/<div\b[^>]*(?:class=["'][^"']*\bse-main-container\b[^"']*["']|id=["']postViewArea["'])[^>]*>/i);
  let article='';if(root){const tail=html.slice(root.index);let depth=0;for(const tag of tail.matchAll(/<\/?div\b[^>]*>/gi)){depth+=/^<\//.test(tag[0])?-1:1;if(depth===0){article=tail.slice(0,tag.index+tag[0].length);break;}}}
  const body=article||html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]||html;
  const found=[],seen=new Set();
  const add=(value,alt='')=>{const url=imageUrl(value,base);if(!url)return;const key=new URL(url);key.searchParams.delete('type');if(seen.has(key.href))return;seen.add(key.href);found.push({url,alt:decode(alt).replace(/<[^>]*>/g,'').slice(0,160)});};
  for(const match of body.matchAll(/<img\b[^>]*>/gi)){
    const attrs={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4];
    if(/avatar|profile|emoji|sticker|icon|tracking/i.test((attrs.class||'')+' '+(attrs.id||'')))continue;
    if(['width','height'].some(k=>/^\d+$/.test(attrs[k]||'')&&+attrs[k]<150))continue;
    add(attrs['data-original']||attrs['data-lazy-src']||attrs['data-src']||attrs.src,attrs.alt);
    if(found.length>=12)break;
  }
  if(!found.length)for(const m of html.matchAll(/<meta\b[^>]*>/gi)){
    const tag=m[0];if(!/(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag))continue;
    add(tag.match(/content=["']([^"']+)["']/i)?.[1]);
  }
  return found.slice(0,12);
}
function publicAddress(ip){
  if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);}
  if(net.isIP(ip)===6){if(/^::ffff:/i.test(ip))return publicAddress(ip.slice(7));return !/^(?:::|fc|fd|fe[89ab]|ff)/i.test(ip);}
  return false;
}
async function fetchImage(url,{referer='',redirects=0}={}){
  if(redirects>3)throw Error('참고 이미지 리디렉션 한도 초과');
  const safe=imageUrl(url);if(!safe)throw Error('공개 HTTP 이미지 주소가 아닙니다.');const u=new URL(safe),host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await dns.lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('공개 이미지 주소가 아닙니다.');
  return new Promise((resolve,reject)=>{
    const req=require(u.protocol==='https:'?'node:https':'node:http').get(u,{headers:{'User-Agent':'Mozilla/5.0',...(referer?{Referer:referer}:{})},lookup:(_host,opts,cb)=>opts?.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();fetchImage(new URL(res.headers.location,u).href,{referer,redirects:redirects+1}).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();reject(Error('참고 이미지 HTTP '+res.statusCode));return;}
      if(!/^image\/(?:png|jpe?g|webp)(?:;|$)/i.test(res.headers['content-type']||'')){res.resume();reject(Error('지원하지 않는 참고 이미지 형식'));return;}
      let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>6*1024*1024)res.destroy(Error('참고 이미지 6MB 제한'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)));
    });req.setTimeout(12000,()=>req.destroy(Error('참고 이미지 요청 시간 초과')));req.on('error',reject);
  });
}
async function normalizeImage(data){
  const png=data.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpeg=data[0]===255&&data[1]===216,webp=data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
  if(!png&&!jpeg&&!webp)throw Error('참고 이미지 파일 형식이 일치하지 않습니다.');
  let width=0,height=0;
  if(png&&data.length>=24){width=data.readUInt32BE(16);height=data.readUInt32BE(20);}
  if(webp&&data.length>=30){const kind=data.subarray(12,16).toString();if(kind==='VP8X'){width=data.readUIntLE(24,3)+1;height=data.readUIntLE(27,3)+1;}else if(kind==='VP8 '){width=data.readUInt16LE(26)&16383;height=data.readUInt16LE(28)&16383;}else if(kind==='VP8L'){const bits=data.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}}
  if(jpeg)for(let at=2;at+9<data.length;){if(data[at++]!==255)continue;while(data[at]===255)at++;const marker=data[at++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;const size=data.readUInt16BE(at);if(size<2||at+size>data.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=data.readUInt16BE(at+3);width=data.readUInt16BE(at+5);break;}at+=size;}
  if(!width||!height||width<150||height<150||width*height>20000000)throw Error('참고 이미지 크기를 확인할 수 없습니다.');
  const {loadImage,createCanvas}=require('@napi-rs/canvas'),image=await loadImage(data);
  if(image.width<150||image.height<150||image.width*image.height>20000000)throw Error('참고 이미지 크기를 확인할 수 없습니다.');
  const scale=Math.min(1,1280/Math.max(image.width,image.height)),canvas=createCanvas(Math.round(image.width*scale),Math.round(image.height*scale)),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toBuffer('image/jpeg',85);
}
async function prepare(options,{download=fetchImage,normalize=normalizeImage,log=()=>{}}={}){
  const urls=options.inputBrief?.urls||[];if(!urls.length)return [];
  const dir=path.join(options.jobDir,'source-image-references');fs.mkdirSync(dir,{recursive:true});
  const refs=[];
  for(const saved of options.sourceImageReferences||[]){
    if(refs.length>=6)break;
    if(!urls.includes(saved.sourceUrl)||!saved.path||!/[a-f0-9]{64}/.test(saved.sha256||'')||path.basename(saved.path)!=='reference-'+saved.sha256.slice(0,20)+'.jpg'||path.basename(path.dirname(saved.path))!=='source-image-references'||!fs.existsSync(saved.path)||fs.statSync(saved.path).size>3*1024*1024)continue;
    const data=fs.readFileSync(saved.path);if(hash(data)!==saved.sha256)continue;
    const file=path.join(dir,path.basename(saved.path));if(path.resolve(file)!==path.resolve(saved.path))fs.copyFileSync(saved.path,file);
    refs.push({...saved,path:file});
  }
  for(const sourceUrl of urls){
    if(refs.some(r=>r.sourceUrl===sourceUrl))continue;
    let source=(options.searchResults||[]).find(s=>s.inputKind==='link'&&s.inputValue===sourceUrl&&Array.isArray(s.imageCandidates));
    if(!source&&typeof options.readInputLink==='function')try{source=await options.readInputLink(sourceUrl);}catch(e){log('링크 이미지 확인 실패 · '+e.message,'warn');}
    let accepted=0;
    for(const candidate of (source?.imageCandidates||[]).slice(0,6)){
      if(refs.length>=6||accepted>=Math.max(2,Math.floor(6/urls.length)))break;
      try{const data=await normalize(await download(candidate.url,{referer:new URL(sourceUrl).origin+'/'}));const sha256=hash(data);if(refs.some(r=>r.sha256===sha256))continue;
        const file=path.join(dir,'reference-'+sha256.slice(0,20)+'.jpg');fs.writeFileSync(file,data);refs.push({sourceUrl,url:candidate.url,alt:candidate.alt||'',path:file,sha256});accepted++;
      }catch(e){log('링크 참고 이미지 제외 · '+e.message,'warn');}
    }
    if(!refs.some(r=>r.sourceUrl===sourceUrl))log('참고 가능한 링크 이미지가 없어 본문 설명으로 이미지를 생성합니다.','warn');
  }
  if(refs.length)log('링크 원본 이미지 '+refs.length+'장 참고 준비 · 이미지 생성기에 첨부합니다.');
  return refs;
}
function attachments(options,agent){return agent==='image'?(options.sourceImageReferences||[]).filter(r=>r.path&&fs.existsSync(r.path)).slice(0,6).map(r=>r.path):[];}
function reusedReference(result,options){
  const refs=options.sourceImageReferences||[];if(!refs.length)return '';const signatures=new Set(refs.map(r=>r.sha256));
  for(const file of [result?.titleImagePath,...(result?.bodyImages||[]).map(i=>i.path)].filter(Boolean)){
    const actual=path.resolve(options.jobDir||'.',file);if(!fs.existsSync(actual))continue;
    if(refs.some(r=>path.resolve(r.path)===actual)||fs.statSync(actual).size<=3*1024*1024&&signatures.has(hash(fs.readFileSync(actual))))return '링크 원본 참고 이미지를 생성 결과로 재사용할 수 없습니다. 새로 생성한 이미지가 필요합니다.';
  }
  return '';
}
module.exports={extract,prepare,attachments,reusedReference,fetchImage,normalizeImage,publicAddress};
