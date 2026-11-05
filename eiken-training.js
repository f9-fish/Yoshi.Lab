/* EIKEN data/session logic. No Firebase or DOM dependency. */
globalThis.YoshiEiken=(()=>{
 const grades=Object.freeze({pre2:{label:'準2級',file:'eiken_pre2.json'},'2':{label:'2級',file:'eiken_2.json'}});
 function questions(data,grade){
  if(!grades[grade]||!Array.isArray(data))throw Error('問題データの形式が正しくありません。');
  const ids=new Set(),valid=[];
  for(const q of data){
   if(!q||typeof q.id!=='string'||!q.id.trim()||ids.has(q.id)||q.grade!==grades[grade].label||
    !['sentence','translation','explanation','correctWord'].every(k=>typeof q[k]==='string'&&q[k].trim())||
    !Array.isArray(q.choices)||q.choices.length!==4||!q.choices.every(c=>typeof c==='string'&&c.trim())||
    new Set(q.choices).size!==4||!Number.isInteger(q.answer)||q.answer<1||q.answer>4||q.choices[q.answer-1]!==q.correctWord)continue;
   ids.add(q.id);valid.push({...q,choices:[...q.choices]});
  }
  return {valid,invalid:data.length-valid.length};
 }
 function pick(data,random=Math.random){
  const deck=[...data];for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck.slice(0,10);
 }
 function score(session){
  if(!session||!grades[session.grade]||!Array.isArray(session.questions)||!session.questions.length||session.questions.length>10||
   !Array.isArray(session.answers)||session.answers.length!==session.questions.length||
   !session.answers.every(n=>Number.isInteger(n)&&n>=1&&n<=4))throw Error('全問題に解答してください。');
  const right=session.questions.filter((q,i)=>q.answer===session.answers[i]).length;
  let streak=0,best=0;session.questions.forEach((q,i)=>{streak=q.answer===session.answers[i]?streak+1:0;best=Math.max(best,streak);});
  return {right,total:session.questions.length,xp:Math.min(30,right),bestStreak:best};
 }
 return Object.freeze({grades,questions,pick,score});
})();
