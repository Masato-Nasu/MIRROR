import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {publicPageUrl,publicAddress,pageLinks,loadPage} from '../src/urls.ts';
import {run,validateInput} from '../src/core.ts';
test('Reader blocks private, numeric, credential, special-port and own-origin targets',()=>{
 for(const value of ['file:///etc/passwd','https://127.0.0.1','https://2130706433','https://0x7f000001','https://[::1]','https://localhost','https://a.local','https://a.internal','https://a.example','https://u:p@reader.example.org','https://reader.example.org:8443','https://reader.example.org.','https://mirror.test'])assert.throws(()=>publicPageUrl(value,'https://mirror.test'));
 assert.equal(publicPageUrl('http://reader.example.org/a#section').href,'https://reader.example.org/a');
 for(const value of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.16.1.1','192.168.1.1','192.0.2.1','198.19.1.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','fc00::1','fe80::1','2001:db8::1','2001:20::1','2002:7f00:1::','3fff::1'])assert.equal(publicAddress(value),false,value);
 assert.equal(publicAddress('93.184.216.34'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('Reader extracts at most three explicit unique links and removes surrounding punctuation',()=>{
 assert.deepEqual(pageLinks('読む https://one.example.org/a）。 https://one.example.org/a https://two.example.org/b https://three.example.org https://four.example.org'),['https://one.example.org/a','https://two.example.org/b','https://three.example.org']);
});
const signal=new AbortController().signal;
const dns=()=>Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
test('Reader fetches text without any OpenAI key or cookies, marks bounded excerpts',async()=>{
 const requests=[];const p=await loadPage('https://reader.example.org',signal,undefined,async(url,init)=>{requests.push({url,init});return url.startsWith('https://cloudflare-dns.com')?dns():new Response('Public content '.repeat(1200),{headers:{'Content-Type':'text/plain'}});});
 assert.equal(p.status,'ok');assert.equal(p.text.length,12000);assert.equal(p.truncated,true);
 for(const {init} of requests){assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).has('Authorization'),false);assert.equal(new Headers(init.headers).has('Cookie'),false);}
});
test('Reader refuses unsafe DNS and redirect targets before making the dangerous request',async()=>{
 let pageCalls=0;const badDns=await loadPage('https://reader.example.org',signal,undefined,async(url)=>{if(url.startsWith('https://cloudflare-dns.com'))return Response.json({Status:0,Answer:[{type:1,data:'10.0.0.1'}]});pageCalls++;return new Response('unexpected');});
 assert.equal(badDns.status,'error');assert.equal(pageCalls,0);
 const redirect=await loadPage('https://reader.example.org',signal,undefined,async(url)=>url.startsWith('https://cloudflare-dns.com')?dns():(pageCalls++,new Response(null,{status:302,headers:{Location:'https://127.0.0.1/secrets'}})));
 assert.equal(redirect.status,'error');assert.equal(pageCalls,1);
});
test('Reader exposes explicit failures for denied, unsupported and oversized responses',async()=>{
 for(const response of [()=>new Response('Denied',{status:403}),()=>new Response('pdf',{headers:{'Content-Type':'application/pdf'}}),()=>new Response('x',{headers:{'Content-Type':'text/plain','Content-Length':'1000001'}}),()=>new Response('x'.repeat(1000001),{headers:{'Content-Type':'text/plain'}})]){
 const result=await loadPage('https://reader.example.org',signal,undefined,async url=>url.startsWith('https://cloudflare-dns.com')?dns():response());assert.equal(result.status,'error');assert.equal(result.text,'');assert.ok(result.error.length>0);
 }
});
const answer={answer:'Page summary',grounds:[],assumptions:[],uncertainty:''};
const observation={framing:'Check page',findings:[],intervene:false,reason:'Supported',request:'',fallibility:'Excerpt only'};
const source={url:'https://reader.example.org',finalUrl:'https://reader.example.org/',title:'Article',text:'Verified excerpt',status:'ok',error:'',truncated:false};
const input={question:'Summarize',mode:'REFLECT',history:[],hypotheses:[],cognitionModel:'gpt-4.1-mini',metaModel:'gpt-4.1-mini'};
test('Both AI layers receive identical source records and bounded historic excerpts',async()=>{
 const seen=[];const provider={usage:{calls:0,input:0,output:0},async generate(model,prompt,payload){seen.push({prompt,payload});return ++this.usage.calls===1?answer:observation;}};
 const result=await run({...input,sources:[source],history:[{role:'user',content:'Earlier',sources:[source]}]},provider);
 assert.deepEqual(seen[0].payload.webSources,[source]);assert.deepEqual(seen[1].payload.webSources,[source]);assert.deepEqual(seen[0].payload.history[0].sources,[source]);assert.deepEqual(result.sources,[source]);assert.match(seen[0].prompt,/never infer its content/);
 assert.throws(()=>validateInput({...input,history:[{role:'user',content:'x',sources:[{...source,text:'x'.repeat(12001)}]}]}));
 assert.throws(()=>validateInput({...input,history:[{role:'user',content:'x',sources:Array(4).fill(source)}]}));
});
test('Cloudflare reader: HTML extraction, DNS, D1 protection and shared model context run end-to-end',async()=>{
 const calls=[];let pageCalls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('worker/index.js','utf8'),compatibilityDate:'2026-10-30',d1Databases:['DB'],outboundService:async req=>{
  const url=new URL(req.url);
  if(url.hostname==='cloudflare-dns.com'){assert.equal(req.headers.has('Authorization'),false);return dns();}
  if(url.hostname==='reader.example.org'){pageCalls++;assert.equal(req.headers.has('Authorization'),false);assert.equal(req.headers.has('Cookie'),false);return new Response('<html><head><title>Test Article</title><script>SECRET_SCRIPT</script></head><body><nav>SECRET_NAV</nav><article><h1>Public article</h1><p>'+('Public evidence for the discussion. '.repeat(10))+'</p></article><script>SECRET_BODY_SCRIPT</script><footer>SECRET_FOOTER</footer></body></html>',{headers:{'Content-Type':'text/html'}});}
  assert.equal(url.origin,'https://api.openai.com');const body=await req.json();const payload=JSON.parse(body.input[0].content);calls.push(payload);const value=calls.length===1?answer:observation;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1,output_tokens:1}});
 }}));
 try{
 const db=await mf.getD1Database('DB');await db.exec(readFileSync('migrations/0001_public_beta_limits.sql','utf8').replaceAll('\n',' '));
 const make=()=>mf.dispatchFetch('https://mirror.test/api/run',{method:'POST',headers:{Origin:'https://mirror.test',Authorization:'Bearer sk-local-placeholder','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({...input,question:'Read https://reader.example.org/article'})});
 const r=await make();const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(pageCalls,1);assert.equal(data.sources[0].title,'Test Article');assert.equal(data.sources[0].status,'ok');assert.ok(!data.sources[0].text.includes('SECRET_'));assert.match(data.sources[0].text,/Public evidence/);assert.deepEqual(calls[0].webSources,calls[1].webSources);
 await db.prepare("UPDATE abuse_buckets SET hits=60 WHERE id='url-global-minute'").run();assert.equal((await make()).status,429);assert.equal(pageCalls,1);
 }finally{await mf.dispose();}
});
