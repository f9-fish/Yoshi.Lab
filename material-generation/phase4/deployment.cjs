'use strict';
const {TEST_ID,keyFor}=require('./test01.cjs');
function deploymentFor(env){
 const environment=env.MG_PHASE4_ENVIRONMENT||'TEST01';keyFor(environment);
 if(env.K_SERVICE==='yoshilab-material-test02'&&environment!=='TEST02')throw Error('TEST02の環境指定が必要です');
 if(environment==='TEST02'){
  const expected={MG_MODE:'TEST',MG_ENABLED:'true',MG_PREFLIGHT_ENABLED:'false',MG_PHASE4_SINGLE_JOB:'true',MG_TEST_APPEND_ENABLED:'false',MG_STORE_BACKEND:'gcs',MG_GCS_BUCKET:'yoshi-lab-db3eb-material-test02-jobs',MG_TEST_SPREADSHEET_ID:TEST_ID,K_SERVICE:'yoshilab-material-test02'};
  if(Object.entries(expected).some(([k,v])=>env[k]!==v))throw Error('TEST02のサービス・保存先・単一試行・追記無効の設定が不一致です');
  if(!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.MG_GOOGLE_AUDIENCE||''))throw Error('TEST02 Apps Scriptのaudienceが必要です');
 }
 return {environment,prefix:environment==='TEST02'?'material-generation-test02':'material-generation-test'};
}
module.exports={deploymentFor};
