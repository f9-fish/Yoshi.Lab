/* One subscription per page. A question button never changes the active quiz. */
globalThis.YoshiFavorites = (() => {
 const Q=YoshiFavoriteQuestions, listeners=new Set(), buttons=new WeakMap(), pending=new Set();
 let account, user, stop, epoch=0, keys=new Set(), state='loading';
 function notify(){for(const fn of listeners)fn({state,keys,user});}
 function subscribe(fn){
  listeners.add(fn);
  document.addEventListener('yoshi-auth-ready',attach);
  attach();fn({state,keys,user});
  return()=>listeners.delete(fn);
 }
 function attach(){
  const next=window.YoshiAccount;
  if(!next?.watchQuestionFavorites||next===account)return;
  account=next;
  account.subscribe(nextUser=>{
   const version=++epoch;
   stop?.();stop=null;keys=new Set();pending.clear();user=nextUser;
   state=user?'loading':'guest';
   notify();
   if(user)stop=account.watchQuestionFavorites(
    value=>{if(version===epoch){keys=new Set(Object.keys(value||{}).filter(k=>Q.validKey(k)&&value[k]===true));state='ready';notify();}},
    ()=>{if(version===epoch){keys=new Set();state='error';notify();}}
   );
  });
 }
 async function change(key,saved){
  if(state!=='ready'||pending.has(key))return;
  const version=epoch;
  pending.add(key);notify();
  try{await account.setQuestionFavorite(key,saved);}
  finally{if(version===epoch){pending.delete(key);notify();}}
 }
 function show(anchor,reference){
  if(!anchor)return;
  let control=buttons.get(anchor);
  if(!control&&!reference)return;
  if(!control){
   const wrapper=document.createElement('div'), button=document.createElement('button'), message=document.createElement('span');
   wrapper.className='favorite-control';
   button.type='button';button.className='favorite-toggle';message.setAttribute('role','status');
   wrapper.append(button,message);anchor.before(wrapper);
   control={wrapper,button,message,key:null,identity:''};buttons.set(anchor,control);
   subscribe(()=>{
    const saved=keys.has(control.key);
    button.textContent=saved?'★ お気に入り済み':'☆ お気に入り';
    button.setAttribute('aria-pressed',String(saved));
    button.disabled=!control.key||state==='loading'||pending.has(control.key);
   });
   button.onclick=async()=>{
    const id=control.key,version=epoch;
    message.textContent='';
    try{
     if(state==='guest'){await account.login();return;}
     if(state==='error')throw Error('権限または通信を確認してください。');
     await change(id,!keys.has(id));
    }catch{
     if(control.key===id&&epoch===version)message.textContent='お気に入りを更新できませんでした。接続やログイン状態を確認してください。';
    }
   };
  }
  const identity=JSON.stringify(reference);
  if(identity===control.identity)return;
  control.identity=identity;control.key=null;control.wrapper.hidden=!reference;
  control.message.textContent='';
  notify();
  if(reference)Q.key(reference).then(key=>{
   if(control.identity===identity){control.key=key;notify();}
  }).catch(()=>{
   if(control.identity===identity)control.message.textContent='お気に入りはHTTPSで利用できます。';
  });
 }
 return Object.freeze({subscribe,change,show});
})();
