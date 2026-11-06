(()=>{
 const $=id=>document.getElementById(id),core=YoshiEiken;
 let grade='',pool=[],session=null,index=0,loading=0,saving=false,attached=false;
 const pendingKey=uid=>'yoshiEikenPendingV1:'+uid;
 const show=id=>{for(const name of ['gradeScreen','readyScreen','quizScreen','resultScreen'])$(name).hidden=name!==id;};
 const complete=()=>session&&session.answers.length===session.questions.length;
 const active=()=>session&&!session.finished;
 function withTimeout(work,ms){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('通信がタイムアウトしました。再試行しても二重加算されません。')),ms);
   Promise.resolve(work).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
 }
 function pending(){
  const uid=window.YoshiAccount?.user?.uid;if(!uid)return null;
  try{
   const data=JSON.parse(sessionStorage.getItem(pendingKey(uid))||'null');
   if(data?.uid!==uid||!core.grades[data.grade]||typeof data.id!=='string')return null;
   const checked=core.questions(data.questions,data.grade);
   if(checked.invalid||checked.valid.length!==data.questions.length)return null;
   core.score(data);return data;
  }catch{return null;}
 }
 function keepPending(){
  if(!session?.uid||session.saved)return;
  try{sessionStorage.setItem(pendingKey(session.uid),JSON.stringify(session));}
  catch{console.warn('英検の再試行用記録を端末に保持できませんでした');}
 }
 function authUI(){
  const a=window.YoshiAccount,u=a?.user;
  $('authStatus').textContent=u?'✓ ログイン中 · 解答済みの記録とXPを保存します':a?.authReady?'ゲスト学習 · 記録・XPは保存されません':'ログイン状態を確認中…';
  $('login').hidden=!a?.authReady||!!u;
  $('restorePending').hidden=!!session||!pending();
 }
 function attach(){if(attached||!window.YoshiAccount)return;attached=true;window.YoshiAccount.subscribe(authUI);}
 document.addEventListener('yoshi-auth-ready',attach);attach();authUI();
 $('login').onclick=async()=>{try{await window.YoshiAccount.login();}catch(e){$('authStatus').textContent='ログインできません：'+e.message;}};
 async function chooseGrade(selected){
  if(!core.grades[selected])return;
  grade=selected;session=null;pool=[];const request=++loading;
  show('readyScreen');$('gradeLabel').textContent=core.grades[grade].label+' · EIKEN TRAINING';
  $('start').disabled=true;$('dataStatus').textContent='公開中の問題を読み込み中…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch('./'+core.grades[selected].file,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('問題を取得できません（HTTP '+response.status+'）。');
   const data=core.questions(await response.json(),selected);
   if(request!==loading)return;
   pool=data.valid;
   if(!pool.length){$('dataStatus').textContent=data.invalid?'問題データの形式に不備があり、出題できません。':'公開中の問題がありません';return;}
   $('dataStatus').textContent=pool.length<10?`公開中は${pool.length}問です。10問に満たないため、今回は${pool.length}問で出題します。`:`公開中${pool.length}問から、ランダムに10問を出題します。`;
   if(data.invalid)$('dataStatus').textContent+=` 形式に不備のある${data.invalid}問は出題から除外しました。`;
   $('start').disabled=false;
  }catch(e){if(request===loading)$('dataStatus').textContent='読み込みに失敗しました。再読み込みをお試しください。'+(e.name==='AbortError'?'（タイムアウト）':e.message);}
  finally{clearTimeout(timer);}
 }
 document.querySelectorAll('[data-grade]').forEach(button=>button.onclick=()=>chooseGrade(button.dataset.grade));
 $('reloadData').onclick=()=>chooseGrade(grade);
 $('backGrades').onclick=()=>{loading++;show('gradeScreen');authUI();};
 $('start').onclick=()=>{
  if(!pool.length||$('start').disabled)return;
  session={id:crypto.randomUUID(),xpPolicyV2:true,grade,questions:core.pick(pool),answers:[],uid:window.YoshiAccount?.user?.uid||null,startedAt:Date.now(),saved:false};
  index=0;show('quizScreen');renderQuestion();authUI();
 };
 function renderQuestion(){
  const q=session.questions[index];$('quizGrade').textContent=core.grades[session.grade].label;
  $('questionCount').textContent=`QUESTION ${index+1} / ${session.questions.length}`;
  $('quizProgress').max=session.questions.length;$('quizProgress').value=index;
  $('sentence').textContent=q.sentence;$('choices').replaceChildren();$('feedback').hidden=true;$('next').hidden=true;
  q.choices.forEach((choice,i)=>{
   const button=document.createElement('button');button.className='choice';button.type='button';
   const number=document.createElement('span');number.className='choice-number';number.textContent=i+1;
   const text=document.createElement('span');text.className='choice-word';text.textContent=choice;button.append(number,text);
   button.onclick=()=>answer(i+1);$('choices').append(button);
  });
  $('sentence').focus();
 }
 function answer(number){
  if(!session||session.answers.length!==index)return;
  const q=session.questions[index],ok=number===q.answer;session.answers.push(number);
  const meanings=core.meanings(q);
  [...$('choices').children].forEach((button,i)=>{
   button.disabled=true;if(i+1===q.answer)button.classList.add('correct');else if(i+1===number)button.classList.add('wrong');
   const meaning=document.createElement('span');meaning.className='choice-meaning';meaning.textContent='（'+meanings[i]+'）';button.append(meaning);
  });
  $('judgment').textContent=ok?'✓ 正解！':'✕ 不正解';
  $('correctAnswer').textContent='正解：'+q.answer+'. '+q.choices[q.answer-1];
  $('translation').textContent='和訳：'+q.translation;$('explanation').textContent='解説：'+q.explanation;
  $('feedback').hidden=false;$('next').hidden=false;$('next').textContent=index===session.questions.length-1?'結果を見る →':'次の問題へ →';
 }
 $('next').onclick=()=>{
  if(!session||session.answers.length!==index+1)return;
  if(index===session.questions.length-1)finishSession();
  else{index++;renderQuestion();}
 };
 function finishSession(){
  if(!session||session.finished||!session.answers.length)return;
  session.plannedTotal=session.questions.length;
  session.completedSet=session.answers.length===session.plannedTotal;
  session.questions=session.questions.slice(0,session.answers.length);
  session.durationSeconds=Math.max(0,(Date.now()-session.startedAt)/1000);
  keepPending();renderResult();void save();
 }
 $('quit').onclick=()=>{
  if(!session||session.finished)return;
  const answered=session.answers.length;
  if(!confirm(answered?'ここまでの解答結果と正解分のXPで終了しますか？':'まだ解答していないため記録・XPは保存されません。終了しますか？'))return;
  if(answered)finishSession();
  else{session=null;show('gradeScreen');authUI();}
 };
 function renderResult(){
  session.finished=true;
  show('resultScreen');const result=core.score(session);
  $('reviewTitle').textContent=session.completedSet===false?'解答した問題の振り返り':'全問題の振り返り';
  $('resultScore').textContent=result.right+' / '+result.total+' 問正解';
  $('completionStatus').textContent=session.completedSet===false?
   `途中終了：${session.plannedTotal}問中${result.total}問に解答。未解答の${session.plannedTotal-result.total}問は採点しません。`:'全問題に解答しました。';
  $('resultXP').textContent=session.uid?'獲得予定 +'+result.xp+' XP':'学習スコア '+result.xp+' XP相当（ゲスト）';
  $('saveStatus').textContent='結果を確認しています…';$('retrySave').hidden=true;$('setupProfile').hidden=true;$('review').replaceChildren();
  session.questions.forEach((q,i)=>{
   const ok=q.answer===session.answers[i],card=document.createElement('article');card.className='review-item';
   const heading=document.createElement('h3');heading.textContent=(ok?'✓ ':'✕ ')+(i+1)+'. '+q.sentence;
   const meanings=core.meanings(q),choices=document.createElement('ol');q.choices.forEach((choice,j)=>{
    const li=document.createElement('li');li.textContent=choice;
    const meaning=document.createElement('span');meaning.className='choice-meaning';meaning.textContent='（'+meanings[j]+'）';li.append(meaning);choices.append(li);
   });
   const response=document.createElement('p');response.className='response-label';response.textContent='あなたの回答：'+session.answers[i]+'. '+q.choices[session.answers[i]-1];
   const correct=document.createElement('p');correct.className='answer-label';correct.textContent='正解：'+q.answer+'. '+q.choices[q.answer-1];
   const translation=document.createElement('p');translation.textContent='和訳：'+q.translation;
   const explanation=document.createElement('p');explanation.textContent='解説：'+q.explanation;
   card.append(heading,choices,response,correct,translation,explanation);$('review').append(card);
  });
 }
 async function save(){
  if(saving||!complete())return;
  const a=window.YoshiAccount,uid=a?.user?.uid;
  if(!session.uid){$('saveStatus').textContent='ゲスト学習のため記録・XPは保存されません。保存するにはログインして新しいセットに挑戦してください。';return;}
  if(uid!==session.uid){$('saveStatus').textContent='開始時のアカウントでログインすると保存を再試行できます。';$('retrySave').hidden=false;return;}
  saving=true;$('retrySave').disabled=true;$('saveStatus').textContent='記録とXPを保存中…';
  const currentSession=session,result=core.score(currentSession);
  try{
   if(!currentSession.saved){
    const saved=await withTimeout(a.saveEikenResult({sessionId:currentSession.id,grade:core.grades[currentSession.grade].label,
     right:result.right,total:result.total,bestStreak:result.bestStreak,xpPolicyV2:currentSession.xpPolicyV2===true,completedSet:currentSession.completedSet!==false,
     durationSeconds:currentSession.durationSeconds||0}),12000);
    currentSession.awardedXP=saved.xpMode==='eikenChoice'?(saved.xpPolicyV2===true?saved.right*(saved.lesson==='2級'?10:5):Math.min(50,saved.right*5)):Math.min(30,saved.right);
    currentSession.saved=true;
   }
   if(a.user?.uid!==currentSession.uid)throw Error('ログイン状態が変わりました。開始時のアカウントで再試行してください。');
   const updated=await withTimeout(a.syncXP(),8000);
   if(a.user?.uid!==currentSession.uid)throw Error('ログイン状態が変わりました');
   $('resultXP').textContent=(updated?'獲得 +':'記録済み・反映予定 +')+(currentSession.awardedXP??result.xp)+' XP';
   $('saveStatus').textContent=updated?'記録・XPを保存しました。累計XP・ランキングに反映されます。':'記録は保存済みです。XP反映にはMY PAGEでプロフィール登録が必要です。';
   $('setupProfile').hidden=!!updated;$('retrySave').hidden=true;
   if(!currentSession.celebrated){showXPResult(updated?(currentSession.awardedXP??result.xp):0,updated?.totalXP||0,updated?'今回の学習で獲得したXPです。累計XPに反映されました。':'記録は保存済みです。XP反映にはMY PAGEでプロフィール登録が必要です。');currentSession.celebrated=true;}
   try{const data=JSON.parse(sessionStorage.getItem(pendingKey(currentSession.uid))||'null');if(data?.id===currentSession.id)sessionStorage.removeItem(pendingKey(currentSession.uid));}catch{}
  }catch(e){
   keepPending();$('retrySave').hidden=false;
   $('saveStatus').textContent=(currentSession.saved?'記録は保存済みですが、XPの同期を確認できません。':'保存を確認できません。')+'再試行してください。'+e.message;
  }finally{saving=false;$('retrySave').disabled=false;}
 }
 function showXPResult(earned,totalXP,message){
  let level=1,need=100,remaining=Math.max(0,Number(totalXP)||0);
  while(remaining>=need&&level<10000){remaining-=need;level++;need+=50;}
  $('xpCelebrationEarned').textContent='+'+earned+' XP';$('xpCelebrationLevel').textContent='LEVEL '+level;
  $('xpCelebrationMessage').textContent=message;$('xpCelebrationOverlay').classList.add('open');$('xpCelebrationClose').focus();
 }
 function closeXPResult(){$('xpCelebrationOverlay').classList.remove('open');$('again').focus();}
 $('xpCelebrationClose').onclick=closeXPResult;
 $('xpCelebrationOverlay').onclick=e=>{if(e.target===$('xpCelebrationOverlay'))closeXPResult();};
 document.addEventListener('keydown',e=>{
  if(!$('xpCelebrationOverlay').classList.contains('open'))return;
  if(e.key==='Escape')closeXPResult();
  if(e.key==='Tab'){e.preventDefault();$('xpCelebrationClose').focus();}
 });
 $('retrySave').onclick=()=>void save();
 $('restorePending').onclick=()=>{const data=pending();if(!data)return;session=data;grade=data.grade;renderResult();void save();};
 function leaveResult(action){
  if(saving){$('saveStatus').textContent='保存処理が完了するまでお待ちください。';return;}
  if(session?.uid&&!session.saved&&!confirm('保存を確認できていません。今回の結果を残したまま次へ進みますか？'))return;
  session=null;action();authUI();
 }
 $('again').onclick=()=>leaveResult(()=>void chooseGrade(grade));
 $('resultGrades').onclick=()=>leaveResult(()=>show('gradeScreen'));
 window.addEventListener('beforeunload',e=>{if(active()||saving){e.preventDefault();e.returnValue='';}});
})();
