export type PageSource={url:string;finalUrl:string;title:string;text:string;status:'ok'|'error';error:string;truncated:boolean};
export function publicPageUrl(value:string,ownOrigin?:string):URL{
 const u=new URL(value);if(u.protocol==='http:')u.protocol='https:';
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.href.length>2048||!h.includes('.')||!/^[a-z0-9.-]+$/.test(h)||/^\d[\d.]*$/.test(h)||h.endsWith('.')||/(^|\.)(localhost|local|internal|intranet|lan|home|test|invalid|example|onion)$/.test(h)||h==='metadata.google.internal'||(ownOrigin&&u.origin===ownOrigin))throw Error('URL_BLOCKED');
 u.hash='';return u;
}
export function pageLinks(question:string):string[]{
 const links=(question.match(/https?:\/\/[^\s<>"'`]+/gu)??[]).map(s=>{
  let clean=s.replace(/[\]}>、。，！？「」『』）］｝＞,.;]+$/gu,'');
  while(clean.endsWith(')')&&(clean.match(/\)/g)?.length??0)>(clean.match(/\(/g)?.length??0))clean=clean.slice(0,-1);
  return clean;
 });return [...new Set(links)].slice(0,3);
}
export function publicAddress(ip:string):boolean{
 if(ip.includes(':')){const v=ip.toLowerCase();return /^[0-9a-f:]+$/.test(v)&&/^[23][0-9a-f]{3}:/.test(v)&&!v.startsWith('2001:db8:')&&!(v.startsWith('2001:')&&parseInt(v.split(':')[1]||'0',16)<0x200)&&!v.startsWith('2002:')&&!v.startsWith('3ffe:')&&!v.startsWith('3fff:');}
 const a=ip.split('.').map(Number);if(a.length!==4||a.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [x,y,z]=a;return !(x===0||x===10||x===127||x>=224||(x===100&&y>=64&&y<=127)||(x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&(y===168||y===0||y===2))||(x===198&&(y===18||y===19||(y===51&&z===100)))||(x===203&&y===0&&z===113));
}
async function pageBody(res:Response,max:number):Promise<string>{
 if(Number(res.headers.get('Content-Length'))>max)throw Error('URL_TOO_LARGE');
 const reader=res.body?.getReader();if(!reader)throw Error('URL_EMPTY');const parts:Uint8Array[]=[];let n=0;
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>max){await reader.cancel();throw Error('URL_TOO_LARGE');}parts.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const charset=res.headers.get('Content-Type')?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]??'utf-8';
 try{return new TextDecoder(charset).decode(bytes);}catch{return new TextDecoder().decode(bytes);}
}
export async function checkPageDns(host:string,signal:AbortSignal,transport:typeof fetch){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
 const res=await transport('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{Accept:'application/dns-json'},signal,redirect:'manual',credentials:'omit'});
 if(!res.ok)throw Error('URL_DNS');const result=JSON.parse(await pageBody(res,16000)) as {Status?:number;Answer?:{type:number;data:string}[]};if(result.Status!==0)throw Error('URL_DNS');return result.Answer??[];
 }));
 const ips=answers.flat().filter(a=>a.type===1||a.type===28).map(a=>a.data);if(!ips.length||ips.some(ip=>!publicAddress(ip)))throw Error('URL_BLOCKED');
}
interface PageText{ text:string }
interface PageElement{onEndTag(callback:()=>void):void}
interface PageRewriter{on(selector:string,handler:{element?:(e:PageElement)=>void;text?:(t:PageText)=>void}):PageRewriter;onDocument(handler:{text(t:PageText):void}):PageRewriter;transform(res:Response):Response}
export async function extractPageHtml(html:string):Promise<{title:string;text:string}>{
 const C=(globalThis as unknown as {HTMLRewriter:new()=>PageRewriter}).HTMLRewriter;
 let hidden=0,n=0,title='';const parts:string[]=[];
 const rewriter=new C().on('head,script,style,noscript,template,svg,canvas,nav,header,footer,form',{element(e){hidden++;e.onEndTag(()=>{hidden--;});}})
 .on('p,div,section,article,main,h1,h2,h3,h4,h5,h6,li,br',{element(){if(!hidden&&n<24000){parts.push('\n');n++;}}})
 .on('title',{text(t){if(title.length<300)title+=t.text.slice(0,300-title.length);}})
 .onDocument({text(t){if(!hidden&&n<24000){const s=t.text.slice(0,24000-n);parts.push(s);n+=s.length;}}});
 await rewriter.transform(new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}})).text();
 return {title:title.replace(/\s+/g,' ').trim(),text:parts.join('').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim()};
}
const pageErrors:Record<string,string>={URL_BLOCKED:'このURLは安全上の理由で取得できません。公開HTTPSページを指定してください。',URL_DNS:'URLの接続先を確認できませんでした。',URL_TOO_LARGE:'ページが大きすぎるため取得できません（1MBまで）。',URL_TYPE:'この形式の本文取得には対応していません。HTML・テキストの公開ページを指定してください。',URL_EMPTY:'本文を取得できませんでした。JavaScript描画・ログインが必要なページは本文を貼り付けてください。',URL_REDIRECT:'転送が多すぎるため取得できませんでした。'};
export async function loadPage(value:string,signal:AbortSignal,ownOrigin?:string,transport:typeof fetch=fetch):Promise<PageSource>{
 const source:PageSource={url:value.slice(0,2048),finalUrl:'',title:'',text:'',status:'error',error:'',truncated:false};
 try{
 const combined=AbortSignal.any([signal,AbortSignal.timeout(12000)]);let u=publicPageUrl(value,ownOrigin);
 for(let hop=0;hop<4;hop++){
 await checkPageDns(u.hostname,combined,transport);
 const res=await transport(u.href,{method:'GET',redirect:'manual',credentials:'omit',signal:combined,headers:{Accept:'text/html, text/plain;q=0.9','User-Agent':'MIRROR/0.3.3 (+public-page-reader)'}});
 if(res.status>=300&&res.status<400){const target=res.headers.get('Location');await res.body?.cancel();if(!target)throw Error('URL_REDIRECT');u=publicPageUrl(new URL(target,u).href,ownOrigin);continue;}
 if(!res.ok){await res.body?.cancel();throw Error('URL_HTTP_'+res.status);}
 const type=res.headers.get('Content-Type')?.toLowerCase()??'';if(!type.includes('text/html')&&!type.includes('text/plain')){await res.body?.cancel();throw Error('URL_TYPE');}
 const raw=await pageBody(res,1000000);const parsed=type.includes('text/html')?await extractPageHtml(raw):{title:u.hostname,text:raw.trim()};
 if((parsed.text.length<300&&/enable javascript|javascript.*required|sign in|log in|ログイン|verify you are human|checking your browser/i.test(parsed.text))||/just a moment|access denied|verify you are human/i.test(parsed.title))throw Error('URL_EMPTY');
 if(parsed.text.length<80)throw Error('URL_EMPTY');source.finalUrl=u.href;source.title=parsed.title||u.hostname;source.truncated=parsed.text.length>12000;source.text=parsed.text.slice(0,12000);source.status='ok';return source;
 }
 throw Error('URL_REDIRECT');
 }catch(e){const code=e instanceof Error?e.message:'';source.error=pageErrors[code]??(code.startsWith('URL_HTTP_')?'ページ側が取得を許可しませんでした（HTTP '+code.slice(9)+'）。':signal.aborted?'ページの取得を中断しました。':'ページを取得できませんでした。通信制限・タイムアウトの可能性があります。');return source;}
}
export async function loadPages(question:string,signal:AbortSignal,ownOrigin?:string):Promise<PageSource[]>{return Promise.all(pageLinks(question).map(url=>loadPage(url,signal,ownOrigin)));}
