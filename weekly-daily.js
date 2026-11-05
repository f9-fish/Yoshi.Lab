/* Shared weekly Daily progress and derived bonuses. No network or storage. */
globalThis.YoshiWeeklyDaily=(()=>{
 const launchWeek='2026-11-02'; // New rewards start with this week's saved completions.
 const milestones=Object.freeze([{days:3,xp:100},{days:5,xp:200},{days:7,xp:500}].map(Object.freeze));
 const today=(now=Date.now())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 function dateValue(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const ts=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(ts)&&new Date(ts).toISOString().slice(0,10)===day?ts:null;
 }
 function addDays(day,n){return new Date(dateValue(day)+n*86400000).toISOString().slice(0,10)}
 function monday(day){const ts=dateValue(day);return addDays(day,-((new Date(ts).getUTCDay()+6)%7))}
 function completedDays(rows,now=Date.now()){
  const limit=today(now);
  return [...new Set(rows.filter(r=>r.dailyV1===true&&r.dailyCompleted===true&&Number(r.total)===10&&
   Number.isInteger(Number(r.right))&&Number(r.right)>=0&&Number(r.right)<=10&&
   ['ec','rp'].includes(r.dailySubject)&&dateValue(r.dailyDate)!==null&&r.dailyDate<=limit).map(r=>r.dailyDate))].sort();
 }
 function bonuses(rows,now=Date.now()){
  const weeks=new Map();
  for(const day of completedDays(rows,now)){
   const week=monday(day);if(week<launchWeek)continue;
   if(!weeks.has(week))weeks.set(week,[]);weeks.get(week).push(day);
  }
  const result=[];
  for(const [week,days] of weeks)for(const milestone of milestones){
   if(days.length>=milestone.days)result.push({week,days:milestone.days,xp:milestone.xp,
    earnedAt:Date.parse(days[milestone.days-1]+'T00:00:00+09:00')});
  }
  return result;
 }
 function progress(rows,now=Date.now()){
  const day=today(now),week=monday(day),dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const completed=completedDays(rows,now).filter(d=>d>=week&&d<=dates[6]);
  const bonusXP=bonuses(rows,now).filter(b=>b.week===week).reduce((n,b)=>n+b.xp,0);
  return {week,dates,completed,count:completed.length,bonusXP};
 }
 return Object.freeze({milestones,launchWeek,today,monday,completedDays,bonuses,progress});
})();
