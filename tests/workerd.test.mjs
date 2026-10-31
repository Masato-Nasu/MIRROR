import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
// Run the actual built Worker in Cloudflare's workerd runtime, not Node's fetch.
// Outbound requests terminate at the local stub: no real key or OpenAI call.
test('Cloudflare runtime: native fetch, all three modes and one reflection',async()=>{
 const answer={answer:'Initial answer',grounds:['A tentative claim'],assumptions:[],uncertainty:'Unverified'};
 const final={...answer,answer:'Reconsidered answer'};
 const observation={framing:'Check assumption',findings:[{category:'assumption',hypothesis:'May overstate certainty',evidence:'Initial answer',counterevidence:'May have evidence',confidence:.8,verification:'Compare evidence'}],intervene:true,reason:'Material uncertainty',request:'Reconsider the assumption',fallibility:'May be mistaken'};
 let calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('worker/index.js','utf8'),compatibilityDate:'2026-10-30',outboundService:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.openai.com');
  const body=await request.json();calls.push(body);assert.equal(body.reasoning.effort,'high');assert.equal(body.max_output_tokens,24000);
  const content=body.input[0].content;const payload=JSON.parse(Array.isArray(content)?content[0].text:content);if(Array.isArray(content)){assert.equal(content[2].type,'input_image');assert.match(content[2].image_url,/^data:image\/png;base64,/);}const value=body.instructions.includes("You are MIRROR's METACOGNITION")?observation:payload.observer?final:answer;
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:10,output_tokens:5}});
 }}));
 try{for(const [mode,expectedCalls] of [['NORMAL',1],['OBSERVE',2],['REFLECT',3]]){
  calls=[];const r=await mf.dispatchFetch('https://mirror.test/api/run',{method:'POST',headers:{Origin:'https://mirror.test',Authorization:'Bearer sk-local-test-placeholder','Content-Type':'application/json'},body:JSON.stringify({question:'test',mode,images:[{name:'pixel.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5i8AAAAASUVORK5CYII='}],history:[],hypotheses:[],cognitionModel:'gpt-6.1-sol',metaModel:'gpt-6-astra',reasoningEffort:'high'})});
  const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(calls.length,expectedCalls);assert.equal(data.final.answer,mode==='REFLECT'?'Reconsidered answer':'Initial answer');assert.equal(data.revised,mode==='REFLECT');
 }}finally{await mf.dispose();}
});
