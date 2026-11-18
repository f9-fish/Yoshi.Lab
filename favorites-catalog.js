/* Resolve references against the current public teaching material. */
globalThis.YoshiFavoriteCatalog = (() => {
 const Q=YoshiFavoriteQuestions,A=YoshiAnswers,W=YoshiWordbookData;
 const cache=new Map();
 const shuffle=items=>W.shuffle(items);
 const mask=english=>A.primary(english).replace(/\([^()]+\)/g,'（　　）');
 const list=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.trim()):[];
 const writingModel=q=>[q.modelAnswer,...list(q.acceptedAnswers)].join('\n');
 function choice(answer,pool){
  return shuffle([answer,...shuffle([...new Set(pool)].filter(x=>x&&x!==answer)).slice(0,3)]);
 }
 function row(reference,subject,scope,prompt,answer,extra={}){
  return {reference,subject,scope,prompt,answer,...extra};
 }
 function* textRows(source,data){
  for(const group of data)for(const [en,ja] of (group.cards||[])){
   const subject=source==='ecText'?'英C':'論表',scope=[group.id,group.name].join(' / ');
   const english=A.primary(en),complete=english.replace(/\(([^()]+)\)/g,'$1');
   if(!english||!ja)continue;
   yield row(Q.text(subject,'translation',en,ja),subject,scope,ja,complete,{speech:complete});
   const fields=A.clozeRows(en)[0]?.answers.length;
   if(!fields)continue;
   for(const format of ['cloze','textTyping'])yield row(Q.text(subject,format,en,ja),subject,scope,mask(en),A.lines(en).join('\n'),{
    context:ja, fields, judge:values=>A.clozeMatch(values,en),
    hints:[A.clozeRows(en)[0].answers.map(a=>a[0]).join(' / ')],speech:complete
   });
  }
 }
 function* wordRows(source,data){
  const subject=source==='ecWords'?'英C':'論表';
  const entries=data.flatMap(group=>(group.words||group.cards||[]).map(w=>({group,w:Array.isArray(w)?{word:w[0],meaning:w[1]}:w})))
   .filter(({w})=>w.word&&w.meaning);
  const meanings=entries.map(({w})=>w.meaning);
  for(const {group,w:{word,meaning,hint}} of entries){
   const scope=[group.id,group.name].join(' / '), spoken=A.primary(word);
   yield row(Q.word(subject,'vocab',word,meaning),subject,scope,spoken,meaning,{
    options:()=>choice(meaning,meanings),judge:([value])=>value===meaning,speech:spoken
   });
   for(const format of ['vocabTyping','vocabOral'])yield row(Q.word(subject,format,word,meaning),subject,scope,meaning,A.display(word),{
    judge:([value])=>A.wordMatches(value,word),hints:[hint||spoken[0]],speech:spoken
   });
  }
 }
 function* otherRows(source,data){
  if(source==='wordbook'){
   const words=W.parse(data);
   for(const word of words){
    const subject='単語帳',scope=word.stage+' / '+word.unit;
    const quiz={answer:word.word,accepted:word.acceptedAnswers};
    yield row(Q.wordbook('spelling',{word}),subject,scope,word.practiceMeaning,word.word,{
     judge:([value])=>W.judge(quiz,value,'spelling'),speech:word.word
    });
    yield row(Q.wordbook('choice',{word}),subject,scope,word.practiceMeaning,word.word,{
     options:()=>W.choices(word,words.filter(w=>w.stage===word.stage)).map(w=>w.word),
     judge:([value])=>value===word.word,speech:word.word
    });
    for(const example of word.examples.filter(e=>e.reorder))yield row(Q.wordbook('reorder',{word,prompt:example.japanese,answer:example.english}),subject,scope,example.japanese,example.english,{
     tokens:W.tokens(example.english),
     judge:([value])=>W.judge({answer:example.english,accepted:example.acceptedOrders},value,'reorder'),speech:example.english
    });
   }
   return;
  }
  if(source==='eikenPre'||source==='eikenTwo'){
   const {valid}=YoshiEiken.questions(data,source==='eikenTwo'?'2':'pre2');
   for(const q of valid)yield row(Q.eiken(q.grade,q.id),'英検',q.grade,q.sentence,q.correctWord,{
    options:()=>q.choices,judge:([value])=>value===q.correctWord,
    explanation:[q.translation,q.explanation,...q.choices.map((c,i)=>c+'：'+YoshiEiken.meanings(q)[i])].join('\n')
   });
   return;
  }
  if(source==='writing'){
   for(const q of YoshiWriting.questions(data))yield row(Q.ref(source,'writing',q.id),q.subject,q.lesson,q.japanese,writingModel(q),{
    context:q.requiredExpressions.join(' ／ '),explanation:q.explanation,hints:q.hints,
    judge:([value])=>YoshiWriting.judge(q,value).status==='correct'||null
   });
   return;
  }
  if(source==='studio'){
   for(const g of data)for(const [type,rows] of Object.entries(g.questions||{}))for(const q of Array.isArray(rows)?rows:[]){
    const reference=Q.studio(g,type,q);
    if(!reference)continue;
    yield row(reference,g.subject,'AI教材 / '+g.id+' / '+g.name,type==='cloze'?mask(q.question):q.question,q.answer,{
     explanation:q.translation,...tfOptions(type==='trueFalse',q.answer)
    });
   }
   return;
  }
  for(const q of data)if(q.status==='公開'&&q.question&&q.modelAnswer){
   const reference=source==='qa'?Q.ref(source,'qa',q.id):Q.extension(q);
   yield row(reference,q.subject,q.lesson+' / '+q.part,q.question,writingModel(q),{
    explanation:q.explanation,hints:list(q.hints),...tfOptions(q.type==='True / False',q.modelAnswer)
   });
  }
 }
 function tfOptions(active,answer){
  return active?{options:()=>['True','False'],judge:([value])=>A.normalize(value)===A.normalize(answer)}:{};
 }
 async function load(source){
  if(cache.has(source))return cache.get(source);
  const job=(async()=>{
   const data=await Q.fetchSource(source);
   const rows=source.endsWith('Text')?textRows(source,data):source.endsWith('Words')?wordRows(source,data):otherRows(source,data);
   const pairs=await Promise.all(Array.from(rows,async item=>item.reference?[await Q.key(item.reference),item]:null));
   const found=new Map();
   for(const pair of pairs)if(pair&&!found.has(pair[0]))found.set(...pair);
   return found;
  })();
  cache.set(source,job);
  try{return await job;}catch(error){cache.delete(source);throw error;}
 }
 async function resolve(keys){
  const sources=[...new Set(keys.map(key=>key.split('~')[0]))].filter(s=>Object.hasOwn(Q.sources,s));
  const results=await Promise.allSettled(sources.map(load));
  const catalogs=new Map(sources.map((source,i)=>[source,results[i]]));
  return keys.map(key=>{
   const result=catalogs.get(key.split('~')[0]);
   return {key,item:result?.value?.get(key),error:result?.status==='rejected'};
  });
 }
 return Object.freeze({resolve});
})();
