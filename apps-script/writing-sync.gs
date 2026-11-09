/** Add this file beside existing synchronizers; do not replace their triggers.
 * Preview first, then run syncWritingQuestions. No trigger is installed here.
 * Script Properties: WRITING_SPREADSHEET_ID (optional override),
 * WRITING_GITHUB_REPO, WRITING_GITHUB_TOKEN, WRITING_GITHUB_BRANCH (default main).
 */
function writingSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('WRITING_SPREADSHEET_ID') || '1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
}
function inspectWritingQuestions_(values) {
  const warnings=[],errors=[],questions=[],seen=new Map();
  if(!Array.isArray(values)||!values.length)throw new Error('英作文問題：ヘッダーがありません');
  const aliases={id:['問題ID'],subject:['科目'],unitId:['単元ID','Lesson'],unitName:['単元名'],number:['問題番号'],japanese:['日本語の問題文'],required:['指定語・表現','指定語・指定表現'],model:['模範解答'],accepted:['許容解答'],hint1:['ヒント①（文型）','ヒント①(文型)','ヒント①'],hint2:['ヒント②（語句）','ヒント②(語句)','ヒント②'],explanation:['解説'],status:['公開状態']};
  const headers=values[0].map(v=>String(v??'').trim());
  const indexes={};
  Object.keys(aliases).forEach(key=>{
    const found=headers.map((h,i)=>aliases[key].includes(h)?i:-1).filter(i=>i>=0);
    if(found.length>1)throw new Error('英作文問題：列の重複 '+aliases[key][0]);
    indexes[key]=found.length?found[0]:-1;
    // Legacy 12-column exports have no unit name. Modern sheets require it.
    if(indexes[key]<0 && !(key==='unitName'&&headers.includes('Lesson')))throw new Error('英作文問題：列がありません '+aliases[key][0]);
  });
  const modern=headers.includes('単元ID');
  const lines=v=>String(v??'').split(/\r?\n|\|\|/).map(s=>s.trim()).filter(Boolean);
  values.slice(1).forEach((row,i)=>{
    const rowNumber=i+2;if(!row.some(v=>String(v??'').trim()))return;
    const v={};Object.keys(indexes).forEach(key=>v[key]=indexes[key]<0?'':String(row[indexes[key]]??'').trim());
    if(v.id){
      const previous=seen.get(v.id);
      if(previous){const message='行'+rowNumber+'：問題ID '+v.id+' が行'+previous.row+'と重複';if(v.status==='公開'&&previous.published)errors.push(message);else warnings.push(message);}
      if(!previous||v.status==='公開')seen.set(v.id,{row:rowNumber,published:v.status==='公開'});
    }
    const required=['id','subject','unitId','number','japanese','model','explanation'];if(modern)required.push('unitName');
    const missing=required.filter(key=>!v[key]);
    if(missing.length){const message='行'+rowNumber+'：必須項目不足 '+missing.map(key=>aliases[key][0]).join('・');warnings.push(message);if(v.status==='公開')errors.push(message);}
    if(v.status!=='公開')return;
    if(missing.length)return;
    if(!['英C','論表'].includes(v.subject)){errors.push('行'+rowNumber+'：科目は英C／論表にしてください');return;}
    const number=Number(v.number);if(!Number.isInteger(number)||number<1){errors.push('行'+rowNumber+'：問題番号は正の整数にしてください');return;}
    const lesson=modern&&v.subject==='論表'&&!v.unitId.endsWith(' '+v.unitName)?v.unitId+' '+v.unitName:v.unitId;
    const q={id:v.id,subject:v.subject,lesson,number,japanese:v.japanese,requiredExpressions:lines(v.required),modelAnswer:v.model,acceptedAnswers:lines(v.accepted),hints:[v.hint1,v.hint2],explanation:v.explanation,status:'公開'};
    if(modern){q.unitId=v.unitId;q.unitName=v.unitName;}
    questions.push(q);
  });
  questions.sort((a,b)=>a.subject.localeCompare(b.subject,'ja')||a.lesson.localeCompare(b.lesson,'ja',{numeric:true})||a.number-b.number||a.id.localeCompare(b.id));
  return {questions,warnings,errors};
}
function buildWritingQuestions_(values) {
  const result=inspectWritingQuestions_(values);
  if(result.errors.length)throw new Error('英作文問題の同期を中止しました。既存JSONは変更しません。\n'+result.errors.join('\n'));
  return result.questions;
}
function previewWritingQuestions() {
  const sheet=SpreadsheetApp.openById(writingSheetId_()).getSheetByName('英作文問題');
  if(!sheet)throw new Error('英作文問題シートがありません');
  const result=inspectWritingQuestions_(sheet.getDataRange().getDisplayValues());
  result.warnings.forEach(message=>console.warn(message));result.errors.forEach(message=>console.error(message));
  console.log('公開問題：'+result.questions.length+'問／警告：'+result.warnings.length+'件／エラー：'+result.errors.length+'件');
  return result;
}
function syncWritingQuestions() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties();
    const repo=p.getProperty('WRITING_GITHUB_REPO'),token=p.getProperty('WRITING_GITHUB_TOKEN'),branch=p.getProperty('WRITING_GITHUB_BRANCH')||'main';
    if(!repo||!token||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw new Error('英作文同期用のScript Propertiesを設定してください');
    const result=previewWritingQuestions();
    if(result.errors.length)throw new Error('英作文問題のエラーを修正してください。既存JSONは変更しません。');
    const rows=result.questions;
    // Empty sheets may be deliberate; require an explicit opt-in before clearing.
    if(!rows.length && p.getProperty('WRITING_ALLOW_EMPTY')!=='true')throw new Error('公開問題が0問です。全件非公開にする場合のみWRITING_ALLOW_EMPTY=trueに設定してください。');
    const content=Utilities.base64Encode(JSON.stringify(rows,null,2)+'\n',Utilities.Charset.UTF_8);
    const url='https://api.github.com/repos/'+repo+'/contents/writing_questions.json';
    const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    const current=UrlFetchApp.fetch(url+'?ref='+encodeURIComponent(branch),{headers,muteHttpExceptions:true});
    const code=current.getResponseCode();if(code!==200&&code!==404)throw new Error('GitHubの既存JSONを取得できません：HTTP '+code);
    const body={message:'Update writing_questions.json from 英作文問題',content,branch};
    if(code===200){const old=JSON.parse(current.getContentText());if(old.content&&old.content.replace(/\s/g,'')===content){console.log('変更なし');return;}body.sha=old.sha;}
    const response=UrlFetchApp.fetch(url,{method:'put',headers,contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});
    if(![200,201].includes(response.getResponseCode()))throw new Error('英作文JSONの同期に失敗：HTTP '+response.getResponseCode());
    console.log('英作文JSONを更新：'+rows.length+'問／ブランチ：'+branch);
  } finally {lock.releaseLock();}
}
