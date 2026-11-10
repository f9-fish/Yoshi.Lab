/**
 * Yoshi.Lab Reading Plus (True / False・Discussion) 公開用同期
 * 既存の同期関数・トリガーを変更しない。
 *
 * previewReadingPlusPublish() : 公開行のみ検証・プレビュー（読み取り専用）
 * syncReadingPlusPublish()    : 明示承認後に extension_questions.json を更新
 *
 * Script Properties: EXT_GITHUB_REPO, EXT_GITHUB_TOKEN,
 * EXT_GITHUB_BRANCH (default main),
 * EXT_SYNC_APPROVED (true が必要),
 * EXT_ALLOW_EMPTY (true: 全削除を明示許可した時のみ)
 */
const EXT_SPREADSHEET_ID='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
const EXT_HEADER=['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態'];
function extBuild_(values) {
 if(!values.length||EXT_HEADER.some((v,i)=>String(values[0][i]||'').trim()!==v))
   throw Error('AI発展教材下書き：12列ヘッダーを確認してください');
 const out=[],errors=[],seen=new Set(),counts={'True / False':0,'Discussion':0};
 const split=v=>String(v||'').split(/\r?\n|\|\|/).map(x=>x.trim()).filter(Boolean);
 values.slice(1).forEach((r,i)=>{
   const row=i+2;if(String(r[11]||'').trim()!=='公開')return;
   const [id,subject,lesson,part,type,question,answer,accepted,, ,explanation]=r.map(x=>String(x||'').trim());
   const required=[id,subject,lesson,part,type,question,answer,explanation];
   if(required.some(x=>!x)){errors.push('行'+row+'：公開行の必須項目が不足');return;}
   if(seen.has(id)){errors.push('行'+row+'：候補IDが重複 '+id);return;}
   seen.add(id);
   if(subject!=='英C'||!['True / False','Discussion'].includes(type)){errors.push('行'+row+'：科目か種別が不正');return;}
   if(type==='True / False'&&!/^(true|false)$/i.test(answer)){errors.push('行'+row+'：True / Falseの正答を確認');return;}
   const entry={id,subject,lesson,part,type,question,modelAnswer:type==='True / False'?(answer.toLowerCase()==='true'?'True':'False'):answer,acceptedAnswers:split(accepted),explanation,status:'公開'};
   if(JSON.stringify(entry).length>10000){errors.push('行'+row+'：長すぎる問題です');return;}
   counts[type]++;out.push(entry);
 });
 out.sort((a,b)=>a.lesson.localeCompare(b.lesson,'ja',{numeric:true})||a.part.localeCompare(b.part,'ja',{numeric:true})||a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
 return {items:out,errors,counts};
}
function extPreview_(){
 const sh=SpreadsheetApp.openById(EXT_SPREADSHEET_ID).getSheetByName('AI発展教材下書き');
 if(!sh)throw Error('AI発展教材下書きタブがありません');
 return extBuild_(sh.getDataRange().getDisplayValues());
}
function previewReadingPlusPublish(){
 const p=extPreview_();
 console.log('【Reading Plus 公開前チェック／GitHub変更なし】');
 console.log('True / False：'+p.counts['True / False']+'件／Discussion：'+p.counts.Discussion+'件／エラー：'+p.errors.length);
 p.items.forEach(x=>console.log(x.type+' '+x.lesson+'/'+x.part+' '+x.question+' → '+x.modelAnswer));
 p.errors.forEach(x=>console.error(x));
 return p;
}
function syncReadingPlusPublish(){
 const props=PropertiesService.getScriptProperties();
 if(props.getProperty('EXT_SYNC_APPROVED')!=='true')throw Error('公開未承認：EXT_SYNC_APPROVED=true が必要です');
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  const p=extPreview_();if(p.errors.length)throw Error('検証エラーがあるため同期中止');
  if(!p.items.length&&props.getProperty('EXT_ALLOW_EMPTY')!=='true')throw Error('公開0件。空配列公開にはEXT_ALLOW_EMPTY=trueが必要です');
  const repo=props.getProperty('EXT_GITHUB_REPO')||props.getProperty('PAIR_QA_GITHUB_REPO'),
    token=props.getProperty('EXT_GITHUB_TOKEN')||props.getProperty('PAIR_QA_GITHUB_TOKEN'),
    branch=props.getProperty('EXT_GITHUB_BRANCH')||'main';
  if(!repo||!token||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw Error('GitHub接続設定が不足しています');
  const base='https://api.github.com/repos/'+repo+'/contents/extension_questions.json',
    headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const current=UrlFetchApp.fetch(base+'?ref='+encodeURIComponent(branch),{headers,muteHttpExceptions:true});
  const status=current.getResponseCode();
  if(status!==200&&status!==404)throw Error('GitHubの既存JSONが読み込めません：HTTP '+status);
  const body=JSON.stringify(p.items,null,2)+'\n';
  let sha;
  if(status===200){
    const old=JSON.parse(current.getContentText());sha=old.sha;
    const oldContent=Utilities.newBlob(Utilities.base64Decode(String(old.content||'').replace(/\s/g,''))).getDataAsString('UTF-8');
    if(oldContent===body){console.log('変更なし：'+p.items.length+'件公開済み');return;}
  }
  const payload={message:'Publish reviewed Reading Plus questions',content:Utilities.base64Encode(body,Utilities.Charset.UTF_8),branch};
  if(sha)payload.sha=sha;
  const write=UrlFetchApp.fetch(base,{method:'put',headers,contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});
  if(write.getResponseCode()<200||write.getResponseCode()>=300)
    throw Error('Reading Plusの同期に失敗：HTTP '+write.getResponseCode());
  console.log('Reading Plus公開同期成功：'+p.items.length+'件');
 }finally{lock.releaseLock();}
}
