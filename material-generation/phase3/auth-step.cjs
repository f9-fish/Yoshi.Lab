'use strict';
const {fault}=require('./policy.cjs');
const timeouts=new WeakSet();
const isAuthTimeout=e=>e!==null&&typeof e==='object'&&timeouts.has(e);
const STAGES=new Set(['google_id_token','firebase_auth_user','rtdb_teacher_flag']);
// Logs are constructed from fixed fields only. Never serialize errors or identities.
async function authStep(stage,operation,{timeoutMs=5000,log=entry=>console.info(JSON.stringify(entry))}={}){
 if(!STAGES.has(stage)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('認証診断の設定が不正です');
 const start=Date.now(),controller=new AbortController();let timer;
 const emit=event=>{try{log({component:'material_auth',stage,event,elapsedMs:Date.now()-start});}catch{}};
 emit('start');
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=fault(504,stage+' の接続確認がタイムアウトしました。管理者に接続先・権限を確認してください');timeouts.add(error);reject(error);controller.abort();},timeoutMs);});
  const result=await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),timeout]);emit('success');return result;
 }catch(e){emit(isAuthTimeout(e)?'timeout':'failure');throw e;}finally{clearTimeout(timer);}
}
module.exports={authStep,isAuthTimeout};
