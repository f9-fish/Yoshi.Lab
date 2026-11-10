/** Add beside WordbookData.gs (copy the complete wordbook-data.js into it).
 * No trigger is installed. Preview before sync. Existing synchronizers are untouched.
 */
function wordbookInspect_(){
 const props=PropertiesService.getScriptProperties(),book=SpreadsheetApp.openById(props.getProperty('WORDBOOK_SPREADSHEET_ID')||'1ON-F_R4CENHAS8fJ-V74ko75qSIJKl_QqRri4MO56lw');
 const sheets=[];
 for(let n=0;n<4;n++){const name='STAGE'+n,s=book.getSheetByName(name);if(!s)throw Error(name+'シートがありません。既存JSONは更新しません');sheets.push({name,values:s.getDataRange().getValues()});}
 const result=YoshiWordbookData.fromSheets(sheets,{scope:props.getProperty('WORDBOOK_SCOPE')||'ALL'});
 result.data.source={type:'google-sheets',label:'WORDBOX Essential 2nd',sheetVerified:true};
 return result;
}
function previewWordbook(){
 const r=wordbookInspect_();r.warnings.forEach(v=>console.warn(v));r.errors.forEach(v=>console.error(v));
 console.log('対象：'+r.data.scope+'／公開単語：'+r.data.words.length+'語／例文：'+r.data.words.reduce((n,w)=>n+w.examples.length,0)+'件／警告：'+r.warnings.length+'件／エラー：'+r.errors.length+'件');return r;
}
function syncWordbook(){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  const p=PropertiesService.getScriptProperties(),repo=p.getProperty('WORDBOOK_GITHUB_REPO'),token=p.getProperty('WORDBOOK_GITHUB_TOKEN'),branch=p.getProperty('WORDBOOK_GITHUB_BRANCH')||'main';
  if(!repo||!token||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw Error('単語帳同期用のScript Propertiesを設定してください');
  const r=previewWordbook();if(r.errors.length)throw Error('データにエラーがあります。既存JSONは変更しません');
  if(!r.data.words.length&&p.getProperty('WORDBOOK_ALLOW_EMPTY')!=='true')throw Error('公開単語が0語です。既存JSONを空にする場合のみWORDBOOK_ALLOW_EMPTY=trueにしてください');
  YoshiWordbookData.parse(r.data);
  const text=JSON.stringify(r.data,null,2)+'\n',content=Utilities.base64Encode(text,Utilities.Charset.UTF_8),url='https://api.github.com/repos/'+repo+'/contents/wordbook.json',headers={Authorization:'Bearer '+token,Accept:'application/vnd.github.object+json','X-GitHub-Api-Version':'2022-11-28'};
  const response=UrlFetchApp.fetch(url+'?ref='+encodeURIComponent(branch),{headers,muteHttpExceptions:true}),status=response.getResponseCode();
  if(status!==200&&status!==404)throw Error('GitHub取得失敗：HTTP '+status);
  const body={message:'Update wordbook.json from WORDBOX spreadsheet',content,branch};
  if(status===200){const old=JSON.parse(response.getContentText());
   // GitHub omits inline content above 1 MB. Compare the Git blob SHA as well.
   const length=Utilities.base64Decode(content).length,blobSha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1,'blob '+length+'\u0000'+text,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
   if(old.sha===blobSha||old.content&&old.content.replace(/\s/g,'')===content){console.log('変更なし');return;}body.sha=old.sha;}
  const saved=UrlFetchApp.fetch(url,{method:'put',headers,contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});
  if(![200,201].includes(saved.getResponseCode()))throw Error('単語帳同期失敗：HTTP '+saved.getResponseCode()+'（既存同期や他ブランチは変更しません）');
  console.log('単語帳JSON更新：'+r.data.words.length+'語／ブランチ：'+branch);
 }finally{lock.releaseLock();}
}
