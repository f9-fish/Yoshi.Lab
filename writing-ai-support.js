(function(root){
 'use strict';
 function validate(value){
  if(!value||!['correct','needs_revision','review'].includes(value.status)||typeof value.needsImprovement!=='boolean'||![true,false,null].includes(value.requiredExpressionsUsed))throw Error('Invalid AI feedback');
  for(const [key,max] of [['correctedEnglish',2000],['explanationJapanese',1200]])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max)throw Error('Invalid AI feedback');
  for(const key of ['strengths','improvementPoints'])if(!Array.isArray(value[key])||value[key].length>4||value[key].some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw Error('Invalid AI feedback');
  if(value.status==='correct'&&(value.needsImprovement||value.requiredExpressionsUsed!==true)||value.status==='needs_revision'&&!value.needsImprovement)throw Error('Inconsistent AI feedback');
  return value;
 }
 async function grade({question,answer,user,judge,call,requestId,timeoutMs=25000}){
  const local=judge(question,answer),fallback=note=>({result:local,feedback:null,note});
  if(!user?.uid||!user.emailVerified)return fallback('AI添削には確認済みGoogleログインが必要です。今回は登録解答で確認しました。');
  if(typeof call!=='function')return fallback('AI添削を利用できないため、登録解答で確認しました。');
  let timer;
  try{
   const value=await Promise.race([Promise.resolve().then(()=>call({question,answer,requestId})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);
   const feedback=validate(value);
   return {result:{...local,status:feedback.status},feedback:{...feedback,correctedEnglish:feedback.needsImprovement?feedback.correctedEnglish:answer},note:'AI添削は学習支援用であり、学校の成績を確定するものではありません。'};
  }catch(error){return fallback(String(error?.code||'').endsWith('resource-exhausted')?'本日のAI添削の利用上限、または他の添削の処理中です。今回は登録解答で確認しました。':'AI添削を利用できないため、登録解答で確認しました。');}
  finally{clearTimeout(timer);}
 }
 const api={grade,validate};if(typeof module==='object'&&module.exports)module.exports=api;root.YoshiWritingAISupport=api;
})(globalThis);
