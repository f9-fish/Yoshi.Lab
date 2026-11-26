'use strict';
const {HEADERS,clean,norm,hash,need,headerMap}=require('./core.cjs');
const join=v=>(v||[]).join(' || ');
function rowObject(c,number){
 const p=c.payload,why=p.explanation? p.explanation+'\n根拠：'+p.evidence.map(e=>e.sourceId+' '+e.quote).join(' / '):'';
 if(c.type==='vocabulary')return {'科目':c.subject,'単元ID':c.unitId,'単元名':c.unitName,'英単語':p.word,'日本語訳':p.meaning,'ヒント':p.hint,'公開設定':'要確認','読み方':p.reading};
 if(c.type==='qa')return {'問題ID':c.id,'科目':c.subject,'単元ID':c.unitId,'Part':c.part,'問題番号':number,'英語の質問':p.question,'模範解答':p.modelAnswer,'許容解答':join(p.acceptedAnswers),'本文根拠・解説':why,'公開状態':'要確認','ヒント①':'','ヒント②':''};
 if(c.type==='writing')return {'問題ID':c.id,'科目':c.subject,'単元ID':c.unitId,'単元名':c.unitName,'問題番号':number,'日本語の問題文':p.japanese,'指定語・表現':join(p.requiredExpressions),'模範解答':p.modelAnswer,'許容解答':join(p.acceptedAnswers),'ヒント①（文型）':p.hintGrammar,'ヒント②（語句）':p.hintWords,'解説':why,'公開状態':'要確認'};
 return {'候補ID':c.id,'科目':c.subject,'単元ID':c.unitId,'Part':c.part,'種別':c.type==='trueFalse'?'True / False':'Discussion','英語の設問':p.question,'模範解答・回答例':p.modelAnswer,'許容解答':join(p.acceptedAnswers),'ヒント①':'','ヒント②':'','解説':why,'公開状態':'要確認'};
}
const identity=(o,type)=>[o['科目'],o['単元ID'],type==='writing'||type==='vocabulary'?o['単元名']:o.Part,type==='trueFalse'||type==='discussion'?o['種別']:'',o[type==='vocabulary'?'英単語':type==='writing'?'日本語の問題文':type==='qa'?'英語の質問':'英語の設問']].map(norm).join('\u0000');
function verifyCandidate(c){const {contentHash,...value}=c;need(contentHash===hash(value),'候補が生成後に変更されています。修正後は再検証してください');need(c.reviewStatus==='要確認','このエンジンは未承認の候補だけを扱います');}
function assertAppendOnly(before,after){
 need(Array.isArray(before)&&Array.isArray(after),'行配列が必要です');let changed=0;
 for(let i=0;i<Math.min(before.length,after.length);i++)if(hash(before[i])!==hash(after[i]))changed++;
 const deleted=Math.max(0,before.length-after.length),added=Math.max(0,after.length-before.length);
 need(changed===0&&deleted===0,'既存行の変更・削除を検出しました。処理を中止します');return {added,changed,deleted};
}
function planAppend(table,candidates,{ledger=[]}={}){
 const {type}=table;need(['vocabulary','qa','writing','trueFalse'].includes(type),'対象タブが不明です');
 const headers=table.headers.map(clean),required=HEADERS[type];headerMap(headers,required);
 need(Array.isArray(table.rows)&&table.rows.every(Array.isArray),'既存行の形式が不正です');
 const before=structuredClone(table.rows),rows=structuredClone(before),additions=[],duplicates=[],nextLedger=structuredClone(ledger),records=new Map();
 for(const entry of ledger){need(!records.has(entry.candidateId),'追記台帳の候補IDが重複');records.set(entry.candidateId,entry);}
 const object=r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']));
 const objects=rows.map(object),ids=new Set(objects.map(o=>clean(o['問題ID']||o['候補ID'])).filter(Boolean));
 // Existing numbers are allocated per subject + lesson (+ Part for QA).
 const numberKey=o=>[o['科目'],o['単元ID'],type==='qa'?o.Part:''].map(norm).join('\u0000'),max=new Map();
 for(const o of objects){const n=Number(o['問題番号']);if(Number.isInteger(n)&&n>0)max.set(numberKey(o),Math.max(max.get(numberKey(o))||0,n));}
 for(const c of candidates){
  verifyCandidate(c);need(c.type===type||(type==='trueFalse'&&c.type==='discussion'),'候補の種類と対象タブが不一致');
  const previous=records.get(c.id);
  if(previous){need(previous.contentHash===c.contentHash,'同じ候補IDの内容が変更されています');need(rows.some(r=>hash(r)===previous.rowHash),'追記台帳と既存行が不一致です。管理者の復旧確認が必要です');duplicates.push({id:c.id,reason:'追記済み'});continue;}
  const sameId=objects.find(o=>clean(o['問題ID']||o['候補ID'])===c.id);
  if(sameId){const expected=rowObject(c,sameId['問題番号']);const actualRow=headers.map(h=>sameId[h]??'');need(hash(headers.map(h=>expected[h]??''))===hash(actualRow),'同じ候補IDのシート内容が変更されています');duplicates.push({id:c.id,reason:'同じIDで追記済み'});continue;}
  const provisional=rowObject(c,1),match=objects.find(o=>identity(o,c.type)===identity(provisional,c.type));
  if(match){duplicates.push({id:c.id,reason:'同じ教材枠に同じ単語・設問が存在：内容を教員確認'});continue;}
  need(!ids.has(c.id),'既存の問題IDと衝突しています');
  const nk=numberKey(provisional),number=(max.get(nk)||0)+1;need(Number.isSafeInteger(number),'問題番号の上限を超えています');max.set(nk,number);
  const value=rowObject(c,number),row=headers.map(h=>value[h]??'');
  need(Buffer.byteLength(JSON.stringify(value),'utf8')<=16000,'同期先の問題サイズ上限を超過しています');
  if(type==='trueFalse')need(value['解説'].length<=4000&&value['英語の設問'].length<=4000,'ペアワークの設問・解説の上限を超過しています');
  // No formulas in a future Sheets append; Phase 3 must additionally use RAW input.
  need(row.every(v=>typeof v!=='string'||!/^\s*[=+@]/.test(v)),'数式として解釈される候補があります');
  rows.push(row);objects.push(object(row));ids.add(c.id);additions.push(row);
  const entry={candidateId:c.id,contentHash:c.contentHash,rowHash:hash(row)};nextLedger.push(entry);records.set(c.id,entry);
 }
 const diff=assertAppendOnly(before,rows);
 return {dryRun:true,writeEnabled:false,type,baseHash:hash({headers:table.headers,rows:before}),headers:table.headers,rows,additions,ledger:nextLedger,diff:{...diff,duplicates:duplicates.length,errors:0},duplicates,requiresSyncVerification:type==='vocabulary'};
}
function verifyPlanBase(plan,table){need(plan.baseHash===hash({headers:table.headers,rows:table.rows}),'追記計画後に既存シートが変更されています。再プレビューしてください');return true;}
module.exports={rowObject,verifyCandidate,planAppend,assertAppendOnly,verifyPlanBase};
