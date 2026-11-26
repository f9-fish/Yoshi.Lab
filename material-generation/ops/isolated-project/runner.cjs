'use strict';
// Opt-in Cloud Shell CLI. Default plan is entirely offline. No resource creation.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const {hash,buildSource,settingsFor}=require('../../core.cjs');
const {verifyModel}=require('../../phase4/verify-model.cjs');
const {createGeminiGenerator}=require('../../gemini.cjs');
const {generateBatch}=require('../../engine.cjs');
const {SETTINGS}=require('../../phase4/test01.cjs');
const PREFIX='isolated-v1';
const SOURCE_JOB='JOB-dcb7e4afbc33a3565fb44a022b5cdcb2';
async function readSource(storage){
 const file=storage.bucket('yoshi-lab-db3eb-material-test03-jobs').file('material-generation-test03/'+SOURCE_JOB+'.json');
 const [meta]=await file.getMetadata();if(Number(meta.size)>8*1024*1024)fail('SOURCE_TOO_LARGE');
 const [body]=await storage.bucket('yoshi-lab-db3eb-material-test03-jobs').file(file.name,{generation:meta.generation}).download();
 const job=JSON.parse(body);if(job.id!==SOURCE_JOB||job.environment!=='TEST03'||buildSource(job.input?.master,job.input?.selection).hash!==job.sourceHash)fail('SOURCE_SNAPSHOT_MISMATCH');
 return job.input.master;
}
const fail=code=>{throw Error(code);};
function config(v){
 const c=Object.fromEntries(['projectId','projectNumber','keyResource','secretId','secretVersion','bucket','modelId','provenanceConfirmed'].map(k=>[k,v[k]]));
 if(!/^yoshilab-material-ai-[a-z0-9]{4,9}$/.test(c.projectId||'')||!/^\d{6,20}$/.test(c.projectNumber||'')||c.projectNumber==='543561154900')fail('INVALID_DEDICATED_PROJECT');
 if(!new RegExp('^projects/'+c.projectNumber+'/locations/global/keys/[a-zA-Z0-9_-]{1,100}$').test(c.keyResource||''))fail('INVALID_KEY_RESOURCE');
 if(c.secretId!=='material-ai-gemini'||!/^\d{1,10}$/.test(String(c.secretVersion))||Number(c.secretVersion)<1)fail('INVALID_SECRET_VERSION');
 if(c.bucket!==c.projectId+'-validation'||c.modelId!=='gemini-3.8-flash')fail('INVALID_BUCKET_OR_MODEL');
 if(c.provenanceConfirmed!==true)fail('PROVENANCE_CONFIRMATION_REQUIRED');
 return {...c,secretVersion:String(c.secretVersion)};
}
function cloud(args,{raw=false}={}){
 try{const value=execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1024*1024,env:{...process.env,CLOUDSDK_CORE_LOG_HTTP:'false',CLOUDSDK_CORE_VERBOSITY:'error'}});return raw?value:JSON.parse(value);}catch{fail('CLOUD_READ_FAILED');}
}
function checkMetadata(c,p,k,s,b){
 if(String(p.projectNumber)!==c.projectNumber||p.projectId!==c.projectId||k.name!==c.keyResource||!k.serviceAccountEmail?.endsWith('@'+c.projectId+'.iam.gserviceaccount.com'))fail('PROJECT_OR_AUTH_KEY_MISMATCH');
 const r=k.restrictions,targets=r?.apiTargets;
 if(r?.browserKeyRestrictions||r?.serverKeyRestrictions||r?.androidKeyRestrictions||r?.iosKeyRestrictions||!Array.isArray(targets)||targets.length!==1||targets[0].service!=='generativelanguage.googleapis.com'||targets[0].methods?.length)fail('KEY_RESTRICTION_MISMATCH');
 const secretName='projects/'+c.projectNumber+'/secrets/'+c.secretId+'/versions/'+c.secretVersion;
 if(s.name!==secretName||s.state!=='ENABLED')fail('SECRET_METADATA_MISMATCH');
 if(String(b.projectNumber)!==c.projectNumber||b.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true||b.iamConfiguration?.publicAccessPrevention!=='enforced')fail('PRIVATE_BUCKET_REQUIRED');
}
// Immutable objects, one fixed claim per stage per bucket. Never reset/delete/retry.
function ledger(bucket){return {
 async read(name){try{const [body]=await bucket.file(PREFIX+'/'+name+'.json').download();if(body.length>8*1024*1024)fail('RECORD_TOO_LARGE');return JSON.parse(body);}catch(e){if(Number(e.code)===404)return null;throw e;}},
 async create(name,value){try{await bucket.file(PREFIX+'/'+name+'.json').save(JSON.stringify(value),{resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0}});}catch(e){if(Number(e.code)===412)fail('STAGE_ALREADY_RECORDED');throw e;}}
};}
async function run({stage,c,approved,costConfirmed,store,readSecret,fetchImpl,master,now=()=>Date.now()}){
 c=config(c);if(!['verify-model','generate-ten'].includes(stage))fail('INVALID_STAGE');
 if(approved!==true||costConfirmed!==true)fail('EXPLICIT_APPROVAL_REQUIRED');
 const binding=hash(c);
 let input;
 if(stage==='generate-ten'){
  const receipt=await store.read('verify-model-result');
  if(!receipt?.success||receipt.binding!==binding||!Number.isSafeInteger(receipt.at)||now()-receipt.at>86400000||now()<receipt.at)fail('MODEL_VERIFICATION_REQUIRED');
  const selection={subject:'英C',unitId:'TEST01',part:'1'},source=buildSource(master,selection),settings=settingsFor(source,SETTINGS);
  if(source.rows.length!==6||settings.counts.writing!==10||Object.entries(SETTINGS.counts).some(([k,v])=>settings.counts[k]!==v))fail('SOURCE_MUST_BE_SIX_ROWS');
  input={master,selection,settings:SETTINGS};
 }
 // A failure reading the secret also consumes the stage. Nothing removes this claim.
 await store.create(stage+'-claim',{binding,provenance:c,attempted:true,at:now(),stage,...(input?{sourceHash:buildSource(input.master,input.selection).hash}:{})});
 let result;const started=now(),diagnostic={stage,retryAttempted:false};
 const safeFetch=async(url,options)=>{try{const response=await fetchImpl(url,options);diagnostic.httpStatus=response.status;return response;}catch(e){diagnostic.event=['TimeoutError','AbortError'].includes(e.name)?'timeout':'network_error';throw Error('REQUEST_FAILED');}};
 try{
  const apiKey=await readSecret();
  if(stage==='verify-model'){
   const metadata=await verifyModel({model:c.modelId,apiKey,fetchImpl:safeFetch});
   if(!(metadata.outputTokenLimit>=12000))fail('MODEL_OUTPUT_LIMIT_TOO_SMALL');
   result={success:true,modelId:c.modelId,generateContentSupported:true};
  }else{
   const diagnostics=[];
   const generate=createGeminiGenerator({apiKey,model:c.modelId,profile:'writing-low-latency-v1',fetchImpl:safeFetch,includeMetadata:true,log:d=>diagnostics.push(d)});
   const report=await generateBatch(input,{generate,maxKindsPerRun:1,preserveInvalidResults:true});
   // Response and source are private GCS only, never stdout.
   await store.create('generation-private',{report,diagnostics});
   result={success:report.errors.length===0&&report.candidates.length===10,generated:report.candidates.length,validationErrors:report.errors.length};
  }
 }catch{result={success:false,code:'VERIFICATION_OR_GENERATION_FAILED'};}
 diagnostic.elapsedMs=now()-started;
 const receipt={...result,binding,at:now(),stage,diagnostic,retryAttempted:false,appendEnabled:false,publishEnabled:false};
 await store.create(stage+'-result',receipt);
 return receipt;
}
async function main(){
 const [stage='plan',file,sourceFile]=process.argv.slice(2);
 if(stage==='plan'){console.log(JSON.stringify({offline:true,creationEnabled:false,requestsSent:0,stages:['verify-model','generate-ten'],appendEnabled:false,publishEnabled:false}));return;}
 if(!['verify-model','generate-ten'].includes(stage))fail('INVALID_STAGE');
 const approved=process.env.MG_ISOLATED_APPROVED===stage,costConfirmed=process.env.MG_COST_CONFIRMED==='true';
 if(!approved||!costConfirmed)fail('EXPLICIT_APPROVAL_REQUIRED');
 const c=config(JSON.parse(fs.readFileSync(file,'utf8')));
 const p=cloud(['projects','describe',c.projectId,'--format=json']);
 const k=cloud(['services','api-keys','describe',c.keyResource,'--project='+c.projectId,'--format=json']);
 const s=cloud(['secrets','versions','describe',c.secretVersion,'--secret='+c.secretId,'--project='+c.projectId,'--format=json']);
 const {Storage}=require('@google-cloud/storage'),{OAuth2Client}=require('google-auth-library');
 const authClient=new OAuth2Client();authClient.setCredentials({access_token:cloud(['auth','print-access-token'],{raw:true}).trim()});
 const storage=new Storage({projectId:c.projectId,authClient,retryOptions:{autoRetry:false,maxRetries:0}}),bucket=storage.bucket(c.bucket);
 const [b]=await bucket.getMetadata();checkMetadata(c,p,k,s,b);
 const receipt=await run({stage,c,approved,costConfirmed,store:ledger(bucket),readSecret:async()=>cloud(['secrets','versions','access',c.secretVersion,'--secret='+c.secretId,'--project='+c.projectId],{raw:true}).trim(),fetchImpl:globalThis.fetch,master:stage==='generate-ten'?(sourceFile?JSON.parse(fs.readFileSync(sourceFile,'utf8')):await readSource(storage)):undefined});
 console.log(JSON.stringify(receipt));if(!receipt.success)process.exitCode=1;
}
const SAFE_ERRORS=new Set(['INVALID_DEDICATED_PROJECT','INVALID_KEY_RESOURCE','INVALID_SECRET_VERSION','INVALID_BUCKET_OR_MODEL','PROVENANCE_CONFIRMATION_REQUIRED','EXPLICIT_APPROVAL_REQUIRED','PROJECT_OR_AUTH_KEY_MISMATCH','KEY_RESTRICTION_MISMATCH','SECRET_METADATA_MISMATCH','PRIVATE_BUCKET_REQUIRED','MODEL_VERIFICATION_REQUIRED','SOURCE_MUST_BE_SIX_ROWS','SOURCE_SNAPSHOT_MISMATCH','SOURCE_TOO_LARGE','STAGE_ALREADY_RECORDED','CLOUD_READ_FAILED','INVALID_STAGE']);
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({success:false,code:SAFE_ERRORS.has(e.message)?e.message:'ISOLATED_CHECK_STOPPED',retryAttempted:false}));process.exitCode=1;});
module.exports={config,checkMetadata,ledger,run,readSource};
