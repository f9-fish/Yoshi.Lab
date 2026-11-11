'use strict';
const {buildSource,settingsFor,hash,MASTER}=require('../core.cjs'),{generateBatch}=require('../engine.cjs'),{planAppend}=require('../append-plan.cjs'),{PRODUCTION_IDS,TABS,fault,checkTarget}=require('./policy.cjs');
function createService({enabled=false,allowedTestIds=[],allowedSourceIds=PRODUCTION_IDS,verifyIdentity,checkTeacher,store,generate,mock=false,clock=()=>Date.now(),dailyLimit=10,testAppendEnabled=false}={}){
 if(enabled&&(!allowedTestIds.length||allowedTestIds.some(id=>PRODUCTION_IDS.includes(id))))throw Error('本番と異なるテスト用IDが必要です');
 if(enabled&&(!store||(!mock&&!store.persistent)||typeof verifyIdentity!=='function'||typeof checkTeacher!=='function'||typeof generate!=='function'))throw Error('認証・永続保存・生成設定が未完了です');
 if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw Error('利用上限が不正です');
 const publicJob=j=>({jobId:j.id,state:j.state,revision:j.revision,sourceHash:j.sourceHash,targetSpreadsheetId:j.targetId,report:j.report?Object.fromEntries(Object.entries(j.report).filter(([k])=>k!=='checkpoint')):null});
 async function quota(owner,kind='generation',limit=dailyLimit){const day=new Date(clock()+9*3600000).toISOString().slice(0,10),key='Q-'+hash([owner,day,kind]).slice(0,32);await store.lock(key,async()=>{const value=await store.read(key)||{count:0};if(!Number.isInteger(value.count)||value.count<0)throw fault(500,'利用管理データが不正です');if(value.count>=limit)throw fault(429,'1日の生成上限です');await store.write(key,{count:value.count+1});});}
 return async({action,authorization,body={}})=>{
  if(!enabled)throw fault(503,'シート連携は無効です。管理者確認が必要です');
  const identity=await verifyIdentity(authorization),teacher=await checkTeacher(identity);if(!teacher?.uid)throw fault(403,'教員権限がありません');const owner=hash(teacher.uid);
  if(action==='enqueue'){
   checkTarget(body.targetSpreadsheetId,allowedTestIds);if(!allowedSourceIds.includes(body.sourceSpreadsheetId)&&!allowedTestIds.includes(body.sourceSpreadsheetId))throw fault(403,'未承認の読み取り元です');
   const source=buildSource(body.master,body.selection),config=settingsFor(source,body.settings),batchId='B-'+hash([source.hash,config.hash]).slice(0,24),id='JOB-'+hash([owner,batchId,body.targetSpreadsheetId]).slice(0,32);
   return store.lock(id,async()=>{let job=await store.read(id);if(!job){await quota(owner,'enqueue',20);job={id,owner,state:'生成待ち',revision:0,sourceHash:source.hash,targetId:body.targetSpreadsheetId,sourceId:body.sourceSpreadsheetId,input:{master:[MASTER,...source.rows.map(r=>[r.id,source.subject,source.unitId,source.part,r.number,r.english,r.japanese,r.memo,r.targets,r.notes])],selection:{subject:source.subject,unitId:source.unitId,part:source.part},settings:Object.fromEntries(Object.entries(config).filter(([key])=>key!=='hash'))},createdAt:new Date(clock()).toISOString(),report:null};await store.write(id,job);}return publicJob(job);});
  }
  const id=body.jobId;if(typeof id!=='string'||!/^JOB-[a-f0-9]{32}$/.test(id))throw fault(400,'ジョブIDが不正です');
  const job=await store.read(id);if(!job||job.owner!==owner)throw fault(404,'ジョブがありません');checkTarget(job.targetId,allowedTestIds);
  if(action==='get')return publicJob(job);
  if(action==='step')return store.lock(id,async()=>{
   if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)throw fault(400,'リビジョンが不正です');
   const current=await store.read(id);if(current.state==='要確認')return publicJob(current);
   if(current.state==='生成中')throw fault(409,'前回の成否が未確定です。自動再生成せず管理者確認が必要です');
   if(body.expectedRevision!==current.revision)return publicJob(current); // lost reply / repeated request
   if(current.state==='エラー'&&body.retryAcknowledged!==true)throw fault(409,'再実行には費用重複の可能性を確認した明示操作が必要です');
   await quota(owner);current.state='生成中';current.revision++;await store.write(id,current);
   try{
    const report=await generateBatch({...current.input,checkpoint:current.report?.checkpoint||null},{generate,maxKindsPerRun:1});current.report=report;current.state=report.state;await store.write(id,current);return publicJob(current);
   }catch{current.state='エラー';await store.write(id,current);throw fault(502,'生成処理を完了できませんでした。ジョブを再取得してください');}
  });
  if(action==='plan'){
   if(job.state!=='要確認'||!job.report||job.report.errors.length)throw fault(409,'全種類の生成完了後に追記を確認してください');
   if(buildSource(body.master,job.input.selection).hash!==job.sourceHash)throw fault(409,'元本文が変更されています。新しいジョブにしてください');
   const plans={};for(const [type,name]of Object.entries(TABS)){
    if(!job.report.results[type]&&!job.report.candidates.some(c=>type==='trueFalse'?['trueFalse','discussion'].includes(c.type):c.type===type))continue;
    const table=body.tables?.[type];if(!table||table.name!==name)throw fault(400,'対象タブのスナップショットが不足しています');
    plans[type]=planAppend({type,headers:table.headers,rows:table.rows},job.report.candidates.filter(c=>type==='trueFalse'?['trueFalse','discussion'].includes(c.type):c.type===type));
   }
   return {jobId:job.id,targetSpreadsheetId:job.targetId,sourceHash:job.sourceHash,plans,testAppendAllowed:testAppendEnabled===true,blocked:{vocabulary:'稼働中の公開判定が未確認のため英単語タブには接続しません'},publishEnabled:false};
  }
  throw fault(404,'未対応の操作です');
 };
}
module.exports={createService};
