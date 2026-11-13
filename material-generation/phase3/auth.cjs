'use strict';
const {fault}=require('./policy.cjs');
const {authStep,isAuthTimeout}=require('./auth-step.cjs');
// Google library verifies signature, expiry, issuer and the explicit Apps Script audience.
// No ID-token decoding without signature verification is accepted as authentication.
function createIdentityVerifier({audience,OAuth2Client,timeoutMs=5000,log}){
 if(typeof audience!=='string'||!audience.endsWith('.apps.googleusercontent.com'))throw Error('Apps Scriptの確認済みOAuthクライアントIDが必要です');
 const client=new OAuth2Client();
 return async header=>{
  const match=/^Bearer ([A-Za-z0-9._-]{20,8192})$/.exec(String(header||''));if(!match)throw fault(401,'本人認証が必要です');
  let payload;try{payload=await authStep('google_id_token',async()=>{const p=(await client.verifyIdToken({idToken:match[1],audience})).getPayload();if(!p||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.aud!==audience||p.email_verified!==true||!p.email||!p.sub)throw fault(401,'本人トークンを検証できません');return p;},{timeoutMs,log});}catch(e){if(isAuthTimeout(e))throw e;throw fault(401,'本人トークンを検証できません');}
  if(!payload||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||payload.aud!==audience||payload.email_verified!==true||typeof payload.email!=='string'||!payload.email||typeof payload.sub!=='string'||!payload.sub)throw fault(401,'確認済みGoogleアカウントが必要です');
  return {email:payload.email,sub:payload.sub};
 };
}
function createTeacherChecker({auth,database,readTeacherFlag,timeoutMs=5000,log}){
 return async identity=>{
  let user;try{user=await authStep('firebase_auth_user',()=>auth.getUserByEmail(identity.email),{timeoutMs,log});}catch(e){if(isAuthTimeout(e))throw e;if(e.code==='auth/user-not-found')throw fault(403,'教員権限がありません');throw fault(503,'Firebase Authを参照できません。管理者に接続先・読み取り権限を確認してください');}
  if(user.disabled||!user.emailVerified||!user.providerData?.some(p=>p.providerId==='google.com'&&p.uid===identity.sub))throw fault(403,'教員権限がありません');
  let flag;try{flag=await authStep('rtdb_teacher_flag',signal=>readTeacherFlag?readTeacherFlag(user.uid,signal):database.ref('teacherUids/'+user.uid).get().then(s=>s.val()),{timeoutMs,log})}catch(e){if(isAuthTimeout(e))throw e;throw fault(503,'教員登録を読み取れません。管理者が接続先・読み取り権限を確認してください')}
  if(flag!==true)throw fault(403,'教員権限がありません');
  return {uid:user.uid};
 };
}
// Bounded one-shot REST read avoids the realtime SDK reconnect loop for this server.
function createRestTeacherReader({credential,databaseURL,fetchImpl=fetch}){
 const url=new URL(databaseURL);if(url.protocol!=='https:'||url.search||url.hash||url.pathname!=='/')throw Error('Database URLが不正です');
 return async(uid,signal)=>{
  if(typeof uid!=='string'||!uid||uid.length>128)throw Error('教員識別子が不正です');
  const token=await credential.getAccessToken();signal.throwIfAborted();
  const response=await fetchImpl(new URL('teacherUids/'+encodeURIComponent(uid)+'.json',url),{method:'GET',headers:{Authorization:'Bearer '+token.access_token},signal,redirect:'error'});
  if(!response.ok)throw Error('Database read failed');
  // A teacher flag must be a tiny boolean; do not download an arbitrary data tree.
  const reader=response.body.getReader();let length=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32)throw Error('Invalid flag response');text+=Buffer.from(value).toString('utf8');}return JSON.parse(text);}finally{await reader.cancel().catch(()=>{});}
 };
}
module.exports={createIdentityVerifier,createTeacherChecker,createRestTeacherReader};
