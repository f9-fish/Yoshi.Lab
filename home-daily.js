/* Read-only home-card progress. Uses the same completed days as the Daily page. */
(()=>{
 const summary=document.getElementById('dailyHomeSummary');
 const days=document.getElementById('dailyHomeDays');
 if(!summary||!days)return;
 let attached=false,serial=0,renderedDay='';
 function render(rows,status){
  const progress=YoshiWeeklyDaily.progress(rows),today=YoshiWeeklyDaily.today();
  renderedDay=today;
  summary.textContent=status||'今週 '+progress.count+' / 7日達成';
  days.replaceChildren();
  const labels=['月','火','水','木','金','土','日'];
  progress.dates.forEach((date,i)=>{
   const done=!status&&progress.completed.includes(date);
   const cell=document.createElement('span');cell.className='daily-home-day'+(done?' is-done':'')+(date===today?' is-today':'');
   const label=document.createElement('span');label.className='daily-home-weekday';label.textContent=labels[i];
   const mark=document.createElement('span');mark.className='daily-home-mark';mark.textContent=status?'—':done?'✓':'·';
   cell.setAttribute('aria-label',date+(status?' 記録未取得':done?' 達成':' 未達成'));
   cell.append(label,mark);days.append(cell);
  });
 }
 async function refresh(){
  const a=window.YoshiAccount,user=a?.user,request=++serial;
  if(!user){render([],'ログインで達成状況を表示');return;}
  render([],'今週の達成状況を確認中…');
  try{
   const rows=await a.records();
   if(request!==serial||a.user?.uid!==user.uid)return;
   render(rows);
  }catch(error){
   if(request!==serial||a.user?.uid!==user.uid)return;
   render([],'達成状況を取得できません');
   console.warn('ホームのDaily達成表示:',error);
  }
 }
 function attach(){
  if(attached||!window.YoshiAccount)return;
  attached=true;window.YoshiAccount.subscribe(()=>void refresh());
 }
 render([],'ログインで達成状況を表示');
 document.addEventListener('yoshi-auth-ready',attach);attach();
 window.addEventListener('focus',()=>void refresh());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
 setInterval(()=>{if(!document.hidden&&renderedDay!==YoshiWeeklyDaily.today())void refresh();},30000);
})();
