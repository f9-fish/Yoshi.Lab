'use strict';
const {randomInt,createHash}=require('node:crypto');
const core=require('./core.cjs');
// All reads/writes use the Admin SDK in the dedicated pair-qa database.
function createService({db,questions,enabled=()=>false,now=()=>Date.now(),randomCode=()=>String(randomInt(0,100000)).padStart(6,'0')}){
 const rows=core.parseQuestions(questions),rooms=db.collection('pairQaRooms'),limits=db.collection('pairQaLimits');
 return async request=>{
  const uid=request.auth?.uid;if(!uid||request.auth?.token?.firebase?.sign_in_provider!=='anonymous')throw new core.QAError('unauthenticated','ペア専用の匿名認証を確認してください');
  if(!request.app)throw new core.QAError('failed-precondition','App Checkを確認してください');
  if(!enabled())throw new core.QAError('unavailable','本文Q&Aは準備中です');
  const data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||Buffer.byteLength(JSON.stringify(data))>1500||Object.keys(data).some(k=>!['action','code','lesson','part','duration','version','rotation','index','ok'].includes(k)))throw new core.QAError('invalid-argument','操作を確認してください');
  const action=data.action,time=now();
  if(!['create','join','get','rotation','start','answer-open','hint-request','hint-next','grade','next'].includes(action))throw new core.QAError('invalid-argument','操作を確認してください');
  if(action!=='create'&&(typeof data.code!=='string'||!/^0\d{5}$/.test(data.code)))throw new core.QAError('invalid-argument','6桁コードを確認してください');
  // Count all calls atomically; rotating anonymous UIDs cannot bypass global caps.
  const bucket=Math.floor(time/60000),userKey=createHash('sha256').update(uid).digest('hex');
  const u=limits.doc('u-'+userKey+'-'+bucket),g=limits.doc('g-'+bucket);
  await db.runTransaction(async tx=>{
   const [us,gs]=await Promise.all([tx.get(u),tx.get(g)]),uc=us.data()?.count||0,gc=gs.data()?.count||0;
   if(uc>=90||gc>=3000)throw new core.QAError('resource-exhausted','通信回数の上限です。少し待ってください');
   const expiresAt=new Date(time+24*3600000);
   if(action==='join'){
    const ju=limits.doc('join-u-'+userKey+'-'+bucket),jg=limits.doc('join-g-'+bucket);
    const [jus,jgs]=await Promise.all([tx.get(ju),tx.get(jg)]),juc=jus.data()?.count||0,jgc=jgs.data()?.count||0;
    if(juc>=10||jgc>=120)throw new core.QAError('resource-exhausted','参加の試行回数が多すぎます。少し待ってください');
    tx.set(ju,{count:juc+1,expiresAt});tx.set(jg,{count:jgc+1,expiresAt});
   }tx.set(u,{count:uc+1,expiresAt});tx.set(g,{count:gc+1,expiresAt});
  });
  if(action==='create'){
   for(let i=0;i<8;i++){
    const code=randomCode(),ref=rooms.doc(code);
    const room=core.createRoom({code,uid,lesson:data.lesson,part:data.part,duration:data.duration,expectedVersion:data.version},rows,time);
    const created=await db.runTransaction(async tx=>{
     const [old,quota]=await Promise.all([tx.get(ref),tx.get(limits.doc('create-'+Math.floor(time/3600000)))]);
     if((quota.data()?.count||0)>=200)throw new core.QAError('resource-exhausted','部屋作成の上限です。少し待ってください');
     if(old.exists&&old.data().expiresAt>time)return false;
     tx.set(ref,{...room,expiresAtTTL:new Date(room.expiresAt)});
     tx.set(limits.doc('create-'+Math.floor(time/3600000)),{count:(quota.data()?.count||0)+1,expiresAt:new Date(time+24*3600000)});return true;
    });
    if(created)return core.view(room,uid,time);
   }
   throw new core.QAError('resource-exhausted','部屋を作れませんでした。再試行してください');
  }
  const ref=rooms.doc(data.code);
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)throw new core.QAError('not-found','部屋が見つかりません');
   const {expiresAtTTL,...old}=snap.data(),next=core.act(old,uid,action,data,time);
   if(JSON.stringify(old)!==JSON.stringify(next))tx.set(ref,{...next,expiresAtTTL});
   return core.view(next,uid,time);
  });
 };
}
module.exports={createService};
