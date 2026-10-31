import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const base='https://mirror.test';
const token=n=>n.toString(16).padStart(64,'0');
const cipher=JSON.stringify({iv:'AAAAAAAAAAAAAAAA',data:'AAAAAAAAAAAAAAAAAAAAAA=='});
async function setup(){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('worker/index.js','utf8'),compatibilityDate:'2026-10-30',d1Databases:['DB']}));
 const db=await mf.getD1Database('DB');
 for(const path of ['migrations/0000_vaults.sql','migrations/0001_public_beta_limits.sql'])await db.exec(readFileSync(path,'utf8').replaceAll('\n',' '));
 const call=(method,key=token(1),ip='192.0.2.1',body=cipher)=>mf.dispatchFetch(base+'/api/vault',{method,headers:{Origin:base,Authorization:'Bearer '+key,'CF-Connecting-IP':ip,'Content-Type':'application/json'},...(method==='PUT'?{body}:{})});
 return {mf,db,call};
}
test('Vault: save, restore, overwrite, wrong capability and delete in real D1',async()=>{
 const {mf,db,call}=await setup();try{
 assert.equal((await call('PUT')).status,200);
 assert.equal(await (await call('POST')).text(),cipher);
 assert.equal((await call('POST',token(2))).status,404);
 assert.equal((await call('PUT')).status,200);
 assert.equal((await call('DELETE')).status,200);
 assert.equal((await call('POST')).status,404);
 const rows=await db.prepare('SELECT * FROM abuse_buckets').all();
 assert.ok(rows.results.length<=6);assert.ok(!JSON.stringify(rows).includes('192.0.2.1'));
 }finally{await mf.dispose();}
});
test('Vault: unauthenticated, cross-origin and malformed writes denied',async()=>{
 const {mf,call}=await setup();try{
 assert.equal((await call('PUT','bad')).status,401);
 assert.equal((await mf.dispatchFetch(base+'/api/vault',{method:'PUT',headers:{Origin:'https://evil.test',Authorization:'Bearer '+token(1)},body:cipher})).status,403);
 for(const body of [JSON.stringify({iv:'!!!!!!!!!!!!!!!=',data:'AAAAAAAAAAAAAAAAAAAAAA=='}),JSON.stringify({iv:'AAAAAAAAAAAAAAAA',data:'short'})])assert.equal((await call('PUT',token(1),'192.0.2.2',body)).status,400);
 }finally{await mf.dispose();}
});
test('Vault: per-source creation and request rates are persistent and bounded',async()=>{
 const {mf,db,call}=await setup();try{
 for(let n=1;n<=5;n++)assert.equal((await call('PUT',token(n))).status,200);
 assert.equal((await call('PUT',token(6))).status,429);
 assert.equal((await call('PUT',token(1))).status,200); // existing vault still works
 await db.prepare("UPDATE abuse_buckets SET hits=60 WHERE id LIKE 'ip-minute-%'").run();
 const denied=await call('POST');assert.equal(denied.status,429);assert.equal(denied.headers.get('Retry-After'),'60');
 await db.prepare('UPDATE abuse_buckets SET window=window-2').run();
 assert.equal((await call('POST')).status,200); // window rollover, no growing rows
 }finally{await mf.dispose();}
});
test('Vault: concurrent new writes cannot exceed 500; overwrite and deletion work at cap',async()=>{
 const {mf,db,call}=await setup();try{
 await db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<499) INSERT INTO vaults SELECT 'seed-'||x,'{}','2026-11-01' FROM n;`);
 const writes=await Promise.all([call('PUT',token(11),'192.0.2.11'),call('PUT',token(12),'192.0.2.12')]);
 assert.deepEqual(writes.map(r=>r.status).sort(),[200,507]);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM vaults').first()).n,500);
 const winner=writes[0].status===200?11:12;
 assert.equal((await call('PUT',token(winner),'192.0.2.30')).status,200);
 assert.equal((await call('DELETE',token(winner),'192.0.2.30')).status,200);
 assert.equal((await call('PUT',token(13),'192.0.2.13')).status,200);
 }finally{await mf.dispose();}
});
