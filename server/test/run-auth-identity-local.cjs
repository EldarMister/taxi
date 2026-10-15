// Use only the existing disposable local test database; never production.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),server=path.join(root,'server');
const settings=Object.fromEntries(fs.readFileSync(path.join(root,'.local/database.env'),'utf8').trim().split(/\r?\n/).map(line=>{const split=line.indexOf('=');return [line.slice(0,split),line.slice(split+1)];}));
const url=new URL(settings.TEST_DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/taxi_test')throw new Error('Only disposable 127.0.0.1:55432/taxi_test is allowed.');
const env={...process.env,DATABASE_URL:settings.TEST_DATABASE_URL,NODE_ENV:'development',TEST_DATABASE_RESET:'true',SMS_PROVIDER:'development',PUSH_PROVIDER:'development',DEV_AUTH_ENABLED:'true',DEV_OTP_CODE:'123456',JWT_SECRET:randomBytes(32).toString('hex'),OTP_SECRET:randomBytes(32).toString('hex'),ROUTING_PROVIDER:'osrm'};
function run(args){const result=spawnSync(process.execPath,args,{cwd:server,env,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run(['node_modules/prisma/build/index.js','migrate','deploy']);
const suites=process.argv.slice(2);
run(['node_modules/tsx/dist/cli.mjs','--test','--test-concurrency=1',...(suites.length?suites:['test/auth-identity.integration.test.ts'])]);
