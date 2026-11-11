/* Reading Plus public True/False rows, reused by the pair-work wizard. */
(function(root){
 const clean=v=>String(v??'').trim(),norm=(v,prefix)=>clean(v).replace(new RegExp('^'+prefix+'\\s*','i'),'').trim();
 function parse(data){
  if(!Array.isArray(data))throw Error('Reading Plusの問題形式が不正です');
  const seen=new Set(),rows=[];
  for(const q of data){
   if(q?.status!=='公開'||q.subject!=='英C'||q.type!=='True / False')continue;
   const lesson=norm(q.lesson,'lesson'),part=norm(q.part,'part'),id=clean(q.id),question=clean(q.question),answer=clean(q.modelAnswer).toLowerCase();
   if(!id||seen.has(id)||!lesson||!part||!question||!['true','false'].includes(answer)||question.length>4000||clean(q.explanation).length>4000)continue;
   seen.add(id);rows.push({id,subject:'英C',lesson,part,type:'True / False',question,modelAnswer:answer==='true'?'True':'False',explanation:clean(q.explanation),status:'公開'});
  }
  return rows;
 }
 function entries(rows){const groups=new Map();for(const q of rows){const key=JSON.stringify([q.lesson,q.part]);if(!groups.has(key))groups.set(key,{subject:'英C',id:q.lesson,name:q.part,text:[],vocab:[],questions:[]});groups.get(key).questions.push(q);}return [...groups.values()];}
 function cards(snapshot){if(!Array.isArray(snapshot)||snapshot.length>200)throw Error('本文正誤問題のセットが不正です');return parse(snapshot).map(q=>[q.question,q.modelAnswer,q.explanation]);}
 const api={parse,entries,cards};if(typeof module==='object')module.exports=api;else root.YoshiPairReadingTF=api;
})(typeof window==='object'?window:globalThis);
