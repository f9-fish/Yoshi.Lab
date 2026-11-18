(() => {
 const button=document.getElementById('homeUpdatesButton');
 const panel=document.getElementById('homeUpdatesPanel');
 const badge=document.getElementById('homeUpdatesNew');
 const message=document.getElementById('homeUpdatesStatus');
 const list=document.getElementById('homeUpdatesList');
 const storageKey='yoshilab-home-updates-read-version';
 let version='',readVersion='';
 try{readVersion=localStorage.getItem(storageKey)||'';}catch{}

 function renderBadge(){badge.hidden=!version||version===readVersion;}
 function markRead(){
  if(!version)return;
  readVersion=version;
  try{localStorage.setItem(storageKey,version);}catch{}
  renderBadge();
 }
 function placePanel(){
  const rect=button.getBoundingClientRect();
  if(!rect.width){panel.hidePopover();return;}
  const width=Math.min(340,document.documentElement.clientWidth-24);
  panel.style.left=Math.max(12,Math.min(rect.left,document.documentElement.clientWidth-width-12))+'px';
  panel.style.top=Math.max(12,rect.bottom+8)+'px';
 }
 button.addEventListener('click',placePanel);
 panel.addEventListener('toggle',event=>{
  const open=event.newState==='open';
  button.setAttribute('aria-expanded',String(open));
  if(open){placePanel();markRead();}
 });
 const reposition=()=>{if(panel.matches(':popover-open'))placePanel();};
 window.addEventListener('resize',reposition);
 window.addEventListener('scroll',reposition,{passive:true});
 window.addEventListener('storage',event=>{
  if(event.key!==storageKey&&event.key!==null)return;
  readVersion=event.newValue||'';
  renderBadge();
 });

 async function load(){
  try{
   const response=await fetch('./home-updates.json',{cache:'no-cache'});
   if(!response.ok)throw Error('Updates unavailable');
   const data=await response.json();
   if(typeof data.version!=='string'||!data.version.trim()||!Array.isArray(data.entries))throw Error('Invalid updates');
   const entries=data.entries.filter(entry=>entry&&/^\d{4}-\d{2}-\d{2}$/.test(entry.date)&&
    typeof entry.title==='string'&&entry.title.trim()&&typeof entry.description==='string'&&entry.description.trim());
   entries.sort((a,b)=>b.date.localeCompare(a.date));
   for(const entry of entries.slice(0,5)){
    const row=document.createElement('li'),date=document.createElement('time');
    const title=document.createElement('h3'),description=document.createElement('p');
    const [year,month,day]=entry.date.split('-').map(Number);
    date.dateTime=entry.date;date.textContent=year+'年'+month+'月'+day+'日';
    title.textContent=entry.title;description.textContent=entry.description;
    row.append(date,title,description);list.append(row);
   }
   message.hidden=entries.length>0;
   message.textContent='更新情報はありません。';
   if(entries.length)version=data.version;
   if(panel.matches(':popover-open'))markRead();
   renderBadge();
  }catch{message.textContent='更新情報を読み込めませんでした。';}
 }
 void load();
})();
