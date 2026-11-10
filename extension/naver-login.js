// Only read-only login landing pages may be returned to the requested editor.
// Never navigate away from an editor, an authentication challenge or another site.
function naverTargetEditorUrl(value,blogId) {
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&u.hostname==='blog.naver.com'
      &&(u.pathname===`/${blogId}/postwrite`||/^\/PostWriteForm\.naver$/i.test(u.pathname)&&u.searchParams.get('blogId')===blogId);
  } catch { return false; }
}
function naverLoginReturnUrl(value,blogId) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(blogId||''))return '';
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.port||u.username||u.password)return '';
    const target=`https://blog.naver.com/${encodeURIComponent(blogId)}/postwrite`;
    if(u.hostname==='www.naver.com')return /^\/(?:index\.html)?$/.test(u.pathname)?target:'';
    if(!['blog.naver.com','m.blog.naver.com'].includes(u.hostname))return '';
    const identity=u.searchParams.get('blogId');if(identity&&identity!==blogId)return '';
    const own=u.pathname.split('/')[1]===blogId;
    if((own&&new RegExp('^/'+blogId+'/\\d*/?$').test(u.pathname))||u.pathname===`/${blogId}`)return target;
    if(/^\/(?:MyBlog|PostList|PostView)\.naver$/i.test(u.pathname)&&(identity===blogId||u.pathname==='/MyBlog.naver'))return target;
    return u.pathname==='/'?target:'';
  } catch { return ''; }
}
if(typeof module!=='undefined')module.exports={naverTargetEditorUrl,naverLoginReturnUrl};
