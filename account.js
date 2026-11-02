import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getDatabase,ref,push,set,get,runTransaction,remove} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
const app=getApps().length?getApp():initializeApp({apiKey:'AIzaSyDhm9zeUsgvF6_lbwcRj57VWXzYPA3LEzM',authDomain:'yoshi-lab-db3eb.firebaseapp.com',databaseURL:'https://yoshi-lab-db3eb-default-rtdb.firebaseio.com',projectId:'yoshi-lab-db3eb',storageBucket:'yoshi-lab-db3eb.firebasestorage.app',messagingSenderId:'543561154900',appId:'1:543561154900:web:b9ba898d1d44a385f848c1'});
const auth=getAuth(app),db=getDatabase(app),provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
let current=null,authReady=false;const listeners=new Set();let lastAccessUid='',lastAccessAt=0;
async function recordLastAccess(u){if(!u||!u.emailVerified)return;const now=Date.now();if(lastAccessUid===u.uid&&now-lastAccessAt<5*60*1000)return;lastAccessUid=u.uid;lastAccessAt=now;try{const profile=await get(ref(db,'studentProfiles/'+u.uid));if(!profile.exists()||auth.currentUser?.uid!==u.uid)return;await set(ref(db,'lastAccess/'+u.uid),{at:Date.now()})}catch(e){console.warn('最終アクセス記録:',e.message)}}
function weekKey(ts){const d=new Date(ts+9*3600000);const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));const year=t.getUTCFullYear();const jan=new Date(Date.UTC(year,0,1));return year+'-W'+String(Math.ceil((((t-jan)/86400000)+1)/7)).padStart(2,'0')}
function yoshiRecordXP(r){
 const n=Number(r.total),correct=Number(r.right);
 if(!Number.isFinite(n)||!Number.isFinite(correct)||n<=0||correct<0||correct>n)return 0;
 if(r.dailyV1===true)return Math.max(0,Math.min(500,Number(r.dailyDeltaXP)||0));
 const mode=String(r.xpMode||r.mode||'');
 // Legacy records lack xpMode: award no XP to old cloze check records;
 // legacy vocab cannot be reliably separated into 4-choice and typing.
 const rate=mode==='textTyping'?7:mode==='vocabTyping'?4:mode==='vocab'?1:0;
 return Math.min(30,Math.floor(correct)*rate);
}

// 学年別シーズンランク。日付はテスト最終日が確定するまで仮設定（JST）。
const seasonWindows=[
 {id:'2026-S1',label:'SEASON 1',start:'2026-04-01T00:00:00+09:00',end:'2026-06-30T23:59:59+09:00'},
 {id:'2026-S2',label:'SEASON 2',start:'2026-07-01T00:00:00+09:00',end:'2026-09-30T23:59:59+09:00'},
 {id:'2026-S3',label:'SEASON 1',start:'2026-10-01T00:00:00+09:00',end:'2026-11-27T23:59:59+09:00'},
 {id:'2026-S4',label:'SEASON 2',start:'2026-11-28T00:00:00+09:00',end:'2027-02-25T23:59:59+09:00'}
];
function activeSeason(ts=Date.now()){return seasonWindows.find(s=>ts>=Date.parse(s.start)&&ts<=Date.parse(s.end))||null}

const api={get user(){return current},get authReady(){return authReady},subscribe(fn){listeners.add(fn);if(authReady)fn(current);return()=>listeners.delete(fn)},async login(){await setPersistence(auth,browserLocalPersistence);try{return await signInWithPopup(auth,provider)}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(e.code))return signInWithRedirect(auth,provider);throw e}},async logout(){return signOut(auth)},async save(entry){if(!current)throw Error('Googleログインが必要です');const u=current;const token=await u.getIdTokenResult();if(token.signInProvider!=='google.com'||!u.emailVerified)throw Error('確認済みのGoogleアカウントでログインしてください');const row={...entry,createdAt:Date.now(),source:'solo'};await set(push(ref(db,'learningRecords/'+u.uid)),row);return row},async startDailyAttempt({dailyDate,dailySubject,attemptNumber}){
 if(!current)throw Error('ログインしてください');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)||!['ec','rp'].includes(dailySubject)||![1,2].includes(attemptNumber))throw Error('挑戦情報が不正です');
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(day!==dailyDate)throw Error('日付が変わりました。再度開始してください');
 const uid=current.uid, slot='daily_'+dailyDate.replaceAll('-','')+'_'+dailySubject+'_'+attemptNumber;
 const path=ref(db,'learningRecords/'+uid+'/'+slot);
 const result=await runTransaction(path,old=>old===null?{dailyV1:true,dailyAttemptStarted:true,dailyCompleted:false,dailyDate,dailySubject,attemptNumber,subject:dailySubject==='ec'?'英C':'論表',lesson:'DAILY',part:dailyDate,mode:'daily',xpMode:'daily',total:0,right:0,dailyScoreXP:0,dailyDeltaXP:0,completedSet:false,createdAt:Date.now(),source:'solo'}:undefined,{applyLocally:false});
 if(!result.committed)throw Error('この挑戦は既に開始されています。画面を再読み込みしてください');
 return slot;
},async finishDailyAttempt(slot,{right,dailyScoreXP,dailyDeltaXP}){
 if(!current||!/^daily_\d{8}_(ec|rp)_[12]$/.test(slot))throw Error('挑戦情報が不正です');
 const uid=current.uid,path=ref(db,'learningRecords/'+uid+'/'+slot);
 const score=Number(right),earned=Number(dailyScoreXP),delta=Number(dailyDeltaXP);
 if(!Number.isInteger(score)||score<0||score>10||![earned,delta].every(x=>Number.isFinite(x)&&x>=0))throw Error('保存する得点が不正です');
 const before=(await get(path)).val();
 if(before?.dailyCompleted===true&&Number(before.total)===10)return {alreadySaved:true};
 if(!before)throw Error('開始記録がありません：'+slot);
 if(before.dailyV1!==true||before.dailyAttemptStarted!==true||before.dailyCompleted!==false||Number(before.total)!==0)
  throw Error('開始記録の状態が不正です：'+slot);
 if(before.dailySubject!==slot.split('_')[2])throw Error('科目が一致しません：'+slot);
 const completed={...before,total:10,right:score,dailyScoreXP:earned,dailyDeltaXP:delta,dailyCompleted:true,completedSet:true,finishedAt:Date.now()};
 try{
  // Replaces a failed transaction-based finish. RTDB validation still applies.
  await set(path,completed);
 }catch(error){
  try{const after=(await get(path)).val();if(after?.dailyCompleted===true&&Number(after.total)===10)return {alreadySaved:true};}
  catch(checkError){console.warn('保存結果確認:',checkError)}
  throw Error('完了記録の書き込みに失敗：'+(error.code||error.message||String(error)));
 }
 const after=(await get(path)).val();
 if(after?.dailyCompleted!==true||Number(after.total)!==10)throw Error('書き込み後の記録確認に失敗：'+slot);
 return {saved:true};
},async resetDailyAttempts({targetUid,dailyDate,dailySubject}){
 if(!current||!await this.isTeacher())throw Error('教員権限が必要です');
 if(typeof targetUid!=='string'||!/^[a-zA-Z0-9_-]{6,128}$/.test(targetUid))throw Error('対象アカウントを選択してください');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)||!['ec','rp','both'].includes(dailySubject))throw Error('リセット条件が不正です');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(dailyDate!==today)throw Error('今日の挑戦だけリセットできます');
 const subjects=dailySubject==='both'?['ec','rp']:[dailySubject];
 let removed=0;
 for(const sub of subjects){for(const n of [1,2]){
  const slot='daily_'+dailyDate.replaceAll('-','')+'_'+sub+'_'+n;
  const target=ref(db,'learningRecords/'+targetUid+'/'+slot);
  const snap=await get(target);
  if(snap.exists()){
   if(snap.val()?.dailyV1!==true)throw Error('対象にデイリー以外の記録があります。中止しました');
   await remove(target);removed++;
  }
 }}
 {try{await this.syncXP({targetUid});}catch(e){throw Error(removed+'件の挑戦記録は削除しましたが、XPの再計算に失敗しました：'+e.message);}}
 return {removed};
},async profile(){if(!current)return null;const snap=await get(ref(db,'studentProfiles/'+current.uid));return snap.val()},
async saveProfile(p){if(!current)throw Error('ログインしてください');const cls=Number(p.classNumber),num=Number(p.studentNumber),name=String(p.name||'').trim();if(!Number.isInteger(cls)||cls<1||cls>5||!Number.isInteger(num)||num<1||num>45||name.length<1||name.length>60)throw Error('入力内容を確認してください');const path=ref(db,'studentProfiles/'+current.uid);const result=await runTransaction(path,old=>old||{classNumber:cls,studentNumber:num,name,createdAt:Date.now()},{applyLocally:false});if(!result.committed)throw Error('登録できませんでした');return result.snapshot.val()},
async isTeacher(){if(!current)return false;const snap=await get(ref(db,'teacherUids/'+current.uid));return snap.val()===true},
async teacherData(){if(!await this.isTeacher())throw Error('教員権限がありません');const [ps,rs]=await Promise.all([get(ref(db,'studentProfiles')),get(ref(db,'learningRecords'))]);return {profiles:ps.val()||{},records:rs.val()||{},lastAccess:(await get(ref(db,'lastAccess'))).val()||{}}},
async updateStudent(uid,p){if(!await this.isTeacher())throw Error('教員権限がありません');const cls=Number(p.classNumber),num=Number(p.studentNumber),name=String(p.name||'').trim();if(!Number.isInteger(cls)||cls<1||cls>5||!Number.isInteger(num)||num<1||num>45||name.length<1||name.length>60)throw Error('入力内容を確認してください');const target=ref(db,'studentProfiles/'+uid);const snap=await get(target);if(!snap.exists())throw Error('生徒が見つかりません');await set(target,{...snap.val(),classNumber:cls,studentNumber:num,name})},
async grade(){if(!current)return null;const s=await get(ref(db,'studentGrades/'+current.uid));return Number(s.val())||null},
async grades(){if(!current)return {};const s=await get(ref(db,'studentGrades'));return s.val()||{}},
async setGrade(grade){if(!current)throw Error('ログインしてください');const n=Number(grade);if(![1,2,3].includes(n))throw Error('学年を選択してください');await set(ref(db,'studentGrades/'+current.uid),n);return n},
getSeason(){return activeSeason()},getSeasons(){return seasonWindows},
async leaderboard(){if(!current)throw Error('ログインしてください');const snap=await get(ref(db,'leaderboard'));return snap.val()||{}},
async syncXP({targetUid}={}){if(!current)return null;const uid=targetUid||current.uid;if(uid!==current.uid&&!await this.isTeacher())throw Error('教員権限が必要です');const profileSnap=await get(ref(db,'studentProfiles/'+uid));const profile=profileSnap.val();if(!profile)return null;const recordsSnap=await get(ref(db,'learningRecords/'+uid));const rows=Object.values(recordsSnap.val()||{});const week=weekKey(Date.now());let total=0,weekly=0,seasonXP=0;const season=activeSeason();
// Count previous attempts for the same subject/lesson/part/mode, including old records.
// Sort chronologically; the new policy never removes XP earned before deployment.
const attempts=new Map();
const ordered=[...rows].sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
for(const r of ordered){const n=Number(r.total),correct=Number(r.right);if(!Number.isFinite(n)||!Number.isFinite(correct)||n<=0||correct<0||correct>n)continue;const key=JSON.stringify([String(r.subject||''),String(r.lesson||''),String(r.part||''),String(r.xpMode||r.mode||'')]);
const previous=attempts.get(key)||0;
attempts.set(key,previous+1);
const xp=(r.repeatPolicyV1===true&&previous>=4&&r.completedSet!==true)?0:yoshiRecordXP(r);
total+=xp;if(weekKey(Number(r.createdAt))===week)weekly+=xp;if(season&&Number(r.createdAt)>=Date.parse(season.start)&&Number(r.createdAt)<=Date.parse(season.end))seasonXP+=xp;}total=Math.min(99999999,total);weekly=Math.min(99999999,weekly);const item={classNumber:Number(profile.classNumber),nickname:'Player-'+Array.from(uid).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,2166136261).toString(36).toUpperCase().padStart(5,'0').slice(-5),name:String(profile.name||'').trim(),totalXP:total,weeklyXP:weekly,weekKey:week,seasonXP:Math.min(99999999,seasonXP),seasonId:season?.id||"none",updatedAt:Date.now()};await set(ref(db,'leaderboard/'+uid),item);return item},
async records(){if(!current)return [];const snap=await get(ref(db,'learningRecords/'+current.uid));return Object.values(snap.val()||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))}};
window.YoshiAccount=api;setPersistence(auth,browserLocalPersistence).catch(e=>console.warn('ログイン保持設定:',e));onAuthStateChanged(auth,u=>{authReady=true;current=u&&u.emailVerified?u:null;listeners.forEach(fn=>fn(current));if(current)void recordLastAccess(current);document.dispatchEvent(new Event('yoshi-auth-ready'))});getRedirectResult(auth).catch(e=>console.warn('Googleログイン:',e));
