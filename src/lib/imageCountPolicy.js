const {normalizeMaxBodyImages}=require('./settings');
function minimum(options={}){return options.minimumImageCount===4?4:0;}
function bodyMinimum(options={}){return Math.max(0,minimum(options)-(options.includeTitleImage!==false?1:0));}
function forNewJob(options={}){
  const limit=normalizeMaxBodyImages(options.maxBodyImages);
  const enabled=options.includeTitleImage!==false || limit>0;
  const minimumImageCount=enabled?4:0;
  return {minimumImageCount,maxBodyImages:enabled?Math.max(limit,4-(options.includeTitleImage!==false?1:0)):0};
}
function instruction(options={}){
  if(!minimum(options))return '';
  return `이미지 수 필수: 총 최소 4장. ${options.includeTitleImage!==false?'대표 이미지 1장과 본문 최소 3장':'대표 이미지는 사용하지 않고 본문 최소 4장'}을 계획·생성한다. 1,000~1,200자 본문 분량은 유지하고 이미지 장수 때문에 소제목이나 글자수를 늘리지 않는다. 같은 소제목 안에서도 서로 다른 설명·관계·동작·비교에 각기 다른 이미지와 sequence를 배치한다. 소제목 없는 글은 sectionHeading을 본문으로 쓴다. 장수 부족을 짧은 분량이나 imageOmissions로 허용하지 않는다. 같은 파일 반복 사용으로 장수를 채우지 않는다. 이미지는 실제 본문·근거·제공된 경험만 시각화하며 새 사실·개인 경험을 만들지 않는다.`;
}
module.exports={minimum,bodyMinimum,forNewJob,instruction};
