/* Versioned XP for newly started EIKEN / WORDBOX sessions. No Firebase dependency. */
globalThis.YoshiPracticeXP=(()=>{
 const rates=Object.freeze({STAGE0:Object.freeze({choice:1,spelling:3,reorder:10}),STAGE1:Object.freeze({choice:3,spelling:6,reorder:10}),STAGE2:Object.freeze({choice:3,spelling:6,reorder:10}),STAGE3:Object.freeze({choice:5,spelling:8,reorder:10})});
 function wordbookRate(stage,mode){return Object.hasOwn(rates,stage)&&Object.hasOwn(rates[stage],mode)?rates[stage][mode]:0;}
 function recordXP(r){
  const right=Number(r.right),total=Number(r.total);
  if(!Number.isInteger(right)||!Number.isInteger(total)||total<1||total>10||right<0||right>total)return 0;
  if(r.xpPolicyV3!==true)return 0;
  if(r.subject==='英検'&&r.xpMode==='eikenChoice'&&['準2級','2級'].includes(r.lesson))return right*7;
  if(r.subject==='単語帳'&&r.xpMode==='wordbook')return right*wordbookRate(r.lesson,r.wordbookMode);
  return 0;
 }
 return Object.freeze({wordbookRate,recordXP});
})();
if(typeof module==='object')module.exports=globalThis.YoshiPracticeXP;
