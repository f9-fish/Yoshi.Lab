/** Optional additive exporter. Does not replace existing sync functions/triggers.
 * Configure Script Properties: WRITING_SPREADSHEET_ID, WRITING_GITHUB_REPO,
 * WRITING_GITHUB_TOKEN. Run syncWritingQuestions manually after review.
 */
function buildWritingQuestions_(values) {
  const headers=['問題ID','科目','Lesson','問題番号','日本語の問題文','指定語・指定表現','模範解答','許容解答','ヒント①','ヒント②','解説','公開状態'];
  if (!values.length) throw new Error('ヘッダーがありません');
  const indexes=headers.map(h=>values[0].indexOf(h));
  if(indexes.some(i=>i<0))throw new Error('英作文問題シートのヘッダーを確認してください');
  const lines=v=>String(v||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const seen=new Set();
  return values.slice(1).filter(row=>String(row[indexes[11]]).trim()==='公開').map(row=>{
    const v=indexes.map(i=>String(row[i]??'').trim());
    const q={id:v[0],subject:v[1],lesson:v[2],number:Number(v[3]),japanese:v[4],requiredExpressions:lines(v[5]),modelAnswer:v[6],acceptedAnswers:lines(v[7]),hints:[v[8],v[9]].filter(Boolean),explanation:v[10],status:'公開'};
    if(!q.id||!['英C','論表'].includes(q.subject)||!q.lesson||!q.japanese||!q.modelAnswer||!q.explanation||!Number.isFinite(q.number)||q.number<1||seen.has(q.id))throw new Error('公開問題の必須項目・番号・ID重複を確認してください：'+q.id);
    seen.add(q.id);return q;
  });
}
function syncWritingQuestions() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties();
    const spreadsheet=p.getProperty('WRITING_SPREADSHEET_ID'),repo=p.getProperty('WRITING_GITHUB_REPO'),token=p.getProperty('WRITING_GITHUB_TOKEN');
    if(!spreadsheet||!repo||!token||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw new Error('英作文同期用のScript Propertiesを設定してください');
    const sheet=SpreadsheetApp.openById(spreadsheet).getSheetByName('英作文問題');
    if(!sheet)throw new Error('英作文問題シートがありません');
    const rows=buildWritingQuestions_(sheet.getDataRange().getDisplayValues());
    const content=Utilities.base64Encode(JSON.stringify(rows,null,2)+'\n',Utilities.Charset.UTF_8);
    const url='https://api.github.com/repos/'+repo+'/contents/writing_questions.json';
    const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    const current=UrlFetchApp.fetch(url+'?ref=main',{headers,muteHttpExceptions:true});
    const code=current.getResponseCode();if(code!==200&&code!==404)throw new Error('GitHubの既存JSONを取得できません：HTTP '+code);
    const body={message:'Update writing_questions.json from 英作文問題',content,branch:'main'};
    if(code===200){const old=JSON.parse(current.getContentText());if(old.content&&old.content.replace(/\s/g,'')===content)return;body.sha=old.sha;}
    const response=UrlFetchApp.fetch(url,{method:'put',headers,contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});
    if(![200,201].includes(response.getResponseCode()))throw new Error('英作文JSONの同期に失敗：HTTP '+response.getResponseCode());
  } finally {lock.releaseLock();}
}
