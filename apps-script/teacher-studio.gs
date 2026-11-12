/**
 * Yoshi.Lab 教師専用AI教材スタジオ（MVP）
 * 【重要】既存Yoshi.LabのApps Scriptに追加せず、別のApps Scriptプロジェクトで使うこと。
 * スクリプトプロパティ:
 *   STUDIO_ADMIN_EMAILS = 先生のGoogleアカウント（複数ならカンマ区切り）
 *
 * Webアプリ公開設定：「次のユーザーとして実行：ウェブアプリケーションにアクセスしているユーザー」
 * アクセス可能なユーザー：学校のドメイン内、または設定したGoogleユーザー。
 * Session.getActiveUser().getEmail() が取得できない環境では安全のためアクセス拒否。
 * 生徒向けサイトやFirebase、GitHubトークンとは分離する。
 */
const STUDIO_SPREADSHEET_ID = '1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU';
const STUDIO_SCHEMAS = {
  master: ['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳','重要文法・語句メモ','生成対象','備考'],
  candidates: ['候補ID','原文ID','科目','単元ID','Part','種別','設問・語句','模範解答・意味','許容解答','ヒント①','ヒント②','解説・ねらい','根拠文ID','レビュー状態','生成日時'],
  grammar: ['候補ID','科目','単元ID','Part','英語（穴埋め）','日本語訳（要記入）','正答','ヒント①','ヒント②','解説','公開状態'],
  extension: ['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態']
};
function studioAdmin_(){
  const email=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  const configured=String(PropertiesService.getScriptProperties().getProperty('STUDIO_ADMIN_EMAILS')||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!email||!configured.length||configured.indexOf(email)===-1)
    throw Error('管理者認証に失敗しました。GoogleアカウントとSTUDIO_ADMIN_EMAILSの設定を確認してください。');
  return email;
}
function studioRead_(ss,name,header){
  const sh=ss.getSheetByName(name);
  if(!sh)throw Error('必要なタブがありません：'+name);
  const max=sh.getLastRow();
  const data=max?sh.getRange(1,1,max,header.length).getDisplayValues():[];
  if(!data.length||header.some((h,i)=>data[0][i]!==h))
    throw Error('シート見出しが想定と異なります：'+name);
  return {sheet:sh,rows:data.slice(1)};
}
function studioBundle_(){
  const ss=SpreadsheetApp.openById(STUDIO_SPREADSHEET_ID);
  const master=studioRead_(ss,'教科書本文マスター',STUDIO_SCHEMAS.master).rows.filter(r=>r[0]);
  const candidates=studioRead_(ss,'AI生成候補',STUDIO_SCHEMAS.candidates).rows.filter(r=>r[0]);
  const grammar=studioRead_(ss,'AI文法下書き',STUDIO_SCHEMAS.grammar).rows.filter(r=>r[0]);
  const extension=studioRead_(ss,'AI発展教材下書き',STUDIO_SCHEMAS.extension).rows.filter(r=>r[0]);
  const byLesson=new Map();
  function collect(subject,lesson,part) {
    const key=JSON.stringify([subject,lesson,part]);
    if(!byLesson.has(key))byLesson.set(key,{key,subject,lesson,part,sourceCount:0,candidateCount:0,grammarCount:0,extensionCount:0});
    return byLesson.get(key);
  }
  master.forEach(r=>collect(r[1],r[2],r[3]).sourceCount++);
  candidates.forEach(r=>collect(r[2],r[3],r[4]).candidateCount++);
  grammar.forEach(r=>collect(r[1],r[2],r[3]).grammarCount++);
  extension.forEach(r=>collect(r[1],r[2],r[3]).extensionCount++);
  return {
    lessons:[...byLesson.values()].sort((a,b)=>a.subject.localeCompare(b.subject,'ja')||a.lesson.localeCompare(b.lesson,'ja',{numeric:true})||a.part.localeCompare(b.part,'ja',{numeric:true})),
    candidates:candidates.map(r=>({id:r[0],originalId:r[1],subject:r[2],lesson:r[3],part:r[4],type:r[5],question:r[6],answer:r[7],accepted:r[8],hint1:r[9],hint2:r[10],explanation:r[11],references:r[12],review:r[13]})),
    totals:{master:master.length,candidates:candidates.length,grammar:grammar.length,extension:extension.length,publishedExtension:extension.filter(r=>r[11]==='公開').length},
    notice:'この管理画面では生成・GitHub公開を行いません。教科書本文は外部AIへ送信されません。'
  };
}
function doGet(){
  try{
    studioAdmin_();
    return HtmlService.createHtmlOutputFromFile('teacher-studio')
      .setTitle('Yoshi.Lab｜AI教材スタジオ')
      .addMetaTag('viewport','width=device-width, initial-scale=1');
  }catch(e){
    return HtmlService.createHtmlOutput('<h2>アクセスが拒否されました</h2><p>管理者アカウントでログインしてください。</p>')
      .setTitle('Yoshi.Lab｜アクセス制限');
  }
}
function getTeacherStudioDashboard(){
  studioAdmin_();
  return studioBundle_();
}
/**
 * AI生成候補のレビュー状態のみ更新。
 * 「転記済」は不変。すでに転記された行を再採用して二重登録する事故を防ぐ。
 * 生成・転記・公開は一切実行しない。
 */
function reviewTeacherStudioCandidate(id,nextState){
  const admin=studioAdmin_();
  const key=String(id||'').trim(),next=String(nextState||'').trim();
  if(!key||key.length>120||!['未確認','採用','却下'].includes(next))
    throw Error('候補IDまたはレビュー状態が不正です');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const ss=SpreadsheetApp.openById(STUDIO_SPREADSHEET_ID);
    const sheet=studioRead_(ss,'AI生成候補',STUDIO_SCHEMAS.candidates);
    const matches=sheet.rows.map((r,i)=>({r,index:i+2})).filter(x=>x.r[0]===key);
    if(matches.length!==1)throw Error('候補IDが見つからないか重複しています');
    const row=matches[0];
    if(row.r[13]==='転記済')throw Error('転記済み候補は変更できません');
    if(!['未確認','採用','却下','下書き',''].includes(row.r[13]))
      throw Error('未知のレビュー状態です。変更を停止しました');
    row.r[13]=next;
    sheet.sheet.getRange(row.index,14).setValue(next);
    console.log('教材レビュー：'+key+' → '+next+' / '+admin);
    return {id:key,review:next};
  }finally{lock.releaseLock();}
}
