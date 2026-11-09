'use strict';
const {ReviewError}=require('./review-core.cjs');
function createQuota(db){
 const collection=db.collection('writingAiUsage');
 return {
  async reserve(t){
   const user=collection.doc('u-'+t.userKey+'-'+t.day),global=collection.doc('g-'+t.day),request=collection.doc('r-'+t.requestKey);
   await db.runTransaction(async tx=>{
    const [u,g,r]=await Promise.all([tx.get(user),tx.get(global),tx.get(request)]);
    if(r.exists)throw new ReviewError('already-exists','この解答は送信済みです。');
    const ud=u.data()||{},gd=g.data()||{};
    if((ud.count||0)>=t.dailyLimit||(gd.count||0)>=t.globalLimit)throw new ReviewError('resource-exhausted','本日のAI添削の利用上限です。');
    if((ud.inflightUntil||0)>t.time)throw new ReviewError('resource-exhausted','前の添削を処理中です。');
    const expiresAt=new Date(t.time+3*24*3600000);
    tx.set(user,{count:(ud.count||0)+1,inflightUntil:t.time+30000,lastRequest:t.requestKey,expiresAt});
    tx.set(global,{count:(gd.count||0)+1,expiresAt});
    tx.set(request,{status:'pending',createdAt:t.time,expiresAt});
   });
  },
  async complete(t){
   const user=collection.doc('u-'+t.userKey+'-'+t.day),request=collection.doc('r-'+t.requestKey);
   await db.runTransaction(async tx=>{
    const snap=await tx.get(user);
    if(snap.data()?.lastRequest===t.requestKey)tx.update(user,{inflightUntil:0});
    tx.update(request,{status:t.status});
   });
  }
 };
}
module.exports={createQuota};
