/**
 * Yoshi.Lab Lesson本文Q&A 公開前チェック（読み取り専用）
 * 実行関数: previewLesson8QAPublish()
 *
 * 既存の previewEnglishTextQA / syncEnglishTextQA は変更しない。
 * 教科書本文・AI生成候補・英C本文QA の3表を照合。
 * 原文に基づく「答えの妥当性」は教師が最終確認する。
 */
const AI_QA_REVIEW_BOOK_ID='1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
const AI_QA_REVIEW_LESSON='8';
const AI_QA_REVIEW_PART='1';
function aiQAReviewTable_(ss,name,headers) {
  const sheet=ss.getSheetByName(name);
  if(!sheet)throw Error('シートがありません：'+name);
  const rows=sheet.getDataRange().getDisplayValues();
  if(headers.some((v,i)=>rows[0][i]!==v))throw Error(name+'：ヘッダーが不一致（期待：'+headers.join(' / ')+' ／ 実際：'+rows[0].slice(0,headers.length).join(' / ')+'）');
  return rows.slice(1);
}
function aiQAReviewPlan_(source,candidates,qa) {
  const lesson=AI_QA_REVIEW_LESSON,part=AI_QA_REVIEW_PART;
  const original=new Map(),warnings=[],errors=[],report=[],seenIds=new Set(),seenNums=new Set();
  source.forEach((r,i)=>{
    if(r[1]!=='英C'||r[2]!==lesson||r[3]!==part)return;
    if(!r[0]||!r[5])errors.push('本文行'+(i+2)+'：ID・英文が不足');
    if(original.has(r[0]))errors.push('本文IDが重複：'+r[0]);
    original.set(r[0],r[5]);
  });
  const candidatesById=new Map();
  candidates.forEach((r,i)=>{
    if(!r[0])return;
    if(candidatesById.has(r[0]))errors.push('AI候補ID重複：'+r[0]);
    candidatesById.set(r[0],r);
  });
  qa.forEach((r,i)=>{
    if(r[1]!=='英C'||r[2]!==lesson||r[3]!==part)return;
    const [qaId,,,,num,question,answer,accepted,explanation,status]=r;
    const candidateId=qaId.startsWith('QA-')?qaId.substring(3):'';
    const candidate=candidatesById.get(candidateId);
    if(seenIds.has(qaId))errors.push('Q&A ID重複：'+qaId);
    seenIds.add(qaId);
    if(seenNums.has(num))errors.push('問題番号重複：'+num);
    seenNums.add(num);
    if(!qaId||!num||!question||!answer||!explanation)errors.push('Q&A行'+(i+2)+'：必須項目が不足');
    if(!Number.isInteger(Number(num))||Number(num)<1)errors.push('Q&A行'+(i+2)+'：問題番号が不正');
    if(!candidate)warnings.push('Q&A行'+(i+2)+'：元AI候補を特定できません（手動作成なら正常）');
    else {
      if(candidate[5]!=='本文Q&A'||candidate[2]!=='英C'||candidate[3]!==lesson||candidate[4]!==part)
        errors.push('Q&A行'+(i+2)+'：候補との分類・単元不一致');
      if(candidate[6]!==question||candidate[7]!==answer)
        warnings.push('Q&A行'+(i+2)+'：AI候補から本文・解答が編集されています（人が要確認）');
      if(candidate[13]!=='転記済')warnings.push('Q&A行'+(i+2)+'：候補状態 '+candidate[13]);
    }
    const refs=(candidate?candidate[12]:'').split(/[\s,\n、]+/).map(v=>v.trim()).filter(Boolean);
    if(!refs.length)warnings.push('Q&A行'+(i+2)+'：根拠文IDがありません');
    refs.forEach(id=>{if(!original.has(id))errors.push('Q&A行'+(i+2)+'：存在しない根拠文ID '+id);});
    if(status!=='下書き'&&status!=='公開')warnings.push('Q&A行'+(i+2)+'：公開状態が想定外 '+status);
    if(!accepted)warnings.push('Q&A行'+(i+2)+'：許容解答が未設定');
    report.push({qaId,num,question,answer,accepted,explanation,status,
      sources:refs.map(id=>({id,text:original.get(id)||''}))});
  });
  return {report,warnings,errors,sourceCount:original.size};
}
function previewLesson8QAPublish(){
  const ss=SpreadsheetApp.openById(AI_QA_REVIEW_BOOK_ID);
  const source=aiQAReviewTable_(ss,'教科書本文マスター',['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）']);
  const candidates=aiQAReviewTable_(ss,'AI生成候補',['候補ID','原文ID','科目','単元ID','Part','種別']);
  const qa=aiQAReviewTable_(ss,'英C本文QA',['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','本文根拠・解説','公開状態']);
  const p=aiQAReviewPlan_(source,candidates,qa);
  console.log('【Lesson '+AI_QA_REVIEW_LESSON+' Part '+AI_QA_REVIEW_PART+' 本文Q&A公開前チェック】');
  console.log('本文：'+p.sourceCount+'文／Q&A：'+p.report.length+'件／エラー：'+p.errors.length+'／警告：'+p.warnings.length);
  p.report.forEach(x=>{
    console.log('Q'+x.num+' ['+x.status+'] '+x.question+' → '+x.answer);
    x.sources.forEach(s=>console.log('  根拠 '+s.id+': '+s.text));
  });
  p.warnings.forEach(w=>console.warn('警告：'+w));
  p.errors.forEach(e=>console.error('エラー：'+e));
  console.log('プレビューのみ：シートとGitHubは変更していません。問題文・答え・根拠の意味的整合性は教師が確認してください');
  return p;
}
