/* Page controller; writing records stay in memory and never enter the XP store. */
(()=>{
 'use strict';
 const W=window.YoshiWriting,$=id=>document.getElementById(id);
 let generation=0,busy=false,pendingUid=null;
 let rows=[],groups=[],subject='',lesson='',set=[],index=0,records=[],hints=new Set(),hintCount=0,answered=false,loading=false;
 const screens=['subjectScreen','lessonScreen','quizScreen','resultScreen'];
 function screen(id){generation++;busy=false;screens.forEach(s=>$(s).hidden=s!==id);$('backSubjects').hidden=id==='subjectScreen';$('backLessons').hidden=!['quizScreen','resultScreen'].includes(id);}
 async function json(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(path,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}}
 async function load(){
  if(loading)return;loading=true;$('reload').hidden=true;
  document.querySelectorAll('[data-writing-subject]').forEach(b=>b.disabled=true);
  $('dataStatus').textContent='問題データを読み込み中…';
  try{
   rows=W.questions(await json('./writing_questions.json'));
   const sources=await Promise.allSettled(['lessons.json','vocabulary.json','ronpyo_text.json','ronpyo_vocab.json'].map(p=>json('./'+p)));
   groups=sources.flatMap(s=>s.status==='fulfilled'&&Array.isArray(s.value)?s.value:[]);
   const missing=sources.some(s=>s.status==='rejected'||!Array.isArray(s.value));
   $('dataStatus').textContent=(rows.length?'公開中の英作文：'+rows.length+'問':'公開中の問題がありません。')+(missing?' 一部の既存Lesson情報を取得できませんでした。':'');
   document.querySelectorAll('[data-writing-subject]').forEach(b=>b.disabled=false);
   if(!$('lessonScreen').hidden&&subject)chooseSubject(subject);
   $('reload').hidden=false;
  }catch(e){$('dataStatus').textContent='英作文問題を読み込めませんでした。データと通信を確認して再読み込みしてください。';$('reload').hidden=false;}
  finally{loading=false;}
 }
 function chooseSubject(value){subject=value;$('subjectLabel').textContent=subject+' / WRITING TRAINING';const list=$('lessonList');list.replaceChildren();
  const lessons=W.lessons(subject,groups,rows);
  if(!lessons.length){const p=document.createElement('p');p.textContent='公開中の問題がありません。';list.append(p);}
  lessons.forEach(item=>{const b=document.createElement('button');b.className='lesson-row';b.disabled=!item.count;const span=document.createElement('span'),name=document.createElement('strong'),count=document.createElement('small');name.textContent=item.label;count.textContent=item.count?item.count+'問 →':'問題未登録';span.append(name,count);b.append(span);b.onclick=()=>start(item.id);list.append(b);});
  screen('lessonScreen');$('lessonScreen').querySelector('h2').focus();
 }
 function start(id){lesson=id;set=rows.filter(q=>q.subject===subject&&q.lesson===lesson);if(!set.length)return;index=0;records=[];screen('quizScreen');renderQuestion();}
 function renderQuestion(){
  generation++;busy=false;answered=false;hints=new Set();hintCount=0;const q=set[index];
  $('quizLesson').textContent=subject+' / '+W.lessonLabel(lesson)+(q.unitName&&subject==='英C'?' / '+q.unitName:'');$('questionCount').textContent=(index+1)+' / '+set.length+'問';$('quizProgress').max=set.length;$('quizProgress').value=index;
  $('prompt').textContent=q.japanese;$('required').textContent=q.requiredExpressions.length?'指定語・指定表現（すべて使用）：'+q.requiredExpressions.join(' ／ '):'指定語なし';
  $('hintContent').hidden=true;$('hintToggle').setAttribute('aria-expanded','false');$('hintToggle').disabled=!q.hints.length;$('hintToggle').textContent=q.hints.length?'💡 ヒント':'ヒント未登録';$('hintList').replaceChildren();$('moreHint').hidden=false;
  $('answer').value='';$('answer').readOnly=false;$('submitAnswer').disabled=true;$('submitAnswer').hidden=false;$('feedback').hidden=true;$('feedback').setAttribute('aria-busy','false');$('prompt').focus();
 }
 function revealHint(){const q=set[index];if(hintCount>=q.hints.length)return;const p=document.createElement('p');const stage=q.hintNumbers?.[hintCount]||hintCount+1;p.textContent='ヒント'+stage+'：'+q.hints[hintCount];$('hintList').append(p);hints.add(stage);hintCount++;$('moreHint').hidden=hintCount>=q.hints.length;}
 function details(target,q,row){
  target.replaceChildren();
  const add=(label,value)=>{const p=document.createElement('p'),b=document.createElement('strong');b.textContent=label+'：';p.append(b,document.createTextNode('\n'+value));target.append(p);};
  add('あなたの解答',row.answer);
  if(row.aiFeedback){const ai=row.aiFeedback;add('AI添削・改善英文',ai.correctedEnglish);add('AIの日本語解説',ai.explanationJapanese);add('良かった点',ai.strengths.join('\n')||'—');add('改善ポイント',ai.improvementPoints.join('\n')||'修正は不要です');}
  add('模範解答',q.modelAnswer);add('許容される別解',q.acceptedAnswers.join('\n')||'別解の登録はありません');add('解説',q.explanation);
  add('指定語・重要表現',row.aiFeedback?(row.aiFeedback.requiredExpressionsUsed===null?'AIでは使用を確定できませんでした':row.aiFeedback.requiredExpressionsUsed?'AI：適切に使用しています':'AI：使い方の確認が必要です'):row.expressions.map(e=>e.expression+'：'+(e.used?'使用しています':'使用を確認できません')).join('\n')||'指定なし');
  add('ヒント使用',row.hintsUsed.length?row.hintsUsed.map(n=>'ヒント'+n).join('・'):'なし');
 }
 $('hintToggle').onclick=()=>{const open=$('hintContent').hidden;$('hintContent').hidden=!open;$('hintToggle').setAttribute('aria-expanded',String(open));if(open&&!hintCount&&!answered)revealHint();};
 $('moreHint').onclick=revealHint;
 $('answer').oninput=()=>{$('submitAnswer').disabled=answered||!W.normalize($('answer').value);};
 function aiCall(user){const review=window.YoshiWritingAI?.review;if(typeof review!=='function')return undefined;const uid=user?.uid||null;return payload=>{if((window.YoshiAccount?.user?.uid||null)!==uid)throw Error('Login changed');return review(payload);};}
 $('answerForm').onsubmit=async e=>{
  e.preventDefault();if(answered||busy||!W.normalize($('answer').value))return;
  const q=set[index],answer=$('answer').value,user=window.YoshiAccount?.user||null,usedHints=[...hints];
  answered=true;busy=true;pendingUid=user?.uid||null;const ticket=++generation;
  $('answer').readOnly=true;$('submitAnswer').disabled=true;$('submitAnswer').hidden=true;
  $('hintToggle').disabled=true;$('moreHint').hidden=true;$('next').hidden=true;
  $('judgment').textContent='AIで添削中…';$('judgmentNote').textContent='英文を確認しています。しばらくお待ちください。';$('answerDetails').replaceChildren();$('feedback').hidden=false;$('feedback').setAttribute('aria-busy','true');
  const outcome=window.YoshiWritingAISupport?await window.YoshiWritingAISupport.grade({question:q,answer,user,judge:W.judge,call:aiCall(user),requestId:globalThis.crypto?.randomUUID?.()||''}):{result:W.judge(q,answer),feedback:null,note:'登録解答で確認しました。'};
  if(ticket!==generation||set[index]?.id!==q.id||(window.YoshiAccount?.user?.uid||null)!==pendingUid)return;
  busy=false;$('feedback').setAttribute('aria-busy','false');
  const row=W.record(q,answer,outcome.result,usedHints,pendingUid);if(outcome.feedback)row.aiFeedback=outcome.feedback;records.push(row);
  $('quizProgress').value=index+1;$('hintToggle').disabled=!hintCount;
  $('judgment').textContent=outcome.result.status==='correct'?'正解！':outcome.result.status==='needs_revision'?'修正が必要':'要確認';
  $('judgmentNote').textContent=outcome.note+(outcome.feedback?'':outcome.result.status==='correct'?' 登録された解答と一致し、指定表現の条件を満たしています。':' 正しい英文の可能性もあります。模範解答・解説と比較し、必要に応じて先生に確認しましょう。');
  details($('answerDetails'),q,row);$('next').textContent=index+1===set.length?'結果を見る →':'次の問題へ →';$('next').hidden=false;$('judgment').focus();
 };
 $('next').onclick=()=>{if(!answered||busy)return;if(index+1<set.length){index++;renderQuestion();}else finish();};
 function finish(){screen('resultScreen');$('resultSummary').textContent=set.length+'問中 正解 '+records.filter(r=>r.status==='correct').length+'問'+(records.some(r=>r.status==='needs_revision')?'・修正が必要 '+records.filter(r=>r.status==='needs_revision').length+'問':'')+'・要確認 '+records.filter(r=>r.status==='review').length+'問';$('review').replaceChildren();records.forEach((row,i)=>{const article=document.createElement('article');article.className='review-item';const h=document.createElement('h3');h.textContent=(i+1)+'. '+set[i].japanese+' / '+(row.status==='correct'?'正解':row.status==='needs_revision'?'修正が必要':'要確認');const body=document.createElement('div');details(body,set[i],row);article.append(h,body);$('review').append(article);});$('resultScreen').querySelector('h2').focus();}
 function leave(action){if((records.length||$('answer').value.trim())&& !confirm('画面を戻ると今回の解答記録が消えます。戻りますか？'))return;records=[];action();}
 document.querySelectorAll('[data-writing-subject]').forEach(b=>b.onclick=()=>chooseSubject(b.dataset.writingSubject));
 $('backSubjects').onclick=()=>leave(()=>{screen('subjectScreen');$('subjectScreen').querySelector('h2').focus();});
 $('backLessons').onclick=()=>leave(()=>chooseSubject(subject));$('retry').onclick=()=>start(lesson);
 $('reload').onclick=load;
 $('download').onclick=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,mode:'writing',records},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='yoshi-writing-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function cancelPending(){if(!busy)return;generation++;busy=false;answered=false;$('answer').readOnly=false;$('submitAnswer').hidden=false;$('submitAnswer').disabled=!W.normalize($('answer').value);$('feedback').hidden=true;$('feedback').setAttribute('aria-busy','false');$('hintToggle').disabled=!set[index]?.hints.length;$('moreHint').hidden=hintCount>=(set[index]?.hints.length||0);}
 window.addEventListener('pagehide',cancelPending);
 function auth(){const a=window.YoshiAccount;if(!a?.authReady)return;if(busy&&(a.user?.uid||null)!==pendingUid)cancelPending();$('authStatus').textContent=a.user?'ログイン中：'+(a.user.displayName||'学習者'):'ログインせずに練習できます';$('login').hidden=!!a.user;}
 $('login').onclick=async()=>{try{await window.YoshiAccount.login();}catch(e){$('authStatus').textContent='ログインできませんでした。もう一度お試しください。';}};
 document.addEventListener('yoshi-auth-ready',auth);auth();void load();
})();
