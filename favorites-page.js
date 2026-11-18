(() => {
 const $=id=>document.getElementById(id),Q=YoshiFavoriteQuestions,F=YoshiFavorites;
 const subject=$('filterSubject'),format=$('filterFormat'),status=$('favoriteStatus');
 let user,version=0,fingerprint='',rows=[],visible=[],queue=[],index=0,answered=false,hint=0,tokens=[],tokenOptions=[];
 function button(label,action){
  const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=action;return node;
 }
 function options(select,entries){
  const selected=select.value;
  select.replaceChildren(new Option('すべて',''),...entries.map(([value,label])=>new Option(label,value)));
  if(entries.some(([value])=>value===selected))select.value=selected;
 }
 function renderList(){
  const list=$('favoriteList');
  visible=rows.filter(({key,item})=>(!subject.value||item?.subject===subject.value)&&(!format.value||key.split('~')[1]===format.value));
  $('reviewAll').disabled=!visible.some(row=>row.item);
  list.replaceChildren();
  for(const row of visible){
   const {item,key,error}=row,card=document.createElement('li'),heading=document.createElement('h2'),meta=document.createElement('p');
   card.className='favorite-panel';
   heading.textContent=item?.prompt||(error?'教材を読み込めませんでした':'公開教材から見つかりませんでした');
   meta.textContent=[item?.subject,Q.formats[key.split('~')[1]],item?.scope].filter(Boolean).join(' · ');
   const actions=document.createElement('div');actions.className='favorite-actions';
   if(item)actions.append(button('この問題を復習',()=>start([row])));
   const remove=button('登録解除',async()=>{
    remove.disabled=true;
    try{await F.change(key,false);}
    catch{status.textContent='登録を解除できませんでした。接続を確認してください。';}
    finally{remove.disabled=false;}
   });
   remove.setAttribute('aria-label','登録解除：'+heading.textContent);
   actions.append(remove);card.append(heading,meta,actions);list.append(card);
  }
  status.textContent=rows.length?(visible.length?visible.length+'件のお気に入り':'条件に合う問題がありません。'):
   'お気に入りはまだありません。学習画面の「☆ お気に入り」で問題を登録できます。';
 }
 function listScreen(){
  window.speechSynthesis?.cancel();queue=[];
  $('favoriteReview').hidden=true;$('favoriteLibrary').hidden=false;
 }
 F.subscribe(async ({state,keys,user:nextUser})=>{
  const ordered=[...keys];
  const signature=JSON.stringify([state,nextUser?.uid,ordered]);
  if(signature===fingerprint&&nextUser===user)return;
  const request=++version;
  fingerprint=signature;
  if(nextUser!==user||state!=='ready'){
   rows=[];listScreen();$('favoriteList').replaceChildren();subject.value='';format.value='';
  }
  user=nextUser;
  $('favoriteLogin').hidden=state!=='guest';
  $('favoriteLibrary').hidden=state!=='ready'||!$('favoriteReview').hidden;
  if(state!=='ready'){
   status.textContent={guest:'Googleでログインすると、お気に入りを利用できます。',loading:'お気に入りを確認中…',error:'お気に入りを取得できませんでした。接続や権限を確認して再読み込みしてください。'}[state];
   return;
  }
  if(queue.some(row=>!keys.has(row.key))){
   const current=queue[index];
   queue=queue.slice(index).filter(row=>keys.has(row.key));index=0;
   if(!queue.length)listScreen();
   else if(queue[0]!==current)renderQuestion();
  }
  rows=rows.filter(row=>keys.has(row.key));
  renderList();
  if(ordered.some(key=>!rows.some(row=>row.key===key)))status.textContent='お気に入りの教材を読み込んでいます…';
  try{const resolved=await YoshiFavoriteCatalog.resolve(ordered);if(request!==version)return;rows=resolved;}
  catch{if(request===version)status.textContent='お気に入りの教材を読み込めませんでした。';return;}
  options(subject,[...new Set(rows.map(r=>r.item?.subject).filter(Boolean))].sort().map(value=>[value,value]));
  options(format,[...new Set(rows.map(r=>r.key.split('~')[1]))].filter(value=>Q.formats[value]).map(value=>[value,Q.formats[value]]));
  renderList();
 });
 $('favoriteLogin').onclick=async()=>{
  try{await window.YoshiAccount.login();}
  catch{status.textContent='Googleログインに失敗しました。もう一度お試しください。';}
 };
 subject.onchange=format.onchange=renderList;
 $('reviewAll').onclick=()=>start(visible.filter(row=>row.item));
 $('backToFavorites').onclick=()=>{listScreen();renderList();$('filterSubject').focus();};
 function start(selection){
  if(!selection.length)return;
  queue=selection;index=0;
  $('favoriteLibrary').hidden=true;$('favoriteReview').hidden=false;
  renderQuestion();
 }
 function renderTokens(available,selected){
  selected.textContent=tokens.map(id=>available.find(token=>token.id===id).text).join(' ');
  for(const b of $('reviewChoices').children)b.disabled=tokens.includes(Number(b.dataset.token));
  $('checkFavorite').disabled=tokens.length!==available.length;
 }
 function renderQuestion(){
  const {item}=queue[index],fields=$('reviewFields'),choices=$('reviewChoices');
  window.speechSynthesis?.cancel();
  answered=false;hint=0;tokens=[];
  $('reviewProgress').textContent=(index+1)+' / '+queue.length+'問';
  $('reviewPrompt').textContent=item.prompt;$('reviewContext').textContent=item.context||'';
  fields.replaceChildren();choices.replaceChildren();
  $('reviewHintText').textContent='';$('reviewJudgment').textContent='';
  $('reviewAnswer').hidden=true;$('nextFavorite').hidden=true;
  $('favoriteSpeak').hidden=!item.speech||!window.speechSynthesis;
  $('favoriteSpeak').disabled=true;
  $('reviewHint').hidden=!item.hints?.length;$('reviewHint').disabled=false;
  $('checkFavorite').disabled=false;
  const options=item.options?.()||[];
  $('checkFavorite').hidden=options.length>0;
  $('checkFavorite').textContent=item.judge?'解答する':'答え・解説を見る';
  if(options.length)for(const value of options)choices.append(button(value,()=>answer([value])));
  else if(item.tokens){
   const available=YoshiWordbookData.shuffledTokens(item.tokens),selected=document.createElement('p');
   tokenOptions=available;
   selected.setAttribute('aria-live','polite');
   fields.append(selected,button('並び順をリセット',()=>{tokens=[];renderTokens(available,selected);}));
   for(const token of available){
    const b=button(token.text,()=>{tokens.push(token.id);renderTokens(available,selected);});
    b.dataset.token=token.id;choices.append(b);
   }
   renderTokens(available,selected);
  }else{
   for(let i=0;i<(item.fields||1);i++){
    const label=document.createElement('label'),input=document.createElement(item.judge?'input':'textarea');
    label.textContent=item.fields?'空欄 '+(i+1):'自分の答え';
    input.required=!!item.judge;input.autocomplete='off';label.append(input);fields.append(label);
   }
  }
  $('reviewPrompt').focus();
 }
 $('reviewForm').onsubmit=event=>{
  event.preventDefault();
  const item=queue[index]?.item;if(!item)return;
  const values=item.tokens
   ?[tokens.map(id=>tokenOptions.find(token=>token.id===id).text).join(' ')]
   :[...$('reviewFields').querySelectorAll('input,textarea')].map(node=>node.value.trim());
  if(item.judge&&values.some(value=>!value))return;
  answer(values);
 };
 function answer(values){
  if(answered)return;
  const {item}=queue[index],ok=item.judge?.(values);
  answered=true;
  $('reviewJudgment').textContent=ok===true?'✓ 正解！':ok===false?'答えを確認しよう':'解答例と見比べよう';
  $('reviewAnswer').textContent=['答え・解答例',item.answer,item.explanation].filter(Boolean).join('\n');
  $('reviewAnswer').hidden=false;
  for(const node of $('reviewForm').querySelectorAll('input,textarea,button'))node.disabled=true;
  $('favoriteSpeak').disabled=false;
  $('nextFavorite').hidden=false;$('nextFavorite').textContent=index+1<queue.length?'次の問題へ':'復習を終了';
  $('nextFavorite').focus();
 }
 $('reviewHint').onclick=()=>{
  const hints=queue[index].item.hints;
  $('reviewHintText').textContent=hints.slice(0,++hint).join(' ／ ');
  $('reviewHint').disabled=hint>=hints.length;
 };
 $('favoriteSpeak').onclick=()=>{
  const utterance=new SpeechSynthesisUtterance(queue[index].item.speech);utterance.lang='en-US';
  speechSynthesis.cancel();speechSynthesis.speak(utterance);
 };
 $('nextFavorite').onclick=()=>{
  if(++index<queue.length){renderQuestion();return;}
  listScreen();renderList();status.textContent='復習が完了しました。';$('filterSubject').focus();
 };
})();
