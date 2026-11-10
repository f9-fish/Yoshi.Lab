/** Additive QA sync. Existing sync functions/triggers are not replaced.
 * Properties: PAIR_QA_GITHUB_REPO, PAIR_QA_GITHUB_TOKEN,
 * PAIR_QA_GITHUB_BRANCH (default main), PAIR_QA_SPREADSHEET_ID (optional).
 */
function pairQABuild_(values) {
 const names=['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','ヒント①','ヒント②','本文根拠・解説','公開状態'];
 if(!values.length)throw new Error('英C本文QAのヘッダーがありません');
 const headers=values[0].map(v=>String(v??'').trim()),indexes=names.map(h=>headers.indexOf(h));
 if(indexes.some(i=>i<0)||names.some(name=>headers.filter(h=>h===name).length!==1))throw new Error('英C本文QAの12列ヘッダーを確認してください');
 const questions=[],errors=[],warnings=[],seen=new Set(),lines=v=>String(v??'').split(/\r?\n|\|\|/).map(s=>s.trim()).filter(Boolean);
 values.slice(1).forEach((row,i)=>{
  if(!row.some(v=>String(v??'').trim()))return;
  const v=indexes.map(index=>String(row[index]??'').trim());if(v[11]!=='公開')return;
  const missing=[0,1,2,3,4,5,6,10].filter(index=>!v[index]);
  if(missing.length){errors.push('行'+(i+2)+'：必須項目不足 '+missing.map(index=>names[index]).join('・'));return;}
  const q={id:v[0],subject:v[1],lesson:v[2].replace(/^lesson\s*/i,'').trim(),part:v[3].replace(/^part\s*/i,'').trim(),number:Number(v[4]),question:v[5],modelAnswer:v[6],acceptedAnswers:lines(v[7]),hints:[v[8],v[9]],explanation:v[10],status:'公開'};
  if(!q.lesson||!q.part||q.subject!=='英C'||!Number.isInteger(q.number)||q.number<1||seen.has(q.id)||q.acceptedAnswers.length>10||Utilities.newBlob(JSON.stringify(q)).getBytes().length>16000){errors.push('行'+(i+2)+'：科目・問題番号・ID重複・長さを確認してください');return;}
  seen.add(q.id);questions.push(q);
 });
 questions.sort((a,b)=>a.lesson.localeCompare(b.lesson,'ja',{numeric:true})||a.part.localeCompare(b.part,'ja',{numeric:true})||a.number-b.number||a.id.localeCompare(b.id));
 const groups=new Map();questions.forEach(q=>{const key=JSON.stringify([q.lesson,q.part]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(q);});
 const catalog=[...groups.values()].map(rows=>({subject:'英C',lesson:rows[0].lesson,part:rows[0].part,count:rows.length,version:Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(rows),Utilities.Charset.UTF_8).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('')}));
 return {questions,catalog,warnings,errors};
}
function previewEnglishTextQA() {
 const props=PropertiesService.getScriptProperties(),id=props.getProperty('PAIR_QA_SPREADSHEET_ID')||'1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
 const sheet=SpreadsheetApp.openById(id).getSheetByName('英C本文QA');if(!sheet)throw new Error('英C本文QAタブがありません');
 const result=pairQABuild_(sheet.getDataRange().getDisplayValues());result.errors.forEach(message=>console.error(message));
 console.log('公開問題：'+result.questions.length+'問／エラー：'+result.errors.length+'件');return result;
}
function syncEnglishTextQA() {
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try {
  const p=PropertiesService.getScriptProperties(),repo=p.getProperty('PAIR_QA_GITHUB_REPO'),token=p.getProperty('PAIR_QA_GITHUB_TOKEN'),branch=p.getProperty('PAIR_QA_GITHUB_BRANCH')||'main';
  if(!repo||!token||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw new Error('Q&A同期用のScript Propertiesを設定してください');
  const result=previewEnglishTextQA();if(result.errors.length)throw new Error('英C本文QAのエラーを修正してください。既存JSONは変更しません');
  if(!result.questions.length&&p.getProperty('PAIR_QA_ALLOW_EMPTY')!=='true')throw new Error('公開問題が0問です。全件非公開の場合のみPAIR_QA_ALLOW_EMPTY=trueを設定してください');
  const base='https://api.github.com/repos/'+repo,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  function api(path,method,payload){const response=UrlFetchApp.fetch(base+path,{method:method||'get',headers,contentType:'application/json',...(payload?{payload:JSON.stringify(payload)}:{}),muteHttpExceptions:true});const code=response.getResponseCode();if(code<200||code>=300)throw new Error('Q&A同期に失敗：HTTP '+code);return JSON.parse(response.getContentText());}
  const files=[['pair_text_qa.json',JSON.stringify(result.questions,null,2)+'\n'],['pair_text_qa_catalog.json',JSON.stringify(result.catalog,null,2)+'\n']];
  const refPath=branch.split('/').map(encodeURIComponent).join('/'),head=api('/git/ref/heads/'+refPath).object.sha;
  const previous=api('/git/commits/'+head);
  let unchanged=true;
  for(const [path,content] of files){const r=UrlFetchApp.fetch(base+'/contents/'+path+'?ref='+encodeURIComponent(head),{headers,muteHttpExceptions:true});if(r.getResponseCode()===404){unchanged=false;continue;}if(r.getResponseCode()!==200)throw new Error('既存Q&A JSONを取得できません：HTTP '+r.getResponseCode());const old=JSON.parse(r.getContentText());if(!old.content||old.content.replace(/\s/g,'')!==Utilities.base64Encode(content,Utilities.Charset.UTF_8))unchanged=false;}
  if(unchanged){console.log('変更なし');return;}
  const tree=api('/git/trees','post',{base_tree:previous.tree.sha,tree:files.map(([path,content])=>({path,mode:'100644',type:'blob',content}))});
  const commit=api('/git/commits','post',{message:'Sync English text Q&A',tree:tree.sha,parents:[head]});
  // Both files move together. If someone advanced the branch, do not force it.
  api('/git/refs/heads/'+refPath,'patch',{sha:commit.sha,force:false});
  console.log('英C本文QAを同期：'+result.questions.length+'問');
 }finally{lock.releaseLock();}
}
