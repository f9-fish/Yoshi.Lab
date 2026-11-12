'use strict';
// Dedicated test server only: no Firebase Functions export, deployment or production writes.
async function main(){
 const env=process.env,preflight=env.MG_PREFLIGHT_ENABLED==='true';
 if(env.MG_MODE!=='TEST'||(!preflight&&env.MG_ENABLED!=='true'))throw Error('サーバーは無効です。管理者確認が必要です');
 if(preflight&&(env.MG_ENABLED==='true'||env.MG_TEST_APPEND_ENABLED==='true'))throw Error('接続確認専用モードでは生成・追記を有効にできません');
 if(!preflight&&(env.MG_AUTH_VERIFIED!=='true'||env.MG_STORAGE_VERIFIED!=='true'))throw Error('認証・永続保存の管理者確認が必要です');
 if(!env.MG_TEST_SPREADSHEET_ID||!env.MG_GOOGLE_AUDIENCE)throw Error('テストID・Apps Scriptのaudienceが必要です');
 const deployment=require('../phase4/deployment.cjs').deploymentFor(env);
 const {OAuth2Client}=require('google-auth-library'),{initializeApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth');
 const {createIdentityVerifier,createTeacherChecker,createRestTeacherReader}=require('./auth.cjs'),{createService}=require('./service.cjs'),{handler}=require('./http.cjs');
 const app=initializeApp({projectId:'yoshi-lab-db3eb',databaseURL:'https://yoshi-lab-db3eb-default-rtdb.firebaseio.com'},'sheet-material-server');
 const options={enabled:true,singleJobEnvironment:deployment.environment,generationApproved:deployment.environment!=='TEST02'||env.MG_GENERATION_APPROVED==='true',preflightOnly:preflight,allowedTestIds:[env.MG_TEST_SPREADSHEET_ID],allowedSourceIds:[env.MG_TEST_SPREADSHEET_ID],verifyIdentity:createIdentityVerifier({audience:env.MG_GOOGLE_AUDIENCE,OAuth2Client}),checkTeacher:createTeacherChecker({auth:getAuth(app),readTeacherFlag:createRestTeacherReader({credential:app.options.credential,databaseURL:app.options.databaseURL})})};
 if(!preflight){
  options.singleJob=env.MG_PHASE4_SINGLE_JOB==='true';
  if(options.singleJob&&(env.MG_MODEL_VERIFIED!=='true'||env.MG_COST_CONFIRMED!=='true'||env.MG_TEST_APPEND_ENABLED!=='false'))throw Error('Phase 4はモデル・費用確認と追記無効の明示が必要です');
  if(!env.MG_GEMINI_MODEL||!env.MG_GEMINI_API_KEY)throw Error('確認済みモデルとサーバー側Secret設定が必要です');
  if(env.MG_STORE_BACKEND==='gcs'){
   if(!env.MG_GCS_BUCKET)throw Error('テスト専用GCSバケットが必要です');const {Storage}=require('@google-cloud/storage'),{GcsStore}=require('./gcs-store.cjs');options.store=new GcsStore(new Storage().bucket(env.MG_GCS_BUCKET),{prefix:deployment.prefix});
  }else if(env.MG_STORE_BACKEND==='file'){
   if(env.K_SERVICE||!env.MG_STATE_DIR)throw Error('Cloud RunでFileStoreは使えません。永続保存先を確認してください');const {FileStore}=require('./file-store.cjs');options.store=new FileStore(env.MG_STATE_DIR);
  }else throw Error('永続保存方式を明示してください');
  const {createGeminiGenerator}=require('../gemini.cjs');options.generate=createGeminiGenerator({apiKey:env.MG_GEMINI_API_KEY,model:env.MG_GEMINI_MODEL,profile:env.MG_GEMINI_PROFILE||'legacy',includeMetadata:options.singleJob,log:entry=>console.info(JSON.stringify(entry))});options.dailyLimit=Number(env.MG_DAILY_LIMIT||10);options.testAppendEnabled=env.MG_TEST_APPEND_ENABLED==='true';
 }
 const server=require('node:http').createServer(handler(createService(options)));server.requestTimeout=120000;
 server.listen(Number(env.PORT||8080),env.MG_BIND_HOST||'127.0.0.1',()=>console.log(preflight?'接続確認専用サーバーを開始しました（生成・追記・公開なし）':'テスト用生成サーバーを開始しました（本番・公開なし）'));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
