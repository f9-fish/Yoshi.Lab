'use strict';

const {createHash} = require('node:crypto');
const {TYPES,checkInput,checkQuestions} = require('./studio-core.cjs');

const HEADER = ['schema','batchId','questionId','subject','lesson','part','type','question','answer','translation',
 'status','accepted','createdAt','updatedAt','teacherUid','sourceHash','destination','commit','version','requestHash'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (status,message) => Object.assign(new Error(message),{status});
const hash = data => createHash('sha256').update(data).digest('hex');
const numericId = key => parseInt(hash(key).slice(0,8),16)%2147483647+1;
const sheetTitle = id => 'batch_'+id.replaceAll('-','_');
const rowData = rows => rows.map(row=>({values:row.map(stringValue=>({userEnteredValue:{stringValue}}))}));

function prepareBatch(body,uid,now) {
 const {batchId} = body;
 if(typeof batchId!=='string'||!UUID.test(batchId))throw fail(400,'保存バッチIDが不正です');
 const input=checkInput(body);
 if(body.source.length>20000)throw fail(400,'本文を2万文字以内で入力してください');
 const questions=checkQuestions(body.questions);
 const sourceHash=hash(body.source);
 const {subject,lesson,part}=input;
 const fingerprint=hash(JSON.stringify({uid,subject,lesson,part,sourceHash,questions}));
 const rows=TYPES.flatMap(type=>questions[type].map((q,index)=>[
  '1',batchId,batchId+':'+type+':'+(index+1),subject,lesson,part,type,q.question,q.answer,q.translation,
  '要確認','true',now,now,uid,sourceHash,'','','1',fingerprint
 ]));
 const sourceRow=['1',batchId,batchId+':source',subject,lesson,part,'source',body.source,'','',
  '', '',now,now,uid,sourceHash,'','','1',fingerprint];
 return {batchId,title:sheetTitle(batchId),fingerprint,rows,sourceRow};
}

function validSavedBatch(values,batch) {
 if(!Array.isArray(values)||JSON.stringify(values[0])!==JSON.stringify(HEADER)||!([batch.rows.length+1,batch.rows.length+2].includes(values.length)))return false;
 const source=values[batch.rows.length+1];
 if(source&&(!Array.isArray(source)||source.length!==HEADER.length||
  source.some((cell,i)=>i===12||i===13?cell!==values[1][12]:cell!==batch.sourceRow[i])))return false;
 return values.slice(1,batch.rows.length+1).every((row,i)=>Array.isArray(row)&&row.length===HEADER.length&&row.every((cell,j)=>{
  if(Number(row[18])>1&&[7,8,9,10,11,13,16,17,18].includes(j))return typeof cell==='string';
  if(j===12||j===13)return typeof cell==='string'&&Number.isFinite(Date.parse(cell))&&cell===values[1][12];
  return cell===batch.rows[i][j];
 }));
}

function sharedDraftsEnabled(config) {
 return Boolean(config.STUDIO_QUESTION_MASTER_SPREADSHEET_ID||config.STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT);
}

function storageConfig(config) {
 const sheet=config.STUDIO_QUESTION_MASTER_SPREADSHEET_ID;
 const writer=config.STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT;
 if(!/^[\w-]{20,100}$/.test(sheet||'')||!/^\w[\w-]*@[\w-]+\.iam\.gserviceaccount\.com$/.test(writer||'')||
   writer===config.STUDIO_MASTER_READER_SERVICE_ACCOUNT||sheet===config.STUDIO_MASTER_SPREADSHEET_ID||
   sheet===config.STUDIO_MASTER_CANDIDATE_SPREADSHEET_ID||sheet==='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU')
  return null;
 return {sheet,writer};
}

async function authenticatedSheets({config,fetcher,getRuntimeToken},readOnly=false) {
 const settings=storageConfig(config);
 if(!settings)throw fail(503,'問題マスター専用の保存設定を確認してください');
 const {sheet,writer}=settings;
 const signal=AbortSignal.timeout(18000);
 const bearer=await getRuntimeToken();
 if(!bearer)throw fail(502,'問題マスターの実行認証を確認できません');
 const response=await fetcher('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+encodeURIComponent(writer)+':generateAccessToken',{
  method:'POST',signal,redirect:'error',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
  body:JSON.stringify({scope:['https://www.googleapis.com/auth/spreadsheets'+(readOnly?'.readonly':'')],lifetime:'300s'})
 });
 if(!response.ok)throw fail(502,'問題マスターの保存用アカウントを確認してください');
 const {accessToken}=await response.json();
 if(typeof accessToken!=='string'||!accessToken)throw fail(502,'問題マスターの保存認証が取得できません');
 return (path,body)=>fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+sheet+path,{
  method:body?'POST':'GET',signal,redirect:'error',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}

async function checkQuestionMaster(options) {
 try{
  const request=await authenticatedSheets(options,true);
  const response=await request('?fields=spreadsheetId');
  if(!response.ok)throw fail(502,'問題マスターへの閲覧アクセスを確認できません');
  const result=await response.json();
  if(result.spreadsheetId!==options.config.STUDIO_QUESTION_MASTER_SPREADSHEET_ID)
   throw fail(502,'接続した問題マスターを確認できません');
  return {connected:true,readOnly:true};
 }catch(error){
  if(error.status)throw error;
  throw fail(502,'問題マスターの接続を確認できません');
 }
}

async function saveBatch(body,uid,options) {
 const batch=prepareBatch(body,uid,new Date().toISOString());
 try{
  const request=await authenticatedSheets(options);
  const path='/values/'+encodeURIComponent("'"+batch.title+"'!A:T");
  const sheetId=numericId(batch.batchId);
  const rows=rowData([HEADER,...batch.rows,batch.sourceRow]);
  // The unique tab and its complete contents are created atomically in one request.
  let write;
  try{
   write=await request(':batchUpdate',{requests:[
    {addSheet:{properties:{sheetId,title:batch.title,gridProperties:{rowCount:batch.rows.length+3,columnCount:HEADER.length}}}},
    {updateCells:{start:{sheetId,rowIndex:0,columnIndex:0},rows,fields:'userEnteredValue'}}
   ]});
  }catch{/* A lost response may follow a successful commit. Verify by reading. */}
  const verification=await request(path);
  if(verification.ok){
   const {values}=await verification.json();
   if(!validSavedBatch(values,batch))throw fail(409,'同じバッチIDの保存内容が一致しません。管理者に確認してください');
   return {batchId:batch.batchId,savedCount:batch.rows.length,status:'要確認'};
  }
  if(write?.status===403||verification.status===403)throw fail(502,'問題マスターへの編集権限を確認してください');
  throw fail(502,'全問の保存を確認できませんでした。同じバッチを再試行してください');
 }catch(error){
  if(error.status)throw error;
  throw fail(502,'問題マスターに接続できませんでした。同じバッチを再試行してください');
 }
}

async function searchBatches(body,options) {
 const {subject='',lesson='',part='',type='',status='',date='',cursor=''}=body;
 if([subject,lesson,part,type,status,date,cursor].some(value=>typeof value!=='string'||value.length>80)||
    (subject&&!['英C','論表'].includes(subject))||(type&&!TYPES.includes(type))||
    (status&&!['要確認','承認済','公開済'].includes(status))||(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))||
    (cursor&&!/^batch_[a-f0-9_]{36}$/.test(cursor)))throw fail(400,'履歴の検索条件が不正です');
 try{
  const request=await authenticatedSheets(options);
  const metadata=await request('?fields=sheets(properties(title,index))');
  if(!metadata.ok)throw fail(502,'問題マスターの履歴を取得できません');
  const {sheets=[]}=await metadata.json();
  const titles=sheets.map(s=>s.properties).filter(p=>/^batch_[a-f0-9_]{36}$/.test(p.title))
   .sort((a,b)=>b.index-a.index).map(p=>p.title);
  const previous=cursor?titles.indexOf(cursor):-1;
  if(cursor&&previous<0)throw fail(409,'履歴が変わりました。最初から検索してください');
  const candidates=titles.slice(previous+1,previous+9);
  if(!candidates.length)return {batches:[],nextCursor:null};
  const ranges=new URLSearchParams(candidates.map(title=>['ranges',"'"+title+"'!A:T"]));
  const response=await request('/values:batchGet?'+ranges);
  if(!response.ok)throw fail(502,'問題マスターの履歴を取得できません');
  const {valueRanges}=await response.json();
  if(valueRanges?.length!==candidates.length)throw fail(502,'履歴の保存形式を確認できません');
  const batches=[];
  for(const [i,range] of valueRanges.entries()){
   const rows=range.values;
   if(!Array.isArray(rows)||rows.length<2||rows.length>102||JSON.stringify(rows[0])!==JSON.stringify(HEADER)||
      rows.slice(1).some(row=>row.length!==HEADER.length||row[0]!=='1'||!UUID.test(row[1])||
       'batch_'+row[1].replaceAll('-','_')!==candidates[i]))
    throw fail(502,'履歴の保存形式を確認できません');
   const [,batchId,,savedSubject,savedLesson,savedPart]=rows[1];
   const createdAt=rows[1][12];
   if((subject&&subject!==savedSubject)||(lesson&&lesson!==savedLesson)||(part&&part!==savedPart)||
      (date&&date!==new Date(Date.parse(createdAt)+9*3600000).toISOString().slice(0,10)))continue;
   const source=rows.at(-1)[6]==='source'?rows.at(-1)[7]:null;
   const items=rows.slice(1).filter(row=>row[6]!=='source').filter(row=>(!type||row[6]===type)&&(!status||row[10]===status)).map(row=>({
    id:row[2],type:row[6],question:row[7],answer:row[8],translation:row[9],status:row[10],accepted:row[11]==='true',
    updatedAt:row[13],pending:row[16].startsWith('pending:'),destination:row[16].startsWith('pending:')?'':row[16],commit:row[17],version:Number(row[18]),
   }));
   if(items.length)batches.push({batchId,subject:savedSubject,lesson:savedLesson,part:savedPart,createdAt,items,source,version:Number(rows[1][18]),pending:rows.slice(1).some(row=>row[16].startsWith('pending:'))});
  }
  return {batches,nextCursor:titles.length>previous+1+candidates.length?candidates.at(-1):null};
 }catch(error){
  if(error.status)throw error;
  throw fail(502,'問題マスターの履歴に接続できません');
 }
}

async function updateQuestion(body,options) {
 const {batchId,questionId,version,operation}=body;
 if(typeof batchId!=='string'||!UUID.test(batchId)||typeof questionId!=='string'||questionId.length>100||
    !Number.isSafeInteger(version)||version<1||!['edit','approve','return'].includes(operation))
  throw fail(400,'変更する問題と版番号を確認してください');
 try{
  const request=await authenticatedSheets(options);
  const rows=await readRows(request,batchId);
  if(rows.some(row=>row[18]!==String(version)||row[16].startsWith('pending:')))
   throw fail(409,'別の教員による変更または公開処理を確認してください');
  const row=rows.find(row=>row[2]===questionId);
  if(!row)throw fail(404,'変更対象の問題が見つかりません');
  if(row[10]==='公開済')throw fail(409,'公開済みの問題は編集できません');
  if(operation==='edit'){
   if(typeof body.accepted!=='boolean')throw fail(400,'採用設定を確認してください');
   row.splice(7,5,body.question,body.answer,body.translation,'要確認',String(body.accepted));
  }else{
   if(operation==='approve'&&row[11]!=='true')throw fail(400,'採用した問題だけを承認できます');
   row[10]=operation==='approve'?'承認済':'要確認';
  }
  const questions=Object.fromEntries(TYPES.map(type=>[type,rows.filter(r=>r[6]===type)
   .map(r=>({question:r[7],answer:r[8],translation:r[9]}))]));
  const normalized=checkQuestions(questions);
  if(operation==='edit'){
   const index=rows.filter(r=>r[6]===row[6]).indexOf(row);
   const {question,answer,translation}=normalized[row[6]][index];
   row.splice(7,3,question,answer,translation);
  }
  row[13]=new Date().toISOString();
  await writeRows(request,batchId,version,rows);
  return {version:version+1,status:row[10]};
 }catch(error){
  if(error.status)throw error;
  throw fail(502,'変更を確認できません。履歴を再検索してください');
 }
}

async function readRows(request,batchId) {
  const path='/values/'+encodeURIComponent("'"+sheetTitle(batchId)+"'!A:T");
  const response=await request(path);
  if(!response.ok)throw fail(response.status===400?404:502,'変更対象のバッチを取得できません');
  const {values}=await response.json();
  if(!Array.isArray(values)||values.length<2||values.length>102||JSON.stringify(values[0])!==JSON.stringify(HEADER)||
   values.slice(1).some((row,i)=>row.length!==HEADER.length||row[0]!=='1'||row[1]!==batchId||
    !(TYPES.includes(row[6])||(i===values.length-2&&row[6]==='source'))))
   throw fail(502,'バッチの保存形式を確認できません');
  return values.slice(1).filter(row=>row[6]!=='source');
}

async function writeRows(request,batchId,version,rows) {
  for(const r of rows)r[18]=String(version+1);
  const sheetId=numericId(batchId);
  // An explicit, unique metadata ID is a compare-and-set token for this batch version.
  // Sheets validates and applies both requests atomically, including concurrent calls.
  const result=await request(':batchUpdate',{requests:[
   {createDeveloperMetadata:{developerMetadata:{metadataId:numericId('edit:'+batchId+':'+version),
    metadataKey:'batch-version',metadataValue:batchId+':'+version,visibility:'DOCUMENT',location:{sheetId}}}},
   {updateCells:{start:{sheetId,rowIndex:1,columnIndex:0},rows:rowData(rows),fields:'userEnteredValue'}}
  ]});
  if([400,409].includes(result.status))throw fail(409,'更新競合または保存形式の不一致です。履歴を再検索してください');
  if(!result.ok)throw fail(502,'変更を確認できません。履歴を再検索してください');
}

function approvedQuestions(rows) {
 return checkQuestions(Object.fromEntries(TYPES.map(type=>[type,rows.filter(r=>r[6]===type)
  .map(r=>({question:r[7],answer:r[8],translation:r[9]}))])),{allowEmpty:true});
}

async function managedPublication(body,options,preview,selectQuestions) {
 const {batchId,version,expectedSha}=body;
 if(typeof batchId!=='string'||!UUID.test(batchId)||!Number.isSafeInteger(version)||version<1||
  (!preview&&expectedSha!==null&&!(typeof expectedSha==='string'&&/^[a-f0-9]{40}$/.test(expectedSha))))
  throw fail(400,'公開するバッチ・版番号・確認済みの公開先を指定してください');
 try{
  const request=await authenticatedSheets(options);
  const rows=await readRows(request,batchId);
  const current=Number(rows[0][18]);
  if(rows.some(row=>row[18]!==String(current))||current!==version)
   throw fail(409,'バッチが変わりました。履歴を再検索してください');
  const pending=rows.filter(row=>row[16].startsWith('pending:'));
  let approved=pending.length?pending:rows.filter(row=>row[10]==='承認済'&&row[11]==='true');
  if(!approved.length)throw fail(400,'公開候補は承認済みかつ採用した問題に限ります');
  const [,id,,subject,lesson,part]=rows[0];
  if(!pending.length&&selectQuestions){
   const selected=selectQuestions(approvedQuestions(approved));
   approved=approved.filter(row=>(selected[row[6]]||[]).some(item=>item.question===row[7]));
   if(!approved.length)throw fail(409,'すべて公開済みの問題と重複しています');
  }
  const questions=approvedQuestions(approved);
  const plan={batchId:id,subject,lesson,part,questions,version:current};
  if(pending.length){
   const marker=approved[0][16];
   const match=/^pending:(\d+):(none|[a-f0-9]{40})$/.exec(marker);
   if(!match||approved.some(row=>row[16]!==marker||row[10]!=='承認済'||row[11]!=='true'))
    throw fail(502,'公開保留データの形式を確認できません');
   plan.expectedSha=match[2]==='none'?null:match[2];
   plan.operation=batchId+':'+match[1];
   plan.startedAt=approved[0][13];
   if(!preview&&expectedSha!==plan.expectedSha)throw fail(409,'保留中の公開先が一致しません');
  }else if(!preview){
   const marker='pending:'+current+':'+(expectedSha||'none');
   const startedAt=new Date().toISOString();
   for(const row of approved){row[16]=marker;row[13]=startedAt;}
   await writeRows(request,batchId,current,rows);
   Object.assign(plan,{expectedSha,operation:batchId+':'+current,startedAt,version:current+1});
  }
  plan.finish=async(commit)=>{
   for(const row of approved){
    row[10]='公開済';row[16]='studio-content.json';row[17]=commit;row[13]=new Date().toISOString();
   }
   await writeRows(request,batchId,plan.version,rows);
  };
  return plan;
 }catch(error){
  if(error.status)throw error;
  throw fail(502,'公開管理の状態を確認できません。履歴を再検索してください');
 }
}

module.exports={HEADER,checkQuestionMaster,prepareBatch,saveBatch,searchBatches,sharedDraftsEnabled,updateQuestion,managedPublication};
