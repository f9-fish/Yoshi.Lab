/* Writing data and conservative answer matching. No Firebase or XP writes. */
(function(root){
 'use strict';
 const subjects=['英C','論表'];
 const text=v=>typeof v==='string'?v.trim():'';
 function normalize(value){return String(value??'').normalize('NFKC').replace(/[‘’]/g,"'").toLowerCase().trim().replace(/\s+/g,' ').replace(/[.!?。！？]+$/u,'').trim();}
 function list(value){return (Array.isArray(value)?value:typeof value==='string'?value.split(/\r?\n/):[]).map(text).filter(Boolean);}
 function questions(data){
  if(!Array.isArray(data))throw Error('英作文問題は配列形式で登録してください。');
  const seen=new Set();
  return data.filter(q=>q&&q.status==='公開').map(q=>{
   const row={id:text(q.id),subject:text(q.subject),lesson:String(q.lesson??'').trim(),number:Number(q.number),japanese:text(q.japanese),requiredExpressions:list(q.requiredExpressions),modelAnswer:text(q.modelAnswer),acceptedAnswers:list(q.acceptedAnswers),hints:list(q.hints),explanation:text(q.explanation),status:'公開'};
   if(!row.id||!subjects.includes(row.subject)||!row.lesson||!row.japanese||!row.modelAnswer||!row.explanation||!Number.isFinite(row.number)||row.number<1||seen.has(row.id))throw Error('公開問題の必須項目・問題番号・ID重複を確認してください。');
   seen.add(row.id);return row;
  }).sort((a,b)=>a.number-b.number||a.id.localeCompare(b.id));
 }
 function tokens(value){return normalize(value).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)||[];}
 function hasExpression(answer,expression){
  const words=tokens(answer),phrase=tokens(expression);
  return phrase.length>0&&words.some((_,i)=>phrase.every((w,j)=>words[i+j]===w));
 }
 function judge(q,answer){
  const normalized=normalize(answer);
  if(!normalized)throw Error('英文を入力してください。');
  const expressions=q.requiredExpressions.map(expression=>({expression,used:hasExpression(answer,expression)}));
  const registered=[q.modelAnswer,...q.acceptedAnswers].some(a=>normalize(a)===normalized);
  return {status:registered&&expressions.every(e=>e.used)?'correct':'review',registered,expressions};
 }
 function lessonLabel(id){return /^lesson\b/i.test(id)?id:'Lesson '+id;}
 function lessons(subject,groups,rows){
  const ids=new Set(groups.filter(g=>g&&g.subject===subject).map(g=>String(g.id??'').trim()).filter(Boolean));
  rows.filter(q=>q.subject===subject).forEach(q=>ids.add(q.lesson));
  return [...ids].sort((a,b)=>a.localeCompare(b,'ja',{numeric:true})).map(id=>({id,label:lessonLabel(id),count:rows.filter(q=>q.subject===subject&&q.lesson===id).length}));
 }
 function record(q,answer,result,hints,studentId=null,at=new Date().toISOString()){
  return {schemaVersion:1,mode:'writing',studentId,subject:q.subject,lesson:q.lesson,questionId:q.id,answer,status:result.status,registered:result.registered,expressions:result.expressions,hintsUsed:[...hints],answeredAt:at,xp:0};
 }
 const api={normalize,questions,judge,lessons,record,lessonLabel};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.YoshiWriting=api;
})(typeof globalThis==='object'?globalThis:this);
