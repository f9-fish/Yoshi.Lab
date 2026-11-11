'use strict';
const {fault}=require('./policy.cjs');
// Google library verifies signature, expiry, issuer and the explicit Apps Script audience.
// No ID-token decoding without signature verification is accepted as authentication.
function createIdentityVerifier({audience,OAuth2Client}){
 if(typeof audience!=='string'||!audience.endsWith('.apps.googleusercontent.com'))throw Error('Apps Scriptの確認済みOAuthクライアントIDが必要です');
 const client=new OAuth2Client();
 return async header=>{
  const match=/^Bearer ([A-Za-z0-9._-]{20,8192})$/.exec(String(header||''));if(!match)throw fault(401,'本人認証が必要です');
  let payload;try{payload=(await client.verifyIdToken({idToken:match[1],audience})).getPayload();}catch{throw fault(401,'本人トークンを検証できません');}
  if(!payload||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||payload.aud!==audience||payload.email_verified!==true||typeof payload.email!=='string'||!payload.email||typeof payload.sub!=='string'||!payload.sub)throw fault(401,'確認済みGoogleアカウントが必要です');
  return {email:payload.email,sub:payload.sub};
 };
}
function createTeacherChecker({auth,database}){
 return async identity=>{
  let user;try{user=await auth.getUserByEmail(identity.email);}catch{throw fault(403,'教員権限がありません');}
  if(user.disabled||!user.emailVerified||!user.providerData?.some(p=>p.providerId==='google.com'&&p.uid===identity.sub))throw fault(403,'教員権限がありません');
  let flag;try{flag=(await database.ref('teacherUids/'+user.uid).get()).val()}catch{throw fault(503,'教員登録を読み取れません。管理者が読み取り権限を確認してください')}
  if(flag!==true)throw fault(403,'教員権限がありません');
  return {uid:user.uid};
 };
}
module.exports={createIdentityVerifier,createTeacherChecker};
