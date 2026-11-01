/* Yoshi.Lab temporary maintenance gate. UI access control only; Firebase Rules must enforce data security. */
(async()=>{
 const root=document.getElementById('yl-maintenance');
 const status=root.querySelector('[data-status]');
 const login=root.querySelector('[data-login]');
 const show=(s)=>{status.textContent=s};
 try{
  await import('./account.js');
  const a=window.YoshiAccount;
  if(!a)throw Error('認証システムを読み込めませんでした');
  let checking=false;
  async function check(u){
   if(checking)return;checking=true;
   try{
    if(!u){login.hidden=false;show('教員アカウントでログインすると、開発中の画面を確認できます。');return;}
    login.hidden=true;show('教員権限を確認しています…');
    if(await a.isTeacher()){
     root.remove();document.documentElement.classList.remove('yl-maintenance-active');
    }else{show('現在メンテナンス中です。公開までしばらくお待ちください。');}
   }catch(e){show('教員権限を確認できませんでした。時間をおいて再度お試しください。');console.warn('[Yoshi.Lab] maintenance:',e)}
   finally{checking=false}
  }
  a.subscribe(u=>void check(u));
  login.addEventListener('click',async()=>{login.disabled=true;show('Googleログインを開いています…');try{await a.login()}catch(e){show('ログインできませんでした。もう一度お試しください。');console.warn(e)}finally{login.disabled=false}});
 }catch(e){show('メンテナンス中です。しばらくお待ちください。');console.warn(e)}
})();
