import {spawn} from 'node:child_process';
// Accept common preview-runner flags and map them to Wrangler's CLI.
const incoming=process.argv.slice(2);
const value=(names,fallback)=>{for(let i=0;i<incoming.length;i++){for(const n of names){if(incoming[i]===n&&incoming[i+1])return incoming[i+1];if(incoming[i].startsWith(n+'='))return incoming[i].slice(n.length+1);}}return fallback;};
const port=value(['--port'],process.env.PORT||'8787');
const ip=value(['--host','--hostname','--ip'],'0.0.0.0');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--port',port,'--ip',ip],{stdio:'inherit',env:process.env});
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));
child.on('exit',code=>process.exit(code??0));
