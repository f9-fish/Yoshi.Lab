/* Adapters for published Studio groups. The regular practice decks and XP remain separate. */
(function(root){
 'use strict';
 const text=value=>typeof value==='string'?value.trim():'';
 const lesson=value=>text(value).replace(/^lesson\s+(\d+)$/i,'$1');
 const part=value=>text(value).replace(/^part\s*(\d+)$/i,'$1');
 const key=value=>text(value).normalize('NFKC').toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ');
 function collect(data){
  const groups=new Map();
  for(const entry of Array.isArray(data)?data:[]){
   if(!entry||typeof entry.publishedAt!=='string'||!Number.isFinite(Date.parse(entry.publishedAt))||
      !['英C','論表'].includes(entry.subject)||!entry.questions)continue;
   const id=lesson(entry.id),name=part(entry.name);
   if(!id||!name)continue;
   const slot=JSON.stringify([entry.subject,id,name]);
   const group=groups.get(slot)||{subject:entry.subject,id,name,words:[],cards:[],qa:[],seen:new Set()};
   groups.set(slot,group);
   for(const type of ['vocabulary','idiom','cloze','qa','discussion']){
    const questions=entry.questions[type];
    for(const item of Array.isArray(questions)?questions:[]){
     const question=text(item?.question),answer=text(item?.answer),explanation=text(item?.translation);
     const identity=(type==='idiom'?'vocabulary':type)+':'+key(question);
     if(!question||!answer||!explanation||group.seen.has(identity))continue;
     if(type==='cloze'&&!/\([^()]{1,150}\)/.test(question))continue;
     group.seen.add(identity);
     if(type==='vocabulary'||type==='idiom')group.words.push({word:question,meaning:answer,hint:explanation});
     if(type==='cloze')group.cards.push([question,answer+'\n'+explanation]);
     if(type==='qa'||type==='discussion')group.qa.push({
      id:'studio:'+JSON.stringify([entry.subject,id,name,type,key(question)]),
      subject:entry.subject,unitId:id,unitName:name,number:group.qa.length+1,
      japanese:question,modelAnswer:answer,explanation,status:'公開',studioQa:type==='qa'?'closed':'open',
     });
    }
   }
  }
  return Array.from(groups.values(),({seen,...group})=>group);
 }
 async function load(){
  try{
   const r=await root.fetch('./studio-content.json',{cache:'no-store',signal:AbortSignal.timeout(3000)});
   return r.ok?collect(await r.json()):[];
  }catch{return [];}
 }
 const api={collect,load};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.YoshiStudioPractice=api;
})(typeof globalThis==='object'?globalThis:this);
