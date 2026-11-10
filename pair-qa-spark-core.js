/* Spark transitions share the existing Q&A state machine. No Firebase access. */
(function(root){
'use strict';
class QAError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new QAError(code,message);};
const text=v=>String(v??'').trim();
const part=v=>text(v).replace(/^part\s*/i,'').trim();
function asker(room,index=room.state.index){const size=room.rotation==='one'?1:room.rotation==='two'?2:Math.max(1,Math.ceil(room.questions.length/2));return Math.floor(index/size)%2===0?'A':'B';}
function member(room,uid){if(room.hostUid===uid)return 'A';if(room.guestUid===uid)return 'B';fail('permission-denied','この部屋の参加者ではありません');}
function expire(room,now){if(room.expiresAt<=now||!room.guestUid&&now>=room.createdAt+5*60000)fail('not-found','ペアの有効期限が切れました');}
function timeout(room,now){if(room.state.started&&room.duration&&room.state.index<room.questions.length&&!room.reveal&&now>=room.state.startedAt+room.duration*1000){room.reveal={index:room.state.index,ok:false,timeout:true};room.revision++;}return room;}
function view(room,uid,now){
 expire(room,now);const side=member(room,uid),i=room.state.index,current=room.questions[i],isAsker=side===asker(room),revealed=!!room.reveal;
 const visibleHints=current?(current.hints||[]).map((value,index)=>({stage:index+1,text:value})).filter(h=>h.text&&h.stage<=room.hintStage):[];
 const result={code:room.code,subject:'英C',lesson:room.lesson,part:room.part,mode:'textQA',side,guestJoined:!!room.guestUid,count:room.questions.length,rotation:room.rotation||'',duration:room.duration,state:{...room.state},revision:room.revision,reveal:room.reveal?{...room.reveal}:null,hints:visibleHints,hintRequested:!!room.hintRequested,answerOpen:isAsker&&!!room.answerOpen,serverNow:now,asker:asker(room)};
 // No full snapshot, identities, question ID, future questions or answer on B.
 if(current&&(isAsker||revealed))result.question=current.question;
 if(current&&(revealed||isAsker&&room.answerOpen)){result.modelAnswer=current.modelAnswer;result.acceptedAnswers=[...current.acceptedAnswers];}
 if(current&&revealed)result.explanation=current.explanation;
 if(current)result.hasNextHint=current.hints.some((h,index)=>h&&index+1>room.hintStage);
 return result;
}
function act(source,uid,action,data,now){
 const room=structuredClone(source);expire(room,now);
 if(action==='join'){
  if(uid===room.hostUid)return room;
  if(room.guestUid&&room.guestUid!==uid)fail('permission-denied','この部屋は2人が参加済みです');
  room.guestUid=uid;room.revision++;return room;
 }
 const side=member(room,uid);timeout(room,now);
 if(action==='get')return room;
 if(action==='rotation'){
  if(side!=='A'||!room.guestUid||room.rotation||room.state.started)fail('permission-denied','交代設定は生徒Aが開始前に行います');
  if(!['half','one','two'].includes(data.rotation))fail('invalid-argument','交代設定を確認してください');room.rotation=data.rotation;
 }else if(action==='start'){
  if(side!=='A'||!room.guestUid||!room.rotation||room.state.started)fail('permission-denied','生徒Aが役割確認後に開始します');room.state.started=true;room.state.startedAt=now;
 }else{
  if(!room.state.started||room.state.index>=room.questions.length||data.index!==room.state.index)fail('failed-precondition','問題が変わりました。最新の画面を確認してください');
  const isAsker=side===asker(room),q=room.questions[room.state.index];
  if(action==='hint-request'){if(isAsker||room.reveal||!q.hints.some((h,i)=>h&&i+1>room.hintStage))fail('permission-denied','回答中のみヒントをお願いできます');room.hintRequested=true;}
  else{
   if(!isAsker)fail('permission-denied','出題者だけが操作できます');
   if(action==='answer-open'){if(room.reveal)fail('failed-precondition','判定済みです');room.answerOpen=true;}
   else if(action==='hint-next'){
    if(room.reveal)fail('failed-precondition','判定済みです');
    const next=q.hints.findIndex((h,i)=>h&&i+1>room.hintStage);if(next<0)fail('failed-precondition','これ以上のヒントはありません');room.hintStage=next+1;room.hintRequested=false;
   }else if(action==='grade'){
    if(room.reveal||!room.answerOpen||typeof data.ok!=='boolean')fail('failed-precondition','解答を確認してから判定してください');room.reveal={index:room.state.index,ok:data.ok,timeout:false};
   }else if(action==='next'){
    if(!room.reveal)fail('failed-precondition','判定後に次へ進めます');
    const s=room.state,key='streak'+(asker(room)==='A'?'B':'A'),ok=room.reveal.ok;
    s[key]=ok?(s[key]||0)+1:0;s.index++;s.right+=ok?1:0;s.total++;s.startedAt=now;
    room.reveal=null;room.answerOpen=false;room.hintStage=0;room.hintRequested=false;
   }else fail('invalid-argument','操作を確認してください');
  }
 }
 room.revision++;return room;
}

const api={QAError,asker,act,view};if(typeof module==='object')module.exports=api;else root.YoshiPairQASparkCore=api;
})(typeof window==='object'?window:globalThis);
