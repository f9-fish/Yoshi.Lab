'use strict';
// Explicit test-server entry point. No Firebase Functions export or deployment config.
async function main(){
 const env=process.env;
 if(env.MG_ENABLED!=='true'||env.MG_MODE!=='TEST'||env.MG_AUTH_VERIFIED!=='true'||env.MG_STORAGE_VERIFIED!=='true')throw Error('サーバーは無効です。認証・テスト環境・永続保存を管理者が確認してください');
 if(!env.MG_STATE_DIR||!env.MG_TEST_SPREADSHEET_ID||!env.MG_GOOGLE_AUDIENCE||!env.MG_GEMINI_MODEL||!env.MG_GEMINI_API_KEY)throw Error('管理者用のサーバー設定が不足しています');
 const {OAuth2Client}=require('google-auth-library'),{initializeApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getDatabase}=require('firebase-admin/database');
 const {createIdentityVerifier,createTeacherChecker}=require('./auth.cjs'),{FileStore}=require('./file-store.cjs'),{createService}=require('./service.cjs'),{handler}=require('./http.cjs'),{createGeminiGenerator}=require('../gemini.cjs');
 const app=initializeApp({projectId:'yoshi-lab-db3eb',databaseURL:'https://yoshi-lab-db3eb-default-rtdb.firebaseio.com'},'sheet-material-server');
 const service=createService({enabled:true,allowedTestIds:[env.MG_TEST_SPREADSHEET_ID],verifyIdentity:createIdentityVerifier({audience:env.MG_GOOGLE_AUDIENCE,OAuth2Client}),checkTeacher:createTeacherChecker({auth:getAuth(app),database:getDatabase(app)}),store:new FileStore(env.MG_STATE_DIR),generate:createGeminiGenerator({apiKey:env.MG_GEMINI_API_KEY,model:env.MG_GEMINI_MODEL}),dailyLimit:Number(env.MG_DAILY_LIMIT||10),testAppendEnabled:env.MG_TEST_APPEND_ENABLED==='true'});
 const server=require('node:http').createServer(handler(service));server.requestTimeout=120000;
 server.listen(Number(env.PORT||8080),env.MG_BIND_HOST||'127.0.0.1',()=>console.log('テスト用シート生成サーバーを開始しました（教材公開機能なし）'));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
