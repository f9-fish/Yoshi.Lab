/* EIKEN data/session logic. No Firebase or DOM dependency. */
globalThis.YoshiEiken=(()=>{
 const grades=Object.freeze({pre2:{label:'準2級',file:'eiken_pre2.json'},'2':{label:'2級',file:'eiken_2.json'}});
 // Separate from the automatically synced question JSON. Future questions may
 // also supply choiceMeanings in the same order as choices.
 const choiceGlossary=Object.freeze({
  accept:'受け入れる',adapt:'適応する／適応させる',announce:'発表する／知らせる',answer:'答える／答え',
  close:'閉める／近い',closed:'閉じた／閉まっている',collected:'集めた／集められた',confirm:'確認する',
  convince:'納得させる／確信させる',delayed:'遅らせた／遅れた',discuss:'話し合う／議論する',encourage:'励ます／促す',encouraging:'励みになる／有望な',
  excited:'わくわくした／興奮した',expand:'広げる／拡大する',explain:'説明する',famous:'有名な',
  grows:'成長する／増える',heavy:'重い',highlights:'強調する／最も目立つ点（複数）',identify:'特定する／見分ける',
  important:'重要な',improve:'改善する／上達する',increase:'増やす／増加する',interested:'興味を持っている',
  introduced:'紹介した／導入した',lent:'貸した（lendの過去形・過去分詞）',minimize:'最小限にする',open:'開ける／開いている',
  opposed:'反対した／反対している',preserve:'保護する／保存する',promote:'促進する／昇進させる',rain:'雨／雨が降る',
  reduce:'減らす',reject:'拒否する／却下する',save:'節約する／救う／保存する',submit:'提出する',
  suggests:'提案する／示唆する',support:'支える／支持する',write:'書く',
  acknowledge:'認める／受け取ったことを知らせる',acquire:'身につける／獲得する',allocate:'割り当てる／配分する',allow:'許す／可能にする',
  anticipate:'予期する／見越す',arrive:'到着する',assess:'評価する／査定する',attend:'出席する／通う',
  avoid:'避ける',belong:'属する',borrow:'借りる',calculate:'計算する',
  choose:'選ぶ',clarify:'明確にする／説明する',collect:'集める／回収する',compare:'比較する',
  compensate:'補償する／埋め合わせる',consider:'よく考える／検討する',continue:'続ける／続く',contribute:'貢献する／寄付する',
  decide:'決める／決心する',deliver:'届ける／配達する',demonstrate:'示す／実演する',depend:'頼る／左右される',
  discover:'発見する',distinguish:'区別する／見分ける',eliminate:'取り除く／排除する',emphasize:'強調する',
  enhance:'高める／向上させる',establish:'設立する／確立する',estimate:'見積もる／推定する',evaluate:'評価する',
  expect:'予期する／期待する',facilitate:'容易にする／促進する',generate:'生み出す／発生させる',implement:'実施する／導入する',
  introduce:'紹介する／導入する',investigate:'調査する',invite:'招待する／誘う',justify:'正当化する',
  maintain:'維持する／保つ',negotiate:'交渉する',notice:'気づく／通知',offer:'申し出る／提供する',
  organize:'企画する／整理する',participate:'参加する',persuade:'説得する',prepare:'準備する',
  protect:'守る／保護する',provide:'提供する',receive:'受け取る',recognize:'認識する／見覚えがある',
  refuse:'断る／拒否する',regulate:'規制する／調整する',remain:'残る／〜のままである',repair:'修理する',
  replace:'取り替える／取って代わる',require:'必要とする／要求する',resolve:'解決する／決意する',respond:'返答する／対応する',
  restrict:'制限する',retain:'保持する／維持する',return:'戻る／返す',reveal:'明らかにする',
  share:'共有する／分け合う',strengthen:'強化する',suggest:'提案する／示唆する',sustain:'維持する／支える',
  transform:'変える／一変させる',verify:'確認する／検証する',withdraw:'撤退する／辞退する／引き出す'
 });
 function meanings(question){
  return question.choices.map((choice,i)=>{
   const supplied=Array.isArray(question.choiceMeanings)&&question.choiceMeanings.length===4?question.choiceMeanings[i]:null;
   const fallback=choiceGlossary[choice.trim().toLowerCase()];
   return typeof supplied==='string'&&supplied.trim()?supplied.trim():typeof fallback==='string'?fallback:'意味未登録';
  });
 }
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
  return {right,total:session.questions.length,xp:Math.min(50,right*5),bestStreak:best};
 }
 return Object.freeze({grades,questions,pick,score,meanings});
})();
