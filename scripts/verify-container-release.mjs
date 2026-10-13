// Acceptance of actual Docker images, using only the disposable CI database.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assertTestDatabase } from './lib/database-target.mjs';

const root=resolve(import.meta.dirname,'..'), sha=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Require the exact CI source commit.');
assertTestDatabase(process.env.DATABASE_URL);
const pin=JSON.parse(readFileSync(resolve(root,'web/release-downloads.pin.json')));
const output=resolve(root,'artifacts/container-checks');mkdirSync(output,{recursive:true});
const evidence={commit:sha,startedAt:new Date().toISOString(),status:'running',checks:[],images:{},productionReady:false};
const save=()=>writeFileSync(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2));
function docker(args,capture=false){const r=spawnSync('docker',args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:20*60*1000});if(r.error||r.status!==0)throw Error('Docker operation failed: '+args[0]);return r.stdout?.trim();}
const owned=[];
async function get(path){const response=await fetch('http://127.0.0.1:18081'+path,{signal:AbortSignal.timeout(30000),redirect:'manual'});if(response.status!==200)throw Error('Unexpected HTTP status for '+path+': '+response.status);return response;}
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status===200)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Container did not become ready');}
save();
try{
 const api='atlas-api-ci:'+sha,web='atlas-web-ci:'+sha;
 docker(['build','--file','Dockerfile.railway','--tag',api,'.']);
 docker(['build','--file','web/Dockerfile','--tag',web,'web']);
 evidence.images={api:docker(['image','inspect','--format','{{.Id}}',api],true),website:docker(['image','inspect','--format','{{.Id}}',web],true)};save();
 const apiName='atlas-api-check-'+sha.slice(0,12),webName='atlas-web-check-'+sha.slice(0,12);
 owned.push(apiName);docker(['run','--detach','--name',apiName,'--network','host','--env','NODE_ENV=development','--env','PORT=18080','--env','DATABASE_URL','--env','JWT_SECRET','--env','OTP_SECRET','--env','SMS_PROVIDER=development','--env','PUSH_PROVIDER=development','--env','DEV_AUTH_ENABLED=false',api]);
 await ready('http://127.0.0.1:18080/api/health');
 if(docker(['exec',apiName,'cat','/proc/1/comm'],true)!=='tini')throw Error('Expected child-reaping init as PID1');
 evidence.checks.push({name:'api-image-startup-migrations-health-init',status:'passed'});save();
 owned.push(webName);docker(['run','--detach','--name',webName,'--network','host','--env','PORT=18081','--env','API_UPSTREAM=127.0.0.1:18080',web]);
 await ready('http://127.0.0.1:18081/healthz');
 for(const p of ['/','/admin/','/api/health'])await get(p);
 const manifest=await(await get('/downloads/manifest.json')).json();
 for(const variant of ['client','driver']){
  const expected=pin[variant],info=manifest[variant];
  if(!info||info.version!==pin.version||info.sha256!==expected.sha256||info.bytes!==expected.bytes||info.architecture!==expected.architecture||info.path!==`/downloads/atlas-${variant}.apk`||info.available!==true)throw Error('Published manifest differs from immutable pin');
  const r=await get(info.path),hash=createHash('sha256');let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.length;hash.update(chunk);if(bytes>expected.bytes)throw Error('Published APK too large');}
  if(bytes!==expected.bytes||hash.digest('hex')!==expected.sha256)throw Error('Published APK bytes differ');
 }
 if(docker(['exec',webName,'stat','-c','%a','/usr/share/nginx/html/downloads'],true)!=='755')throw Error('Published directory not traversable');
 evidence.checks.push({name:'website-image-nginx-proxy-admin-pinned-apks',status:'passed'});
 evidence.status='passed';evidence.finishedAt=new Date().toISOString();save();
}catch(error){evidence.status='failed';evidence.error=error.message;evidence.finishedAt=new Date().toISOString();save();throw error;}
finally{for(const name of owned.reverse()){const r=spawnSync('docker',['rm','--force',name],{stdio:'inherit'});if(r.status!==0)process.exitCode=1;}}
