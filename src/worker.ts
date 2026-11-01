import {run,validateInput} from './core.ts';
import {loadPages,pageLinks} from './urls.ts';
import {OpenAIProvider} from './provider.ts';
interface Statement{bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;run():Promise<unknown>}
interface DB{prepare(sql:string):Statement}
interface Env{DB?:DB;ASSETS?:{fetch(request:Request):Promise<Response>}}
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
export async function api(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return null;
 if(request.method==='GET'&&url.pathname==='/api/health')return json({ok:true,vault:!!env.DB});
 if(request.headers.get('Origin')!==url.origin||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))return json({error:'同一サイトからのみ利用できます。'},403);
 try{
  if(url.pathname==='/api/run'&&request.method==='POST'){
   const auth=request.headers.get('Authorization')??'';if(!/^Bearer [\x21-\x7E]{15,300}$/.test(auth))return json({error:'設定でOpenAI APIキーを入力してください。'},401);
   const raw=await limitedBody(request,6500000);const input=validateInput(JSON.parse(raw));if(raw.length>180000&&!(input.images?.length||input.history.some(h=>h.images?.length)))throw Error('BODY_TOO_LARGE');
   if(pageLinks(input.question).length){
    if(!env.DB)return json({error:'URL取得の保護設定が未設定です。本文を貼り付けてください。'},503);
    const slot=parseInt((await digest(request.headers.get('CF-Connecting-IP')??'local')).slice(0,8),16)%4096;
    const minute=Math.floor(Date.now()/60000),day=Math.floor(Date.now()/86400000);
    if(!await takeBudget(env.DB,'url-global-minute',minute,60)||!await takeBudget(env.DB,`url-ip-minute-${slot}`,minute,10)||!await takeBudget(env.DB,'url-global-day',day,500)||!await takeBudget(env.DB,`url-ip-day-${slot}`,day,100))return json({error:'URL取得の利用上限に達しました。時間を置くか、本文を貼り付けてください。'},429);
   }
   const sources=await loadPages(input.question,request.signal,url.origin);
   const result=await run({...input,sources},new OpenAIProvider(auth.slice(7),request.signal));return json(result);
  }
  if(url.pathname==='/api/vault'&&['PUT','POST','DELETE'].includes(request.method)){
   if(!env.DB)return json({error:'D1保管庫が未設定です。端末保存とJSON書き出しを利用できます。'},503);
   const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';if(!/^[a-f0-9]{64}$/.test(token))return json({error:'保管庫の鍵が必要です。'},401);
   // The random 256-bit recovery capability authorizes only its own vault.
   // Fixed bucket slots bound abuse metadata; no IP address or API key is stored.
   const hash=await digest(token);
   const ip=request.headers.get('CF-Connecting-IP')??'local';
   const slot=parseInt((await digest(ip)).slice(0,8),16)%4096;
   const minute=Math.floor(Date.now()/60000),day=Math.floor(Date.now()/86400000);
   const rate=await takeBudget(env.DB,'global-minute',minute,600)&&await takeBudget(env.DB,`ip-minute-${slot}`,minute,60);
   if(!rate)return rateLimited();
   if(request.method==='PUT'){
    if(!await takeBudget(env.DB,`ip-write-${slot}`,minute,10)||!await takeBudget(env.DB,'global-write',minute,120))return rateLimited();
    const ciphertext=await limitedBody(request,1000000);const value=JSON.parse(ciphertext);
    if(typeof value.iv!=='string'||!value.iv.match(/^[A-Za-z0-9+/]{16}$/)||typeof value.data!=='string'||value.data.length<24||value.data.length>990000||value.data.length%4!==0||!value.data.match(/^[A-Za-z0-9+/]+={0,2}$/))throw Error('INVALID_VAULT');
    const existing=await env.DB.prepare('SELECT id FROM vaults WHERE id=?').bind(hash).first<{id:string}>();
    if(!existing&&(!await takeBudget(env.DB,`ip-create-${slot}`,day,5)||!await takeBudget(env.DB,'global-create',day,100)))return rateLimited();
    // Admission and upsert are ONE serialized SQL statement: concurrent writes
    // cannot bypass the 500-vault / 100 MiB total ciphertext limits.
    const saved=await env.DB.prepare(`INSERT INTO vaults (id, ciphertext, updated_at)
      SELECT ?, ?, ? WHERE
      ((SELECT COUNT(*) FROM vaults)<500 OR EXISTS(SELECT 1 FROM vaults WHERE id=?))
      AND (SELECT COALESCE(SUM(length(CAST(ciphertext AS BLOB))),0) FROM vaults)
       -COALESCE((SELECT length(CAST(ciphertext AS BLOB)) FROM vaults WHERE id=?),0)+?<=104857600
      ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at
      RETURNING id`).bind(hash,ciphertext,new Date().toISOString(),hash,hash,new TextEncoder().encode(ciphertext).byteLength).first<{id:string}>();
    return saved?json({ok:true}):json({error:'保管庫の保存容量上限に達しました。端末保存・JSON書き出しを利用してください。'},507);
   }
   if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM vaults WHERE id=?').bind(hash).run();return json({ok:true});}
   const found=await env.DB.prepare('SELECT ciphertext FROM vaults WHERE id=?').bind(hash).first<{ciphertext:string}>();return found?new Response(found.ciphertext,{headers:{...headers,'Content-Type':'application/json'}}):json({error:'保管庫が見つかりません。'},404);
  }
  return json({error:'Not found'},404);
 }catch(e){
  const code=e instanceof SyntaxError?'INVALID_JSON':e instanceof Error?e.message:'';
  const errors:Record<string,string>={INVALID_IMAGES:'画像の形式・サイズ・枚数が不正です。PNG・JPEG・WebPを1回3枚まで添付してください。',API_AUTH:'OpenAIがAPIキーを認証できませんでした。設定でキーを確認してください。',API_NETWORK:'サーバーからOpenAIへの通信に失敗しました。少し待って再試行してください。',API_TIMEOUT:'OpenAIの応答待ちが時間切れ、または中断されました。',API_MODEL:'指定されたモデルが見つからないか、このAPIキーでは利用できません。設定でモデル名を確認してください。',API_PERMISSION:'OpenAIがアクセスを拒否しました。APIキーの権限・プロジェクト設定・接続地域を確認してください。',API_REQUEST:'OpenAIがリクエストを受け付けませんでした。モデルがResponses API・Structured Outputsに対応し、画像添付時は画像入力にも対応しているか確認してください。',API_QUOTA:'OpenAI APIの残高または利用上限に達しました。API側の請求・上限設定を確認してください。',API_FAILURE:'OpenAIから正常な応答を受け取れませんでした。少し待って再試行してください。',API_RATE_LIMIT:'OpenAIの利用上限またはレート制限に達しました。',API_REFUSAL:'この質問への回答は生成されませんでした。',API_INCOMPLETE:'回答が出力上限に達しました。質問を短くして再試行してください。'};
  return json({code:errors[code]?code:'REQUEST_FAILURE',error:errors[code]??(code.startsWith('INVALID')||code==='BODY_TOO_LARGE'?'入力の形式またはサイズが不正です。':'処理を完了できませんでした。通信・モデル名・API利用権限を確認してください。')},code.startsWith('INVALID')||code==='BODY_TOO_LARGE'?400:502);
 }
}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function takeBudget(db:DB,id:string,window:number,limit:number){
 const result=await db.prepare(`INSERT INTO abuse_buckets (id, window, hits) VALUES (?, ?, 1)
 ON CONFLICT(id) DO UPDATE SET window=excluded.window,
 hits=CASE WHEN abuse_buckets.window=excluded.window THEN abuse_buckets.hits+1 ELSE 1 END
 WHERE abuse_buckets.window!=excluded.window OR abuse_buckets.hits<? RETURNING hits`).bind(id,window,limit).first<{hits:number}>();
 return !!result;
}
function rateLimited(){return new Response(JSON.stringify({error:'保管庫の利用回数上限に達しました。時間を置いて再試行してください。'}),{status:429,headers:{...headers,'Content-Type':'application/json','Retry-After':'60'}});}
async function limitedBody(request:Request,max:number){if(Number(request.headers.get('Content-Length'))>max)throw Error('BODY_TOO_LARGE');const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');let size=0;const parts:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('BODY_TOO_LARGE');}parts.push(value);}const all=new Uint8Array(size);let i=0;for(const p of parts){all.set(p,i);i+=p.length;}return new TextDecoder().decode(all);}
export default {async fetch(request:Request,env:Env){const response=await api(request,env);if(response)return response;return serveAsset(request,env);}};
// The build replaces this function with embedded, same-origin static assets.
function serveAsset(_request:Request,_env:Env):Promise<Response>|Response{return new Response('Build required',{status:503});}
