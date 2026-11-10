/**
 * STEP 4: 英C教材の公開前検査 / 検証ブランチへの同期 (追加専用)
 *
 * 対象：
 *  英単語(G列=公開) -> vocabulary.json
 *  英C本文QA(L列=公開) -> pair_text_qa.json / pair_text_qa_catalog.json
 *
 * previewAIMaterialRelease() は完全に読み取り専用。
 * syncAIMaterialReleaseReview() は検証用GitHubブランチの3つのJSONのみ更新。
 * main/masterには書けない。既存同期関数・トリガーは呼び出さない。
 *
 * Script Properties:
 *  AI_RELEASE_REVIEW_BRANCH: 事前に作成した検証ブランチ名（main/master不可）
 *  AI_RELEASE_GITHUB_REPO: owner/repo（省略時 PAIR_QA_GITHUB_REPO）
 *  AI_RELEASE_GITHUB_TOKEN: Contents書込PAT（省略時 PAIR_QA_GITHUB_TOKEN）
 *
 * 重要：検証用ブランチから本番への反映は人がPRレビューして行う。
 *       Q&Aのアプリ側データスナップショットの再生成・再配備は別作業。
 */
const AI_RELEASE_SHEET_ID='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
const AI_RELEASE_VOCAB_HEADERS=['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'];
const AI_RELEASE_QA_HEADERS=['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','ヒント①','ヒント②','本文根拠・解説','公開状態'];
function aiReleaseText_(v){return String(v==null?'':v).trim();}
function aiReleaseRead_(ss,name,headers){
  const sheet=ss.getSheetByName(name);
  if(!sheet)throw Error(name+'が見つかりません');
  const data=sheet.getDataRange().getDisplayValues();
  if(!data.length||headers.some((h,i)=>aiReleaseText_(data[0][i])!==h))throw Error(name+'のヘッダーが一致しません');
  return data;
}
function aiReleaseBuild_(vocabularyRows,qaRows){
  const warnings=[],errors=[],groups=new Map(),wordSeen=new Set(),publishedVocabulary=[];
  vocabularyRows.slice(1).forEach((r,i)=>{
    const row=i+2,status=aiReleaseText_(r[6]);
    if(status!=='公開'){
      if(status && !['下書き','非公開'].includes(status))warnings.push('英単語 '+row+'行：公開設定 '+status+' は出力対象外');
      return;
    }
    const [subject,lesson,part,word,meaning,hint,,reading]=r.map(aiReleaseText_);
    if(subject!=='英C'||!lesson||!part||!word||!meaning){errors.push('英単語 '+row+'行：必須項目が不足または科目が不正');return;}
    const dup=[subject,lesson,part,word.toLocaleLowerCase('en')].join('|');
    if(wordSeen.has(dup)){errors.push('英単語 '+row+'行：公開語句が重複');return;}
    wordSeen.add(dup);
    const key=JSON.stringify([subject,lesson,part]);
    if(!groups.has(key))groups.set(key,{subject,id:lesson,name:part,words:[]});
    const record={word,meaning,hint,reading};
    groups.get(key).words.push(record);publishedVocabulary.push(record);
  });
  const vocabulary=[...groups.values()];
  const questions=[],ids=new Set(),questionKeys=new Set(),numbers=new Set();
  const split=v=>aiReleaseText_(v).split(/\r?\n|\|\|/).map(s=>s.trim()).filter(Boolean);
  qaRows.slice(1).forEach((r,i)=>{
    const row=i+2,status=aiReleaseText_(r[11]);
    if(status!=='公開'){
      if(status && !['下書き','非公開'].includes(status))warnings.push('本文QA '+row+'行：公開状態 '+status+' は出力対象外');
      return;
    }
    const v=r.map(aiReleaseText_);
    const missing=[0,1,2,3,4,5,6,10].filter(n=>!v[n]);
    if(missing.length||v[1]!=='英C'){errors.push('本文QA '+row+'行：必須項目不足・科目不正');return;}
    const number=Number(v[4]),lesson=v[2].replace(/^lesson\s*/i,''),part=v[3].replace(/^part\s*/i,'');
    const key=[v[1],lesson,part,v[5].toLowerCase().replace(/\s+/g,' ')].join('|');
    const numberKey=[v[1],lesson,part,number].join('|');
    const accepted=split(v[7]);
    if(!Number.isInteger(number)||number<1||!lesson||!part||accepted.length>10||ids.has(v[0])||questionKeys.has(key)||numbers.has(numberKey)){
      errors.push('本文QA '+row+'行：問題番号・重複・別解の数を確認');return;
    }
    ids.add(v[0]);questionKeys.add(key);numbers.add(numberKey);
    const q={id:v[0],subject:v[1],lesson,part,number,question:v[5],
      modelAnswer:v[6],acceptedAnswers:accepted,hints:[v[8],v[9]],explanation:v[10],status:'公開'};
    if(JSON.stringify(q).length>12000){errors.push('本文QA '+row+'行：問題が長すぎます');return;}
    questions.push(q);
  });
  questions.sort((a,b)=>a.lesson.localeCompare(b.lesson,'ja',{numeric:true})||
    a.part.localeCompare(b.part,'ja',{numeric:true})||a.number-b.number||a.id.localeCompare(b.id));
  const catalogMap=new Map();
  questions.forEach(q=>{
    const k=JSON.stringify([q.lesson,q.part]);
    if(!catalogMap.has(k))catalogMap.set(k,[]);
    catalogMap.get(k).push(q);
  });
  const catalog=[...catalogMap.values()].map(list=>({
    subject:'英C',lesson:list[0].lesson,part:list[0].part,count:list.length,
    version:Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(list),Utilities.Charset.UTF_8)
      .map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('')
  }));
  return {vocabulary,questions,catalog,errors,warnings,
    counts:{vocabulary:publishedVocabulary.length,qa:questions.length,vocabularyGroups:vocabulary.length,qaParts:catalog.length}};
}
function aiReleaseData_(){
  const ss=SpreadsheetApp.openById(AI_RELEASE_SHEET_ID);
  return aiReleaseBuild_(
    aiReleaseRead_(ss,'英単語',AI_RELEASE_VOCAB_HEADERS),
    aiReleaseRead_(ss,'英C本文QA',AI_RELEASE_QA_HEADERS)
  );
}
function previewAIMaterialRelease(){
  const r=aiReleaseData_();
  console.log('【教材公開前チェック】この処理ではシートやGitHubを変更しません');
  console.log('公開中の英単語 '+r.counts.vocabulary+'件／'+r.counts.vocabularyGroups+'単元');
  console.log('公開中の本文Q&A '+r.counts.qa+'件／'+r.counts.qaParts+' Part');
  console.log('エラー '+r.errors.length+'件／警告 '+r.warnings.length+'件');
  r.errors.forEach(s=>console.error(s));
  r.warnings.slice(0,30).forEach(s=>console.warn(s));
  if(r.errors.length)throw Error('公開対象の教材にエラーがあるため同期不可');
  return {counts:r.counts,errors:r.errors,warnings:r.warnings};
}
function syncAIMaterialReleaseReview(){
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const p=PropertiesService.getScriptProperties();
    const branch=aiReleaseText_(p.getProperty('AI_RELEASE_REVIEW_BRANCH'));
    // Never sync public branch or a GitHub user-supplied path.
    if(!branch||branch==='main'||branch==='master'||!/^[-a-zA-Z0-9_/.]+$/.test(branch)||
       branch.startsWith('/')||branch.endsWith('/')||branch.includes('..')||branch.includes('//'))
      throw Error('検証ブランチが正しく設定されていません。main/masterへの直接同期は禁止です');
    const repo=p.getProperty('AI_RELEASE_GITHUB_REPO')||p.getProperty('PAIR_QA_GITHUB_REPO');
    const token=p.getProperty('AI_RELEASE_GITHUB_TOKEN')||p.getProperty('PAIR_QA_GITHUB_TOKEN');
    if(!repo||!/^[-\w.]+\/[-\w.]+$/.test(repo)||!token)throw Error('GitHub同期設定が不足しています');
    const r=aiReleaseData_();
    if(r.errors.length)throw Error('公開対象の検証エラー '+r.errors.length+'件。同期を中止しました');
    if(!r.vocabulary.length||!r.questions.length)throw Error('公開問題0件の種類があるため同期を中止しました');
    const files=[
      ['vocabulary.json',JSON.stringify(r.vocabulary,null,2)+'\n'],
      ['pair_text_qa.json',JSON.stringify(r.questions,null,2)+'\n'],
      ['pair_text_qa_catalog.json',JSON.stringify(r.catalog,null,2)+'\n']
    ];
    const base='https://api.github.com/repos/'+repo;
    const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'};
    function request(path,method,payload){
      const res=UrlFetchApp.fetch(base+path,{method:method||'get',headers,contentType:'application/json',
        ...(payload?{payload:JSON.stringify(payload)}:{}),muteHttpExceptions:true});
      const status=res.getResponseCode();
      if(status<200||status>=300)throw Error('GitHub検証ブランチ同期エラー HTTP '+status);
      return JSON.parse(res.getContentText());
    }
    const encoded=branch.split('/').map(encodeURIComponent).join('/');
    const head=request('/git/ref/heads/'+encoded).object.sha;
    const commit=request('/git/commits/'+head);
    const tree=request('/git/trees','post',{
      base_tree:commit.tree.sha,
      tree:files.map(([path,content])=>({path,mode:'100644',type:'blob',content}))
    });
    const created=request('/git/commits','post',{
      message:'Review AI-approved vocabulary and text Q&A (unpublished)',tree:tree.sha,parents:[head]
    });
    // GitHub rejects update if branch advanced concurrently. No force pushes.
    request('/git/refs/heads/'+encoded,'patch',{sha:created.sha,force:false});
    console.log('検証ブランチ '+branch+' に英単語'+r.counts.vocabulary+'件とQ&A'+r.counts.qa+'件を同期');
    console.log('mainには反映していません。公開はPRレビュー後に別途行ってください');
  }finally{lock.releaseLock();}
}
