'use strict';
const {TEST_ID,keyFor}=require('./test01.cjs');
function deploymentFor(env){
 const environment=env.MG_PHASE4_ENVIRONMENT||'TEST01';keyFor(environment);
 for(const isolated of ['TEST02','TEST03'])if(env.K_SERVICE==='yoshilab-material-'+isolated.toLowerCase()&&environment!==isolated)throw Error('独立テスト環境の指定が必要です');
 if(['TEST02','TEST03'].includes(environment)){
  const suffix=environment.toLowerCase();
  const expected={MG_MODE:'TEST',MG_ENABLED:'true',MG_PREFLIGHT_ENABLED:'false',MG_PHASE4_SINGLE_JOB:'true',MG_TEST_APPEND_ENABLED:'false',MG_STORE_BACKEND:'gcs',MG_GCS_BUCKET:'yoshi-lab-db3eb-material-'+suffix+'-jobs',MG_TEST_SPREADSHEET_ID:TEST_ID,K_SERVICE:'yoshilab-material-'+suffix};
  if(environment==='TEST03')expected.MG_GEMINI_PROFILE='writing-low-latency-v1';
  if(Object.entries(expected).some(([k,v])=>env[k]!==v))throw Error(environment+'のサービス・保存先・単一試行・追記無効の設定が不一致です');
  if(!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.MG_GOOGLE_AUDIENCE||''))throw Error(environment+' Apps Scriptのaudienceが必要です');
 }
 return {environment,prefix:environment==='TEST01'?'material-generation-test':'material-generation-'+environment.toLowerCase()};
}
module.exports={deploymentFor};
