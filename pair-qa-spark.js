/* Spark adapter. All authorization must also be enforced by the proposed RTDB Rules. */
(function(root){
 'use strict';
 const base='pairQaSpark',sdk='https://www.gstatic.com/firebasejs/13.1.0/';
 const fail=(code,message)=>{const e=Error(message);e.code=code;throw e;};
 function encodeQuestionHint(question,hint=''){
  if(typeof question!=='string'||!question.trim()||typeof hint!=='string')throw Error('質問ヒントの形式を確認してください');
  const value=JSON.stringify({kind:'pair-qa-question-v1',question,hint});
  if(value.length>4000)throw Error('質問とヒントが長すぎます');return value;
 }
 function decodeHint(value){
  try{const p=JSON.parse(value);if(p?.kind==='pair-qa-question-v1'&&typeof p.question==='string'&&typeof p.hint==='string')return {question:p.question,hint:p.hint};}catch{}
  return {question:'',hint:typeof value==='string'?value:''};
 }
 function inflate(raw){return {...raw,guestUid:raw.guestUid||'',rotation:raw.rotation||'',reveal:raw.reveal||null,questions:Array.from({length:raw.count},(_,i)=>({question:'',modelAnswer:'',acceptedAnswers:[],explanation:'',hints:[raw.hintMasks[i]&1?'hint':'',raw.hintMasks[i]&2?'hint':'']}))};}
 function pack(room,action){const {questions,...raw}=room;return {...raw,lastAction:action};}
 function factory({db,uid,api,core,loadQuestions,now=Date.now,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]%100000}){
  const path=(area,code,suffix='')=>api.ref(db,`${base}/${area}/${code}${suffix}`);
  const member=r=>r.hostUid===uid||r.guestUid===uid;
  async function read(code){const r=(await api.get(path('rooms',code))).val();if(!r)fail('not-found','部屋がありません');if(!member(r))fail('permission-denied','参加者ではありません');return r;}
  async function display(raw){
   const room=inflate(raw),value=core.view(room,uid,now()),i=room.state.index;
   if(value.ended)return value;
   // Only the current asker, or both participants after grading, may read this snapshot row.
   if(room.state.started&&i<room.count&&(value.side===value.asker||room.reveal)){
    const q=(await api.get(path('questions',room.code,'/'+i))).val();
    if(!q)fail('failed-precondition','問題スナップショットがありません');
    value.question=q.question;
    if(room.reveal||value.answerOpen){value.modelAnswer=q.modelAnswer;value.acceptedAnswers=q.acceptedAnswers||[];}
    if(room.reveal)value.explanation=q.explanation;
   }
   value.hints=[];
   // Old rooms may have no first-stage payload; preserve their available hint controls.
   value.hasNextHint=!!room.questions[i]?.hints.some((h,j)=>h&&j+1>room.hintStage);
   for(let stage=1;stage<=room.hintStage;stage++){
    const text=(await api.get(path('hints',room.code,`/${i}/${stage}`))).val(),hint=decodeHint(text);
    if(hint.question)value.question=hint.question;
    if(hint.hint)value.hints.push({stage,text:hint.hint});
   }
   return value;
  }
  async function safeDisplay(raw){
   try{return await display(raw);}catch(error){
    if(!String(error.code).toLowerCase().includes('permission'))throw error;
    const current=await read(raw.code);if(current.revision===raw.revision)throw error;return display(current);
   }
  }
  async function call(data){
   if(!uid)fail('unauthenticated','匿名ログインが必要です');
   if(data.action==='create'){
    const rows=await loadQuestions(data),firstHints=rows.map(q=>encodeQuestionHint(q.question,q.hints[0]||'')),time=now();
    for(let attempt=0;attempt<8;attempt++){
     const code=String(random()).padStart(6,'0'),count=rows.length;
     const raw={code,hostUid:uid,guestUid:'',lesson:data.lesson,part:data.part,mode:'textQA',duration:data.duration,count,version:data.version,hintMasks:rows.map(q=>1+(q.hints[1]?2:0)).join(''),createdAt:time,expiresAt:time+10800000,revision:0,rotation:'',hintStage:0,hintRequested:false,answerOpen:false,ready:false,lastAction:'create',state:{started:false,index:0,right:0,total:0,startedAt:0,streakA:0,streakB:0}};
     try{await api.set(path('rooms',code),raw);}catch(e){if(String(e.code).toLowerCase().includes('permission'))continue;throw e;}
     const privateRows={},hints={};rows.forEach((q,i)=>{privateRows[i]={index:i,id:q.id,number:q.number,question:q.question,modelAnswer:q.modelAnswer,acceptedAnswers:q.acceptedAnswers,explanation:q.explanation};hints[`${i}/1`]=firstHints[i];if(q.hints[1])hints[`${i}/2`]=q.hints[1];});
     await api.set(path('questions',code),privateRows);if(Object.keys(hints).length)await api.update(path('hints',code),hints);
     await api.update(path('rooms',code),{ready:true});return safeDisplay(await read(code));
    }fail('resource-exhausted','ルームを作れません。Rulesの設定と通信を確認してください。');
   }
   if(!/^0\d{5}$/.test(data.code||''))fail('invalid-argument','参加コードを確認してください');
   if(data.action==='join'){
    // Blind, write-once claim: a non-member cannot read the room to discover its occupants.
    await api.set(path('rooms',data.code,'/guestUid'),uid);return safeDisplay(await read(data.code));
   }
   let raw=await read(data.code);
   if(raw.endedAt&&(data.action==='get'||data.action==='end'))return safeDisplay(raw);
   if(data.action!=='get'||raw.state.started&&raw.duration&&!raw.reveal&&raw.state.index<raw.count&&now()>=raw.state.startedAt+raw.duration*1000){
    const expected=raw.revision;
    const result=await api.runTransaction(path('rooms',data.code),old=>{
     if(!old||data.action!=='end'&&old.revision!==expected)return;
     const r=inflate(old),time=now(),timedOut=r.state.started&&r.duration&&!r.reveal&&r.state.index<r.count&&time>=r.state.startedAt+r.duration*1000;
     const action=timedOut&&data.action!=='end'?'get':data.action,changed=core.act(r,uid,action,data,time);
     if(changed.revision===r.revision)return;
     const next=pack(changed,action);if(action==='start'||action==='next')next.state.startedAt=api.serverTimestamp();if(action==='end')next.endedAt=api.serverTimestamp();return next;
    },{applyLocally:false});
    if(!result.committed){
     if(data.action==='end'){const current=await read(data.code);if(current.endedAt||current.state.index>=current.count)return safeDisplay(current);}
     fail('failed-precondition','状態が更新されました。最新の画面で操作してください');
    }raw=result.snapshot.val();
   }
   return safeDisplay(raw);
  }
  function watch(code,accept,error){
   let stopped=false,serial=Promise.resolve(),timer,latest,ticking=false;
   const stop=api.onValue(path('rooms',code),snap=>{
    const raw=snap.val();latest=raw;serial=serial.catch(()=>{}).then(async()=>{if(stopped)return;if(!raw)fail('not-found','部屋がありません');const value=await safeDisplay(raw);if(!stopped&&latest===raw){accept(value);if(value.ended){stopped=true;stop();clearInterval(timer);}}}).catch(e=>{if(!stopped&&latest===raw)error(e,{stopped:false});});
   },e=>{if(!stopped){stopped=true;clearInterval(timer);error(e,{stopped:true});}});
   // A get applies an expired question's server-checked timeout, even without button presses.
   timer=setInterval(()=>{
    if(stopped||!latest||latest.endedAt||ticking)return;
    if(now()>=latest.expiresAt||!latest.guestUid&&now()>=latest.createdAt+300000){stopped=true;stop();clearInterval(timer);error(Object.assign(Error('部屋の有効期限が切れました'),{code:'not-found'}),{stopped:true});return;}
    if(latest.state.started&&latest.duration&&!latest.reveal&&latest.state.index<latest.count&&now()>=latest.state.startedAt+latest.duration*1000){ticking=true;void call({action:'get',code}).then(v=>{if(!stopped)accept(v);}).catch(e=>{if(!stopped&&!String(e.code).endsWith('failed-precondition'))error(e,{stopped:false});}).finally(()=>{ticking=false;});}
   },1000);
   return ()=>{stopped=true;stop();clearInterval(timer);};
  }
  return {call,watch};
 }
 let connection;
 async function connect(app){
  if(!connection)connection=Promise.all([import(sdk+'firebase-database.js'),import(sdk+'firebase-auth.js')]).then(([api,a])=>{
   const auth=a.getAuth(app),uid=auth.currentUser?.uid;if(!uid||!auth.currentUser.isAnonymous)fail('unauthenticated','匿名ログインが必要です');
   const db=api.getDatabase(app);let offset=0;api.onValue(api.ref(db,'.info/serverTimeOffset'),s=>{offset=Number(s.val())||0;});
   return factory({db,uid,api,core:root.YoshiPairQASparkCore,now:()=>Date.now()+offset,loadQuestions:async data=>{
    const response=await fetch('./pair_text_qa.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('問題を読み込めません');
    const all=await response.json();if(!Array.isArray(all))throw Error('教材形式が不正です');
    const rows=all.filter(q=>q.status==='公開'&&q.subject==='英C'&&q.lesson===data.lesson&&q.part===data.part).sort((a,b)=>a.number-b.number||a.id.localeCompare(b.id));
    if(!rows.length||rows.length>200||![0,10,30,60].includes(data.duration))throw Error('問題数・時間を確認してください');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)))),x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==data.version)fail('failed-precondition','教材が更新されました。再読み込みしてください');return rows;
   }});
  }).catch(e=>{connection=null;throw e;});return connection;
 }
 const api={factory,inflate,pack,encodeQuestionHint,decodeHint,call:async(app,data)=>(await connect(app)).call(data),watch(app,code,accept,error){let cancelled=false,stop;void connect(app).then(c=>{if(!cancelled)stop=c.watch(code,accept,error);}).catch(e=>{if(!cancelled)error(e,{stopped:true});});return ()=>{cancelled=true;stop?.();};}};
 if(typeof module==='object')module.exports=api;else root.YoshiPairQASpark=api;
})(typeof window==='object'?window:globalThis);
