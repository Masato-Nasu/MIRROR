import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../worker/index.js';
const origin='https://mirror.test';
test('PWA manifest, icon bytes, CSP and service-worker headers are actually served',async()=>{
 const html=await worker.fetch(new Request(origin+'/'),{});const text=await html.text();
 assert.match(text,/rel="manifest" href="\/manifest.webmanifest"/);
 assert.match(html.headers.get('Content-Security-Policy'),/worker-src 'self'; manifest-src 'self'/);
 const response=await worker.fetch(new Request(origin+'/manifest.webmanifest'),{});
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/application\/manifest\+json/);
 const manifest=await response.json();assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');
 assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
 for(const icon of [...manifest.icons,{src:'/icons/apple-touch-icon.png',sizes:'180x180'}]){
  const image=await worker.fetch(new Request(origin+icon.src),{});assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');
  const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const [w,h]=icon.sizes.split('x').map(Number);assert.equal(bytes.readUInt32BE(16),w);assert.equal(bytes.readUInt32BE(20),h);
 }
 const sw=await worker.fetch(new Request(origin+'/sw.js'),{});assert.equal(sw.status,200);assert.match(sw.headers.get('Content-Type'),/javascript/);assert.equal(sw.headers.get('Cache-Control'),'no-cache');assert.equal(sw.headers.get('Service-Worker-Allowed'),'/');
});
function harness(){
 const handlers={},stores=new Map(),network=[];let offline=false;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {async addAll(paths){for(const path of paths)map.set(path,new Response('public:'+path));},async put(key,res){map.set(key,res);},async match(key){return map.get(key)?.clone();}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
 const self={location:{origin},clients:{async claim(){}},addEventListener(name,fn){handlers[name]=fn;}};
 const fetch=async(key,options)=>{network.push({key,options});if(offline)throw Error('offline');return new Response('public:'+key);};
 vm.runInNewContext(readFileSync('public/sw.js','utf8'),{self,caches,fetch,URL,Set,Response});
 async function lifecycle(name){let task;handlers[name]({waitUntil(p){task=p;}});await task;}
 async function request(request){let task;handlers.fetch({request,respondWith(p){task=p;}});return task?await task:undefined;}
 return {stores,network,lifecycle,request,setOffline(){offline=true;}};
}
test('PWA never intercepts or caches API, Authorization, cross-origin, user query or unknown URLs',async()=>{
 const h=harness();await h.lifecycle('install');
 for(const req of [new Request(origin+'/api/run',{method:'POST',body:'secret'}),new Request(origin+'/api/health'),new Request(origin+'/api/vault'),new Request(origin+'/app.js?v=0.3.3',{headers:{Authorization:'Bearer dummy-secret'}}),new Request('https://external.test/app.js'),new Request(origin+'/?apiKey=dummy-secret'),new Request(origin+'/private')])assert.equal(await h.request(req),undefined);
 assert.equal(h.network.length,0);
 for(const map of h.stores.values())for(const key of map.keys())assert.ok(!/api|secret|private/.test(key));
});
test('PWA public shell works offline, and activation removes only old MIRROR shell caches',async()=>{
 const h=harness();await h.lifecycle('install');
 h.stores.set('mirror-shell-0.2.0',new Map());h.stores.set('unrelated-data',new Map());
 await h.lifecycle('activate');assert.ok(!h.stores.has('mirror-shell-0.2.0'));assert.ok(h.stores.has('unrelated-data'));
 const online=await h.request(new Request(origin+'/app.js?v=0.3.3'));assert.equal(await online.text(),'public:/app.js?v=0.3.3');assert.equal(h.network[0].options.credentials,'omit');
 h.setOffline();
 assert.equal(await (await h.request(new Request(origin+'/'))).text(),'public:/');
 assert.equal(await (await h.request(new Request(origin+'/app.js?v=0.3.3'))).text(),'public:/app.js?v=0.3.3');
});
