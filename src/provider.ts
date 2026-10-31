import type {Provider,ImageAttachment,GenerationOptions} from './core.ts';
export function generationSettings(model:string,options:GenerationOptions={}){
 const reasoning=/^gpt-6(?:[.-])/.test(model);
 const effort=options.effort??'medium';
 return reasoning?{max_output_tokens:effort==='high'?24000:effort==='medium'?16000:8000,reasoning:{effort}}:{max_output_tokens:6000};
}
export class OpenAIProvider implements Provider{
 usage={input:0,output:0,calls:0};
 private key:string; private signal:AbortSignal; private transport:typeof fetch;
 constructor(key:string,signal:AbortSignal,transport:typeof fetch=fetch){this.key=key;this.signal=signal;this.transport=transport;}
 async generate(model:string,instructions:string,payload:unknown,schema:Record<string,unknown>,images:ImageAttachment[]=[],options:GenerationOptions={}):Promise<unknown>{
  this.usage.calls++;
  const content=images.length?[{type:'input_text',text:JSON.stringify(payload)},...images.flatMap((image,index)=>[{type:'input_text',text:JSON.stringify({imageIndex:index+1,name:image.name})},{type:'input_image',image_url:image.dataUrl,detail:'auto'}])]:JSON.stringify(payload);
  const transport=this.transport;
  let res:Response;
  try{res=await transport('https://api.openai.com/v1/responses',{method:'POST',redirect:'manual',signal:AbortSignal.any([this.signal,AbortSignal.timeout(180000)]),headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,instructions,input:[{role:'user',content}],...generationSettings(model,options),text:{format:{type:'json_schema',name:'mirror',strict:true,schema}}})});}catch(e){throw Error(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'API_TIMEOUT':'API_NETWORK');}
  if(!res.ok){
   let upstreamCode='';try{const errorBody=await res.json() as {error?:{code?:unknown}};if(typeof errorBody.error?.code==='string')upstreamCode=errorBody.error.code;}catch{}
   const quota=['insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'];
   throw Error(res.status===401?'API_AUTH':quota.includes(upstreamCode)?'API_QUOTA':res.status===429?'API_RATE_LIMIT':res.status===404?'API_MODEL':res.status===403?'API_PERMISSION':res.status===400?'API_REQUEST':'API_FAILURE');
  }
  const data=await res.json() as {status:string;output?:{type:string;content?:{type:string;text?:string}[]}[];usage?:{input_tokens:number;output_tokens:number}};
  this.usage.input+=data.usage?.input_tokens??0;this.usage.output+=data.usage?.output_tokens??0;
  if(data.status!=='completed')throw Error('API_INCOMPLETE');
  const output=(data.output??[]).filter(i=>i.type==='message').flatMap(i=>i.content??[]);
  if(output.some(c=>c.type==='refusal'))throw Error('API_REFUSAL');
  return JSON.parse(output.filter(c=>c.type==='output_text').map(c=>c.text??'').join(''));
 }
}
