/**
 * Yoshi.Lab AI文法下書き → 既存「問題集」への非公開転記
 *
 * Apps Scriptに新規ファイル ai-grammar-transfer.gs として追加する。
 * previewAIGrammarTransfer()   : 読み取り専用・訳候補をログに表示
 * transferAIGrammarToProblems(): 日本語訳が入力された下書きだけ安全に転記
 *
 * 既存問題集、同期処理、GitHub、生徒向け公開データは変更しない。
 */
const AI_GRAMMAR_BOOK_ID='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
function aiGrammarRead_(ss,name,headers){
  const sh=ss.getSheetByName(name);
  if(!sh)throw Error(name+'タブがありません');
  const rows=sh.getDataRange().getDisplayValues();
  if(!rows.length||headers.some((h,i)=>rows[0][i]!==h))
    throw Error(name+'のヘッダーが想定と異なります');
  return {sheet:sh,rows:rows.slice(1)};
}
function aiGrammarCompleted_(blank,answer){
  const english=String(blank||''),tokens=String(answer||'').trim().split(/\s+/).filter(Boolean);
  const slots=[...english.matchAll(/\(\s*\)/g)];
  if(!slots.length)throw Error('穴埋め(     )がありません');
  if(slots.length!==tokens.length)throw Error('空欄数'+slots.length+'と解答語数'+tokens.length+'が一致しません');
  if(tokens.some(t=>/[()\n\r]/.test(t)))throw Error('解答に不正な文字があります');
  let i=0;
  const completed=english.replace(/\(\s*\)/g,()=>'( '+tokens[i++]+' )');
  if(completed.length>1200)throw Error('英文が長すぎます');
  return completed;
}
function aiGrammarLiteral_(v){
  const s=String(v==null?'':v).trim();
  if(s.length>1500)throw Error('長すぎるセルがあります');
  return /^[\s]*[=+@]/.test(s)||/^[\s]*-[^0-9]/.test(s)?"'"+s:s;
}
function aiGrammarPlan_(grammarRows,problemsRows,sourceRows,candidateRows){
  const existing=new Set(problemsRows.filter(r=>r[0]&&r[3]).map(r=>[r[0],r[1],r[2],r[3].trim().replace(/\s+/g,' ').toLowerCase()].join('|')));
  const master=new Map(sourceRows.filter(r=>r[0]).map(r=>[r[0],r]));
  const candidates=new Map(candidateRows.filter(r=>r[0]).map(r=>[r[0],r]));
  const report=[],toWrite=[],errors=[],seenIds=new Set();
  grammarRows.forEach((r,i)=>{
    if(!r[0])return;
    const row=i+2,[id,subject,lesson,part,blank,japanese,answer,,,explanation,status]=r;
    if(seenIds.has(id)){errors.push('行'+row+'：候補ID重複 '+id);return;}
    seenIds.add(id);
    if(!['下書き','転記済'].includes(status))return;
    let english;
    try{english=aiGrammarCompleted_(blank,answer);}
    catch(e){errors.push('行'+row+'：'+e.message);return;}
    const candidate=candidates.get(id);
    const refs=candidate?String(candidate[12]||'').split(/[\s,、]+/).filter(Boolean):[];
    const original=refs.map(ref=>master.get(ref)).filter(Boolean);
    const suggested=original.map(x=>x[6]).filter(Boolean).join(' / ');
    const hasJapanese=String(japanese||'').trim().length>0;
    const key=[subject,lesson,part,english.trim().replace(/\s+/g,' ').toLowerCase()].join('|');
    const duplicate=existing.has(key);
    const state=status==='転記済'?'登録済':duplicate?'重複':!hasJapanese?'日本語訳待ち':'転記可能';
    if(!['英C','論表'].includes(subject)||!lesson||!part||!explanation)
      errors.push('行'+row+'：科目・単元・解説を確認');
    if(!candidate)errors.push('行'+row+'：元候補がありません');
    if(candidate&&candidate[5]!=='文法・穴埋め')errors.push('行'+row+'：候補種別が違います');
    if(candidate&&(!refs.length||original.length!==refs.length))errors.push('行'+row+'：根拠文IDが不正');
    if(hasJapanese&&japanese.length>1200)errors.push('行'+row+'：日本語訳が長すぎます');
    report.push({row,id,english,japanese,suggested,state,refs});
    if(status==='下書き'&&!duplicate&&hasJapanese){
      existing.add(key);
      toWrite.push({row,values:[subject,lesson,part,english,japanese,'下書き']});
    }
  });
  return {report,toWrite,errors};
}
function aiGrammarBuildPlan_(){
  const ss=SpreadsheetApp.openById(AI_GRAMMAR_BOOK_ID);
  const grammar=aiGrammarRead_(ss,'AI文法下書き',['候補ID','科目','単元ID','Part','英語（穴埋め）','日本語訳（要記入）','正答','ヒント①','ヒント②','解説','公開状態']);
  const problems=aiGrammarRead_(ss,'問題集',['科目','単元ID','単元名','英語','日本語','公開設定']);
  const source=aiGrammarRead_(ss,'教科書本文マスター',['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳']);
  const candidate=aiGrammarRead_(ss,'AI生成候補',['候補ID','原文ID','科目','単元ID','Part','種別']);
  const plan=aiGrammarPlan_(grammar.rows,problems.rows,source.rows,candidate.rows);
  return {grammar,problems,...plan};
}
function previewAIGrammarTransfer(){
  const p=aiGrammarBuildPlan_();
  console.log('【文法下書き → 問題集：転記プレビュー】');
  p.report.forEach(x=>{
    console.log(x.id+' ['+x.state+'] '+x.english);
    if(x.japanese)console.log('  日本語訳：'+x.japanese);
    else console.log('  元本文の訳（参考、未入力）：'+(x.suggested||'なし'));
  });
  p.errors.forEach(x=>console.error(x));
  console.log('転記可能：'+p.toWrite.length+'件／エラー：'+p.errors.length+'件。プレビューなので変更なし');
}
function transferAIGrammarToProblems(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const p=aiGrammarBuildPlan_();
    if(p.errors.length)throw Error('検証エラー '+p.errors.join(' / '));
    if(!p.toWrite.length){console.log('転記可能な問題なし。日本語訳と状態を確認');return;}
    // Sheetsへの書き込みはトランザクションではない。再実行時は英文の重複を検出する。
    const sheet=p.problems.sheet,start=sheet.getLastRow()+1,n=p.toWrite.length;
    if(start+n-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),start+n-1-sheet.getMaxRows());
    sheet.getRange(start,1,n,6).setValues(p.toWrite.map(x=>x.values.map(aiGrammarLiteral_)));
    p.toWrite.forEach(x=>p.grammar.sheet.getRange(x.row,11).setValue('転記済'));
    console.log('問題集へ'+n+'件を「下書き」で転記。公開・GitHub同期なし');
  }finally{lock.releaseLock();}
}
