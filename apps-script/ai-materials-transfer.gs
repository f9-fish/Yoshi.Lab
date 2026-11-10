/**
 * Yoshi.Lab AI教材の採用→非公開下書き転記
 * 既存のApps Scriptへ独立ファイルとして追加する。
 * previewApprovedAIMaterials() -> transferApprovedAIMaterials()
 * 「AI生成候補」のレビュー状態が「採用」の行のみ対象。
 * 生徒向け公開・GitHub同期・Firebase更新は一切しない。
 *
 * 対応する転記先：
 * 単語・熟語 -> 英単語（公開設定=下書き）
 * 本文Q&A -> 英C本文QA（公開状態=下書き）
 * 文法・穴埋め -> AI文法下書き（日本語訳は未作成のため専用保留表）
 * True / False, Discussion -> AI発展教材下書き（アプリモード未実装）
 */
const AI_TRANSFER_SPREADSHEET_ID = '1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
const AI_TRANSFER_SHEETS = {
  source:'AI生成候補', vocabulary:'英単語', qa:'英C本文QA',
  grammar:'AI文法下書き', extension:'AI発展教材下書き'
};
const AI_TRANSFER_HEADERS = {
  source:['候補ID','原文ID','科目','単元ID','Part','種別','設問・語句','模範解答・意味','許容解答','ヒント①','ヒント②','解説・ねらい','根拠文ID','レビュー状態','生成日時'],
  vocabulary:['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'],
  qa:['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','ヒント①','ヒント②','本文根拠・解説','公開状態'],
  grammar:['候補ID','科目','単元ID','Part','英語（穴埋め）','日本語訳（要記入）','正答','ヒント①','ヒント②','解説','公開状態'],
  extension:['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態']
};
function aiTransferNorm_(value) {
  return String(value==null?'':value).trim().toLowerCase().replace(/\s+/g,' ');
}
function aiTransferLiteral_(value) {
  const v=String(value==null?'':value).trim();
  if(v.length>4000)throw Error('長すぎるセル値があります');
  return /^[\s]*[=+@]/.test(v)||/^[\s]*-[^0-9]/.test(v)?"'"+v:v;
}
function aiTransferRead_(ss,name,expected) {
  const sheet=ss.getSheetByName(name);
  if(!sheet)throw Error('転記先のタブがありません：'+name);
  const rows=sheet.getDataRange().getDisplayValues();
  if(expected.some((h,i)=>rows[0][i]!==h))throw Error('ヘッダーの不一致：'+name);
  return {sheet,rows};
}
function aiTransferPlan_(){
  const ss=SpreadsheetApp.openById(AI_TRANSFER_SPREADSHEET_ID),data={};
  Object.keys(AI_TRANSFER_SHEETS).forEach(kind=>{
    data[kind]=aiTransferRead_(ss,AI_TRANSFER_SHEETS[kind],AI_TRANSFER_HEADERS[kind]);
  });
  const target={vocabulary:[],qa:[],grammar:[],extension:[]},marks=[],skipped=[];
  const all=data.source.rows.slice(1).map((r,i)=>({row:i+2,r}));
  const alreadyVocab=new Set(data.vocabulary.rows.slice(1).map(r=>
    [r[0],r[1],r[2],aiTransferNorm_(r[3])].join('|')));
  const alreadyQAIds=new Set(data.qa.rows.slice(1).map(r=>r[0]).filter(Boolean));
  const alreadyQAContent=new Set(data.qa.rows.slice(1).map(r=>
    [r[1],r[2],r[3],aiTransferNorm_(r[5])].join('|')));
  const alreadyGrammar=new Set(data.grammar.rows.slice(1).map(r=>r[0]).filter(Boolean));
  const alreadyExtension=new Set(data.extension.rows.slice(1).map(r=>r[0]).filter(Boolean));
  const usedCandidateIds=new Set();
  const qaCounters=new Map();
  data.qa.rows.slice(1).forEach(r=>{
    if(r[1]!=='英C'||!r[2]||!r[3])return;
    const k=r[1]+'|'+r[2]+'|'+r[3],n=Number(r[4]);
    qaCounters.set(k,Math.max(qaCounters.get(k)||0,Number.isInteger(n)?n:0));
  });
  all.forEach(({row,r})=>{
    if(r[13]!=='採用')return;
    const [id,sourceIds,subject,lesson,part,type,prompt,answer,alternatives,hint1,hint2,explanation]=r;
    if(!id||!lesson||!part||!type||!prompt||!answer||subject!=='英C')throw Error('AI生成候補 '+row+'行：必須項目・科目を確認');
    if(usedCandidateIds.has(id))throw Error('候補IDが重複しています：'+id);
    usedCandidateIds.add(id);
    if(type==='単語・熟語'){
      const key=[subject,lesson,part,aiTransferNorm_(prompt)].join('|');
      if(alreadyVocab.has(key)){skipped.push(row+'行：既存の英単語と重複');return;}
      alreadyVocab.add(key);
      target.vocabulary.push([subject,lesson,part,prompt,answer,hint1||'','下書き','']);
    } else if(type==='本文Q&A'){
      const key=[subject,lesson,part,aiTransferNorm_(prompt)].join('|');
      const qaId='QA-'+id;
      if(alreadyQAIds.has(qaId)||alreadyQAContent.has(key)){skipped.push(row+'行：既存のQ&Aと重複');return;}
      alreadyQAIds.add(qaId);alreadyQAContent.add(key);
      const ckey=subject+'|'+lesson+'|'+part;
      const next=(qaCounters.get(ckey)||0)+1;qaCounters.set(ckey,next);
      target.qa.push([qaId,subject,lesson,part,String(next),prompt,answer,alternatives,hint1,hint2,explanation,'下書き']);
    } else if(type==='文法・穴埋め'){
      if(alreadyGrammar.has(id)){skipped.push(row+'行：文法下書きに登録済み');return;}
      if(!prompt.includes('(     )'))throw Error('AI生成候補 '+row+'行：穴埋めの空欄表記を確認');
      alreadyGrammar.add(id);
      target.grammar.push([id,subject,lesson,part,prompt,'',answer,hint1,hint2,explanation,'下書き']);
    } else if(type==='True / False'||type==='Discussion'){
      if(alreadyExtension.has(id)){skipped.push(row+'行：発展教材下書きに登録済み');return;}
      if(type==='True / False'&&!/^(True|False)$/i.test(answer))throw Error('AI生成候補 '+row+'行：T/Fの正答が不正');
      alreadyExtension.add(id);
      target.extension.push([id,subject,lesson,part,type,prompt,answer,alternatives,hint1,hint2,explanation,'下書き']);
    } else {
      throw Error('AI生成候補 '+row+'行：未対応の種類 '+type);
    }
    marks.push(row);
  });
  // Validate *all* planned writes before touching any sheet.
  Object.keys(target).forEach(kind=>target[kind].forEach(r=>{
    if(r.length!==AI_TRANSFER_HEADERS[kind].length)throw Error('転記列数エラー：'+kind);
    r.forEach(aiTransferLiteral_);
  }));
  return {data,target,marks,skipped};
}
function previewApprovedAIMaterials(){
  const p=aiTransferPlan_();
  console.log('【採用教材の転記プレビュー】シートへの変更なし');
  Object.keys(p.target).forEach(k=>console.log(AI_TRANSFER_SHEETS[k]+'：'+p.target[k].length+'件'));
  console.log('転記予定：'+p.marks.length+'件／重複スキップ：'+p.skipped.length+'件');
  p.skipped.slice(0,20).forEach(x=>console.log(x));
}
function transferApprovedAIMaterials(){
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const p=aiTransferPlan_();
    if(!p.marks.length){console.log('転記対象なし。採用行を確認してください');return;}
    // Append first, mark transferred afterwards. A partial failure can be
    // retried without duplicating rows thanks to the destination dedupe.
    for(const kind of ['vocabulary','qa','grammar','extension']){
      const items=p.target[kind];if(!items.length)continue;
      const sheet=p.data[kind].sheet,start=sheet.getLastRow()+1;
      const needed=start+items.length-1-sheet.getMaxRows();
      if(needed>0)sheet.insertRowsAfter(sheet.getMaxRows(),needed);
      sheet.getRange(start,1,items.length,items[0].length)
        .setValues(items.map(row=>row.map(aiTransferLiteral_)));
      console.log(AI_TRANSFER_SHEETS[kind]+'へ'+items.length+'件を下書き転記');
    }
    p.marks.forEach(row=>p.data.source.sheet.getRange(row,14).setValue('転記済'));
    console.log('完了：'+p.marks.length+'件を「転記済」に更新。教材は非公開のまま');
    if(p.skipped.length)console.log('重複としてスキップ：'+p.skipped.length+'件（候補は「採用」のまま）');
  }finally{lock.releaseLock();}
}
