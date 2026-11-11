'use strict';
const TYPES=['vocabulary','cloze','qa','trueFalse','discussion'];
function trimmed(value){return typeof value==='string'?value.trim():''}
function checkInput(obj){
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw bad('教材入力がありません');
 const subject=trimmed(obj.subject),lesson=trimmed(obj.lesson),part=trimmed(obj.part),source=trimmed(obj.source),count=Number(obj.count);
 if(!['英C','論表'].includes(subject))throw bad('科目が不正です');
 if(!lesson||lesson.length>80||/[<>]/.test(lesson))throw bad('Lessonを確認してください');
 if(!part||part.length>30||/[<>]/.test(part))throw bad('Partを確認してください');
 if(!source||source.length>20000)throw bad('本文を2万文字以内で入力してください');
 if(!Number.isInteger(count)||count<1||count>15)throw bad('問題数は1〜15にしてください');
 return {subject,lesson,part,source,count};
}
function bad(message){const e=new Error(message);e.status=400;return e}
function checkQuestions(raw,{allowEmpty=false,requireAllTypes=true}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('問題一覧が不正です');
 const result={},seen=new Set();
 for(const type of TYPES){
  if(!Array.isArray(raw[type])){
   if(requireAllTypes)throw bad(type+'の問題配列がありません');
   result[type]=[];continue;
  }
  if(raw[type].length>25)throw bad(type+'の問題数が多すぎます');
  result[type]=raw[type].map((item,i)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))throw bad(type+'の問'+(i+1)+'が不正です');
   const data={question:trimmed(item.question),answer:trimmed(item.answer),translation:trimmed(item.translation)};
   if(Object.values(data).some(x=>!x||x.length>3000))throw bad(type+'の問'+(i+1)+'の問題・解答・訳を確認してください');
   if(type==='cloze'&&!(/\([^()]{1,150}\)/.test(data.question)))throw bad('穴埋めには正解を ( ) で囲んだ英文が必要です');
   if(type==='trueFalse'&&!['True','False'].includes(data.answer))throw bad('True / Falseの正解はTrueまたはFalseとしてください');
   const key=type+':'+data.question.toLocaleLowerCase('en').replace(/\s+/g,' ');
   if(seen.has(key))throw bad(type+'に重複した問題があります');
   seen.add(key);return data;
  });
 }
 if(!allowEmpty&&!TYPES.every(t=>result[t].length))throw bad('5種類すべての問題を生成できませんでした。再生成してください');
 if(Object.values(result).reduce((n,arr)=>n+arr.length,0)>100)throw bad('公開できる問題は最大100問です');
 return result;
}
function normalizedKey(x){return String(x.subject||'').trim()+'\0'+String(x.id??x.lesson??'').trim()+'\0'+String(x.name??x.part??'').trim()}
function describeSlot(x){return x.subject+' / Lesson '+(x.id??x.lesson)+' / Part '+(x.name??x.part)}
function normalizeContent(groups){
 if(!Array.isArray(groups)||groups.length>2500)throw bad('教材データが多すぎます');
 const ids=new Set();
 for(const group of groups){
  if(!group||typeof group!=='object'||!group.questions)throw bad('教材グループの形式が不正です');
  if(!['英C','論表'].includes(group.subject)||!trimmed(group.id)||!trimmed(group.name))throw bad('教材グループのIDが不正です');
  const id=normalizedKey(group);if(ids.has(id))throw bad('単元IDが重複しています');ids.add(id);
  checkQuestions(group.questions,{allowEmpty:true});
 }
 return groups.sort((a,b)=>a.subject.localeCompare(b.subject,'ja')||
  a.id.localeCompare(b.id,'ja',{numeric:true})||a.name.localeCompare(b.name,'ja',{numeric:true}));
}
module.exports={TYPES,checkInput,checkQuestions,normalizeContent,describeSlot,normalizedKey};
