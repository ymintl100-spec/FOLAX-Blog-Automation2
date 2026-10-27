'use strict';
// FOLAX content is source material, not a publication approval.
const BRAND=/(?:^|[^a-z0-9])folax(?=[^a-z0-9]|$)|포렉스/i;
const PRODUCT=/(하이\s*볼륨|아치서포트\s*프로|뉴\s*아치\s*서포트|밸런스\s*(?:텝|스텝|링|팟)|슬림업|아치업\s*풋롤러|솔리드\s*젤|발에\s*휴식|풋락커)/i;
const MAX=500000;
function flatten(x,level=0){
  if(level>5||x==null)return '';
  if(typeof x==='string')return x.slice(0,MAX);
  if(Array.isArray(x))return x.slice(0,80).map(v=>flatten(v,level+1)).join('\n').slice(0,MAX);
  if(typeof x==='object')return ['title','article','body','content','html','text','topic','keyword','description','summary','tags','caption','alt','path','src','url','file','fileName','filename','prompt','images','bodyImages','titleImagePath','titleImageText','titleImagePrompt','brandAssetRefs'].map(k=>flatten(x[k],level+1)).join('\n').slice(0,MAX);
  return '';
}
function reviewDraft(draft){
  if(!draft||typeof draft!=='object')return {allow:false,status:'INVALID_DRAFT',reason:'원고 객체 없음'};
  const text=flatten(draft);
  const matchedBrand=BRAND.test(text),matchedProduct=PRODUCT.test(text);
  const assets=Array.isArray(draft.brandAssetRefs)&&draft.brandAssetRefs.length>0;
  if(matchedBrand||matchedProduct||assets)return {allow:false,status:'FOLAX_REVIEW_REQUIRED',
   detected:matchedBrand?'brand':matchedProduct?'product_name':'brand_asset',
   reason:'포렉스 제품 근거·현행 SKU·시험·이미지 권리·최종 승인기록을 확인하지 못하여 자동 외부발행을 차단합니다.',
   approval:false};
  return {allow:true,status:'NOT_FOLAX_DETECTED',approval:false,
   reason:'포렉스 전용 심사 대상이 감지되지 않았습니다. 일반 게시물의 적법성이나 사실성 승인은 아닙니다.'};
}
function assertFolaxPublishable(draft){const status=reviewDraft(draft);if(!status.allow){const error=new Error(status.reason);error.code=status.status;error.folaxReview=status;throw error;}return status;}
module.exports={reviewDraft,assertFolaxPublishable};
