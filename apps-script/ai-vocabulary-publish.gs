/**
 * Yoshi.Lab AI単語の公開前プレビュー＆追加専用GitHub同期
 * 既存の同期処理を上書き・自動実行しない。
 *
 * ① previewEnglishVocabularyPublish() で公開語と要検証項目を確認
 * ② 英単語G列を「公開」にした後、レビューしてから公開を選択
 * ③ syncEnglishVocabularyPublish() を明示的に実行
 *
 * Script Properties:
 *   AI_VOCAB_GITHUB_REPO = f9-fish/Yoshi.Lab
 *   AI_VOCAB_GITHUB_TOKEN = GitHubの個人用トークン
 *   AI_VOCAB_GITHUB_BRANCH = main (省略時 main)
 *   AI_VOCAB_SYNC_APPROVED = true (公開操作を承認した場合だけ)
 *
 * この同期は追加専用。GitHubに既存の同名語が存在するときは
 * 意味・ヒント・読み方を勝手に変更しない。
 */
const AI_VOCAB_BOOK_ID='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
function aiVocabRows_() {
  const sh=SpreadsheetApp.openById(AI_VOCAB_BOOK_ID).getSheetByName('英単語');
  if(!sh)throw Error('英単語タブがありません');
  const values=sh.getDataRange().getDisplayValues();
  const head=['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'];
  if(head.some((s,i)=>values[0][i]!==s))throw Error('英単語の8列ヘッダーを確認してください');
  const rows=[],warnings=[],seen=new Set();
  values.slice(1).forEach((r,i)=>{
    const row=i+2;
    if(!r.some(x=>String(x).trim()))return;
    if(r[6]!=='公開')return;
    const [subject,lesson,part,word,meaning,hint,status,reading]=r.map(v=>String(v||'').trim());
    if(!subject||!lesson||!part||!word||!meaning)throw Error('英単語 '+row+'行：公開行に必須項目の不足があります');
    if(subject!=='英C')throw Error('英単語 '+row+'行：英C以外をこの同期で扱うことはできません');
    if(word.length>180||meaning.length>400||hint.length>400||reading.length>180)throw Error('英単語 '+row+'行：値が長すぎます');
    const key=[subject,lesson,part,word.toLowerCase().replace(/\s+/g,' ')].join('|');
    if(seen.has(key))throw Error('英単語 '+row+'行：公開語の重複 '+word);
    seen.add(key);
    rows.push({subject,id:lesson,name:part,word:{word,meaning,hint,reading},row});
    if(!reading)warnings.push('行'+row+'：カタカナ読みが未入力 '+word);
  });
  return {rows,warnings};
}
function aiVocabApplyAdditions_(groups,published){
  if(!Array.isArray(groups))throw Error('vocabulary.jsonの形式が不正です');
  const keyOf=(s,id,name)=>[s,String(id),String(name)].join('|');
  const clone=groups.map(g=>({...g,words:Array.isArray(g.words)?g.words.map(w=>({...w})):null}));
  if(clone.some(g=>!g.subject||!g.id||!g.name||!g.words))throw Error('GitHub単語JSONの構造を確認してください');
  const lookup=new Map(),wordKeys=new Map(),additions=[];
  clone.forEach((g,i)=>{
    const key=keyOf(g.subject,g.id,g.name);
    if(lookup.has(key))throw Error('GitHub単語グループの重複：'+key);
    lookup.set(key,i);
    const words=new Map();
    g.words.forEach(w=>{
      const k=String(w.word||'').trim().toLowerCase().replace(/\s+/g,' ');
      if(!k||words.has(k))throw Error('GitHub既存単語の形式・重複を確認してください：'+key);
      words.set(k,w);
    });
    wordKeys.set(key,words);
  });
  published.forEach(r=>{
    const key=keyOf(r.subject,r.id,r.name);
    if(!lookup.has(key)){
      lookup.set(key,clone.length);
      clone.push({subject:r.subject,id:r.id,name:r.name,words:[]});
      wordKeys.set(key,new Map());
    }
    const words=wordKeys.get(key),term=r.word.word.toLowerCase().replace(/\s+/g,' ');
    if(words.has(term)){
      const old=words.get(term);
      if(old.meaning!==r.word.meaning||String(old.hint||'')!==r.word.hint||String(old.reading||'')!==r.word.reading){
        throw Error('既存GitHub単語と内容が異なります（上書きを禁止）：'+r.word.word+' / '+key);
      }
      return;
    }
    clone[lookup.get(key)].words.push({...r.word});
    words.set(term,r.word);
    additions.push({key,word:r.word.word,row:r.row});
  });
  return {groups:clone,additions};
}
function aiVocabGitHub_(branch,repo,token) {
  if(!/^[-\w.]+\/[-\w.]+$/.test(repo))throw Error('AI_VOCAB_GITHUB_REPOを確認してください');
  if(!/^[\w./-]+$/.test(branch))throw Error('ブランチ指定を確認してください');
  const base='https://api.github.com/repos/'+repo+'/contents/vocabulary.json';
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const response=UrlFetchApp.fetch(base+'?ref='+encodeURIComponent(branch),{headers,muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('GitHub既存教材の読み込みに失敗：HTTP '+response.getResponseCode());
  const file=JSON.parse(response.getContentText());
  if(!file.sha||!file.content)throw Error('GitHubのファイル情報が不正です');
  const content=Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\s/g,''))).getDataAsString('UTF-8');
  return {base,headers,sha:file.sha,groups:JSON.parse(content),branch};
}
function aiVocabPublicationPlan_() {
  const {rows,warnings}=aiVocabRows_();
  const props=PropertiesService.getScriptProperties();
  const repo=props.getProperty('AI_VOCAB_GITHUB_REPO')||props.getProperty('PAIR_QA_GITHUB_REPO');
  const token=props.getProperty('AI_VOCAB_GITHUB_TOKEN')||props.getProperty('PAIR_QA_GITHUB_TOKEN');
  const branch=props.getProperty('AI_VOCAB_GITHUB_BRANCH')||'main';
  if(!repo||!token)throw Error('GitHub接続用のプロパティを設定してください');
  const remote=aiVocabGitHub_(branch,repo,token);
  const result=aiVocabApplyAdditions_(remote.groups,rows);
  return {remote,...result,warnings,published:rows.length};
}
function previewEnglishVocabularyPublish(){
  const p=aiVocabPublicationPlan_();
  console.log('【英単語の公開プレビュー：GitHub変更なし】');
  console.log('公開行：'+p.published+'／新規追加：'+p.additions.length+'／読み方未入力：'+p.warnings.length);
  p.additions.slice(0,30).forEach(x=>console.log('追加予定：'+x.key+' '+x.word));
  p.warnings.slice(0,20).forEach(x=>console.warn(x));
}
function syncEnglishVocabularyPublish(){
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('AI_VOCAB_SYNC_APPROVED')!=='true')
    throw Error('GitHub公開は未承認です。AI_VOCAB_SYNC_APPROVED=trueを設定した場合のみ実行します');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const p=aiVocabPublicationPlan_();
    if(!p.additions.length){console.log('新規公開語なし：GitHubは変更していません');return;}
    if(p.warnings.some(w=>p.additions.some(x=>w.startsWith('行'+x.row+'：'))))
      throw Error('新規公開予定の単語に読み方未入力があります。入力後に再実行してください');
    const body={
      message:'Publish reviewed English vocabulary additions',
      content:Utilities.base64Encode(JSON.stringify(p.groups,null,2)+'\n',Utilities.Charset.UTF_8),
      sha:p.remote.sha,branch:p.remote.branch
    };
    const response=UrlFetchApp.fetch(p.remote.base,{
      method:'put',headers:p.remote.headers,contentType:'application/json',
      payload:JSON.stringify(body),muteHttpExceptions:true
    });
    if(response.getResponseCode()<200||response.getResponseCode()>=300)
      throw Error('GitHub単語同期に失敗：HTTP '+response.getResponseCode()+'。既存データとの競合などを確認してください');
    console.log('公開単語を'+p.additions.length+'件追加しました。GitHubの既存単語は上書きしていません');
  }finally{lock.releaseLock();}
}
