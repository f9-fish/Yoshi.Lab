'use strict';
const {sanitizeDiagnostic}=require('../../gemini-diagnostics.cjs'),{validationCode,safeValidationCode}=require('../../validation-diagnostics.cjs'),C=require('../../core.cjs');
const JOB='JOB-dcb7e4afbc33a3565fb44a022b5cdcb2',SERVICE='yoshilab-material-test03',SA=SERVICE+'@yoshi-lab-db3eb.iam.gserviceaccount.com';
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000?v:null;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v)?v:null;
const revision=v=>typeof v==='string'&&/^yoshilab-material-test03-[a-z0-9-]{1,60}$/.test(v)?v:null;
const model=v=>typeof v==='string'&&/^gemini-[a-z0-9._-]{1,80}$/i.test(v)?v:null;
function replay(job){
 const results=job.report?.checkpoint?.rawResults;
 if(!results||!Object.hasOwn(results,'writing'))return {rawWritingPresent:false};
 const raw=results.writing,out={rawWritingPresent:true,rawQuestionCount:Array.isArray(raw?.items)?raw.items.length:null,actualModelId:model(raw?._generation?.actualModelId)};
 try{const source=C.buildSource(job.input?.master,job.input?.selection),config=C.settingsFor(source,job.input?.settings);const valid=C.validateResult('writing',raw,source,config);return {...out,validationPassed:true,candidateCount:valid.candidates.length,shortage:valid.shortage};}catch(e){return {...out,validationPassed:false,code:validationCode(e.message)};}
}
function providerFailureCode(diagnostic){
 if(diagnostic.event==='timeout')return 'CLIENT_TIMEOUT';
 if(diagnostic.event==='cancelled')return 'CLIENT_CANCELLED';
 if(diagnostic.event==='network_error')return 'NETWORK_FAILURE';
 if(diagnostic.event==='http_error'){
  if(diagnostic.httpStatus===503&&diagnostic.providerStatus==='UNAVAILABLE')return 'UPSTREAM_UNAVAILABLE';
  const codes={400:'UPSTREAM_HTTP_400',401:'UPSTREAM_HTTP_401',403:'UPSTREAM_HTTP_403',404:'UPSTREAM_HTTP_404',408:'UPSTREAM_HTTP_408',429:'UPSTREAM_HTTP_429',500:'UPSTREAM_HTTP_500',502:'UPSTREAM_HTTP_502',503:'UPSTREAM_HTTP_503',504:'UPSTREAM_HTTP_504'};return codes[diagnostic.httpStatus]||'UPSTREAM_HTTP_OTHER';
 }
 if(diagnostic.finishReason==='MAX_TOKENS')return 'OUTPUT_TRUNCATED';
 return 'RESPONSE_INVALID_OR_INCOMPLETE';
}
function errorSummary(e){
 const diagnostic=sanitizeDiagnostic(e?.diagnostic);let code=e?.validation?safeValidationCode(e.validation.code):validationCode(e?.message);let stage='unknown';
 if(diagnostic){stage=['timeout','network_error','cancelled'].includes(diagnostic.event)?'transport':diagnostic.event==='http_error'?'provider_http':'provider_response';code=providerFailureCode(diagnostic);}
 else if(code!=='UNCLASSIFIED')stage='material_validation';
 return {writing:e?.type==='writing',stage,code,...(diagnostic?{diagnostic}:{})};
}
function summarize(kind,v){
 if(kind==='run'){
  const spec=v.spec?.template?.spec,env=spec?.containers?.[0]?.env||[],get=k=>env.find(e=>e.name===k),digest=/sha256:[a-f0-9]{64}$/.exec(v.status?.imageDigest||'')?.[0]||null;
  return {section:kind,serviceMatches:v.metadata?.name===SERVICE,runtimeAccountMatches:spec?.serviceAccountName===SA,environmentMatches:get('MG_PHASE4_ENVIRONMENT')?.value==='TEST03',profileMatches:get('MG_GEMINI_PROFILE')?.value==='writing-low-latency-v1',modelId:model(get('MG_GEMINI_MODEL')?.value),singleJob:get('MG_PHASE4_SINGLE_JOB')?.value==='true',appendDisabled:get('MG_TEST_APPEND_ENABLED')?.value==='false',bucketMatches:get('MG_GCS_BUCKET')?.value==='yoshi-lab-db3eb-material-test03-jobs',secretReferenceConfigured:!!get('MG_GEMINI_API_KEY')?.valueFrom?.secretKeyRef,secretLiteralPresent:typeof get('MG_GEMINI_API_KEY')?.value==='string',cloudRunTimeoutSeconds:integer(spec?.timeoutSeconds),latestReadyRevision:revision(v.status?.latestReadyRevisionName),imageDigest:digest};
 }
 if(kind==='claim')return {section:kind,jobMatches:v.jobId===JOB,attempted:v.attempted===true,attemptedAt:timestamp(v.attemptedAt)};
 if(kind==='job'){
  // Refuse to replay an unexpected object: do not analyze another teacher's job accidentally.
  if(v.id!==JOB)return {section:kind,jobMatches:false};
  const errors=Array.isArray(v.report?.errors)?v.report.errors.slice(0,10).map(errorSummary):[],savedResponseCheck=replay(v);
  const nextAction=errors.some(e=>e.code==='UPSTREAM_UNAVAILABLE')?'HOLD_NEW_GENERATION_REVIEW_PROVIDER':savedResponseCheck.rawWritingPresent?'REVIEW_SAVED_RESPONSE_OFFLINE':'REVIEW_DIAGNOSTICS_NO_RETRY';
  return {section:kind,nextAction,jobMatches:true,environmentMatches:v.environment==='TEST03',state:['生成待ち','生成中','要確認','エラー'].includes(v.state)?v.state:'unknown',revision:integer(v.revision),createdAt:timestamp(v.createdAt),candidateCount:Array.isArray(v.report?.candidates)?v.report.candidates.length:null,errors,savedResponseCheck};
 }
 if(kind==='gemini-logs')return {section:kind,records:Array.isArray(v)?v.slice(0,100).map(e=>({timestamp:timestamp(e.timestamp),revision:revision(e.resource?.labels?.revision_name),diagnostic:sanitizeDiagnostic(e.jsonPayload)})):[]};
 if(kind==='validation-logs')return {section:kind,records:Array.isArray(v)?v.slice(0,100).map(e=>({timestamp:timestamp(e.timestamp),revision:revision(e.resource?.labels?.revision_name),validationRejected:e.jsonPayload?.event==='rejected',writing:e.jsonPayload?.type==='writing',code:safeValidationCode(e.jsonPayload?.code)})):[]};
 if(kind==='request-logs')return {section:kind,records:Array.isArray(v)?v.slice(0,100).map(e=>({timestamp:timestamp(e.timestamp),revision:revision(e.resource?.labels?.revision_name),status:integer(e.httpRequest?.status),latency:typeof e.httpRequest?.latency==='string'&&/^\d+(?:\.\d{1,9})?s$/.test(e.httpRequest.latency)?e.httpRequest.latency:null})):[]};
 throw Error('unsupported');
}
if(require.main===module){(async()=>{let bytes=0;const chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8*1024*1024)throw Error('size');chunks.push(chunk);}console.log(JSON.stringify(summarize(process.argv[2],JSON.parse(Buffer.concat(chunks).toString('utf8')))));})().catch(()=>{console.error('診断データを安全に要約できません。入力全文は表示しません。');process.exitCode=1;});}
module.exports={summarize,replay,errorSummary,JOB};
