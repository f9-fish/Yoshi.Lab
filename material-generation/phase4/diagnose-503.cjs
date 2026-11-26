'use strict';
// Only metadata projections. Never print input JSON, errors, env values or identities wholesale.
const EXPECTED_JOB='JOB-b888236ffcfcd39446e41e5e09e4fd70';
function summarize(kind,value){
 if(kind==='run'){
  const spec=value.spec?.template?.spec,container=spec?.containers?.[0],env=container?.env||[],get=name=>env.find(e=>e.name===name);
  const model=get('MG_GEMINI_MODEL')?.value;
  return {kind,serviceMatches:value.metadata?.name==='yoshilab-material-test01',runtimeAccountMatches:spec?.serviceAccountName==='yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com',modelId:typeof model==='string'&&/^gemini-[a-z0-9._-]{1,80}$/i.test(model)?model:'invalid-or-unset',phase4SingleJob:get('MG_PHASE4_SINGLE_JOB')?.value==='true',appendDisabled:get('MG_TEST_APPEND_ENABLED')?.value==='false',secretReferenceConfigured:!!get('MG_GEMINI_API_KEY')?.valueFrom?.secretKeyRef,secretLiteralPresent:typeof get('MG_GEMINI_API_KEY')?.value==='string',timeoutSeconds:Number.isInteger(spec?.timeoutSeconds)?spec.timeoutSeconds:null};
 }
 if(kind==='claim')return {kind,jobMatches:value.jobId===EXPECTED_JOB,attempted:value.attempted===true};
 if(kind==='job')return {kind,jobMatches:value.id===EXPECTED_JOB,state:['生成待ち','生成中','要確認','エラー'].includes(value.state)?value.state:'unknown',revision:Number.isSafeInteger(value.revision)?value.revision:null,candidateCount:Array.isArray(value.report?.candidates)?value.report.candidates.length:null,errors:(value.report?.errors||[]).map(e=>({writing:e.type==='writing',upstreamHttpStatus:Number(/^AIサービスが応答しませんでした（HTTP (\d{3})）$/.exec(e.message||'')?.[1])||null}))};
 throw Error('unsupported');
}
if(require.main===module){(async()=>{let bytes=0;const chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8*1024*1024)throw Error('size');chunks.push(chunk)}console.log(JSON.stringify(summarize(process.argv[2],JSON.parse(Buffer.concat(chunks).toString('utf8')))));})().catch(()=>{console.error('診断メタデータを取得できません。入力内容は表示しません。');process.exitCode=1;});}
module.exports={summarize};
