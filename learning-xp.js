/* Canonical per-record XP and repeat policy, shared by live sync and finalization. */
globalThis.YoshiLearningXP=(()=>{
function yoshiRecordXP(r){
 const n=Number(r.total),correct=Number(r.right);
 if(!Number.isFinite(n)||!Number.isFinite(correct)||n<=0||correct<0||correct>n)return 0;
 if(r.dailyV1===true)return Math.max(0,Math.min(500,Number(r.dailyDeltaXP)||0));
 if(r.xpPolicyV3===true&&(r.subject==='英検'||r.subject==='単語帳'))return YoshiPracticeXP.recordXP(r);
 const mode=String(r.xpMode||r.mode||'');
 if(r.xpPolicyV2===true){const rate=r.subject==='英検'&&mode==='eikenChoice'?(r.lesson==='2級'?10:5):mode==='textTyping'?10:mode==='vocabTyping'?7:mode==='vocab'?1:0;return Math.floor(correct)*rate;}
 if(r.subject==='英検'&&mode==='eikenChoice')return Math.min(50,Math.floor(correct)*5);
 // Legacy records lack xpMode: award no XP to old cloze check records;
 // legacy vocab cannot be reliably separated into 4-choice and typing.
 const rate=mode==='textTyping'?7:mode==='vocabTyping'?4:mode==='vocab'?1:0;
 return Math.min(30,Math.floor(correct)*rate);
}
function forEachEarned(rows,visit){
// Count previous attempts for the same subject/lesson/part/mode, including old records.
// Sort chronologically; the new policy never removes XP earned before deployment.
const attempts=new Map();
const ordered=[...rows].sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
for(const r of ordered){if(!r)continue;const n=Number(r.total),correct=Number(r.right);if(!Number.isFinite(n)||!Number.isFinite(correct)||n<=0||correct<0||correct>n)continue;const key=JSON.stringify([String(r.subject||''),String(r.lesson||''),String(r.part||''),String(r.xpMode||r.mode||'')]);
const previous=attempts.get(key)||0;
attempts.set(key,previous+1);
const xp=(r.repeatPolicyV1===true&&previous>=4&&r.completedSet!==true&&!(r.subject==='英検'&&r.xpMode==='eikenChoice'))?0:yoshiRecordXP(r);
visit(r,xp);}
}
 return Object.freeze({forEachEarned});
})();
if(typeof module==='object')module.exports=globalThis.YoshiLearningXP;
