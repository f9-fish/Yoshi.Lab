'use strict';
// Phase 2 only: pure transformation/validation. No Sheets, Firebase or GitHub writes.
const {createHash}=require('node:crypto');
const TYPES=['vocabulary','qa','writing','trueFalse','discussion'];
const MASTER=['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳','重要文法・語句メモ','生成対象','備考'];
const HEADERS={
 vocabulary:['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'],
 qa:['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','本文根拠・解説','公開状態'],
 writing:['問題ID','科目','単元ID','単元名','問題番号','日本語の問題文','指定語・表現','模範解答','許容解答','ヒント①（文型）','ヒント②（語句）','解説','公開状態'],
 trueFalse:['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態']
};
const clean=v=>String(v??'').normalize('NFC').replace(/\r\n?/g,'\n').trim();
const norm=v=>clean(v).normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').toLowerCase();
const key=v=>norm(v).replace(/[.!?。！？]+$/u,'');
function stable(v){return JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);}
const hash=v=>createHash('sha256').update(stable(v)).digest('hex');
function need(ok,msg){if(!ok)throw Error(msg);}
function text(v,label,max=3000){need(typeof v==='string'&&clean(v)&&clean(v).length<=max,label+'が未入力・長すぎます');return clean(v);}
function optional(v,label,max=500){if(v===undefined||v===null||v==='')return '';return text(v,label,max);}
function array(v,label,max=10){need(Array.isArray(v)&&v.length<=max,label+'は配列で指定してください');return v.map(x=>text(x,label));}
function tokens(v){return norm(v).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)||[];}
function contains(value,phrase){const a=tokens(value),b=tokens(phrase);return b.length>0&&a.some((_,i)=>b.every((w,j)=>a[i+j]===w));}
function headerMap(headers,required){need(Array.isArray(headers)&&headers.every(h=>typeof h==='string'),'列名が不正です');const names=headers.map(clean);need(names.every(Boolean)&&new Set(names).size===names.length,'列名が空または重複しています');const map={};for(const h of required){const matches=headers.flatMap((x,i)=>clean(x)===h?[i]:[]);need(matches.length===1,'列の不足・重複：'+h);map[h]=matches[0];}return map;}
function buildSource(values,selection){
 need(Array.isArray(values)&&values.length>1,'本文マスターが空です');const map=headerMap(values[0],MASTER);
 const subject=clean(selection.subject),unitId=clean(selection.unitId),part=clean(selection.part).replace(/^part\s*/i,'');
 need(['英C','論表'].includes(subject)&&unitId&&part,'科目・単元ID・Partを明示してください');
 const ids=new Set(),numbers=new Set(),rows=[];
 for(const row of values.slice(1)){
  if(!Array.isArray(row)||!row.some(v=>clean(v)))continue;const get=h=>clean(row[map[h]]);
  if(get('科目')!==subject||get('単元ID')!==unitId||get('Part').replace(/^part\s*/i,'')!==part)continue;
  const id=text(get('原文ID'),'原文ID',100),number=Number(get('文番号'));
  need(!ids.has(id)&&Number.isInteger(number)&&number>0&&!numbers.has(number),'原文ID・文番号の重複または不正');ids.add(id);numbers.add(number);
  rows.push({id,number,english:text(get('教科書本文（英語）'),'本文',20000),japanese:get('日本語訳'),memo:get('重要文法・語句メモ'),targets:get('生成対象'),notes:get('備考')});
 }
 need(rows.length>0&&rows.length<=150,'対象本文は1〜150行にしてください');rows.sort((a,b)=>a.number-b.number);
 need(rows.reduce((n,r)=>n+r.english.length+r.japanese.length+r.memo.length+r.notes.length+r.targets.length,0)<=20000,'対象本文は合計2万文字以内にしてください');
 const source={subject,unitId,part,rows};return {...source,hash:hash(source)};
}
function settingsFor(source,settings={}){
 const counts={vocabulary:15,qa:source.subject==='英C'?10:0,writing:10,trueFalse:source.subject==='英C'?10:0,discussion:0,...settings.counts};
 need(Object.keys(counts).every(k=>TYPES.includes(k)),'未対応の生成種類です');for(const [type,count]of Object.entries(counts))need(Number.isInteger(count)&&count>=0&&count<=(type==='writing'?20:50),type+'の問題数が不正です');
 const aliases={'英単語':'vocabulary','英単語・熟語':'vocabulary','単語':'vocabulary','vocabulary':'vocabulary','英C本文Q&A':'qa','本文Q&A':'qa','Q&A':'qa','qa':'qa','英作文':'writing','英作文問題':'writing','writing':'writing','本文正誤問題':'trueFalse','True / False':'trueFalse','T/F':'trueFalse','trueFalse':'trueFalse','Discussion':'discussion','discussion':'discussion'};
 const requested=new Set();let explicit=false;
 for(const row of source.rows){for(const label of row.targets.split(/[,、\n]/).map(clean).filter(Boolean)){if(['全て','すべて','全種類','対象','生成する','ALL'].includes(label))continue;need(aliases[label],'生成対象の指定が不明です：'+label);explicit=true;requested.add(aliases[label]);}}
 if(explicit)for(const t of TYPES)if(!requested.has(t))counts[t]=0;
 need(Object.values(counts).some(Boolean),'生成対象を1種類以上指定してください');
 need(source.subject==='英C'||!(counts.qa||counts.trueFalse||counts.discussion),'Q&A・正誤・Discussionの既存同期は英C専用です');
 const revision=settings.revision??1;need(Number.isInteger(revision)&&revision>0,'再生成番号が不正です');
 const unitName=text(settings.unitName??(source.subject==='英C'?source.part:''),'単元名',100);
 const out={counts,unitName,genre:text(settings.genre??'ミステリー','ジャンル',60),difficulty:text(settings.difficulty??'英検準2級と2級の中間','難易度',100),storyStyle:text(settings.storyStyle??'自然な展開と意外性を重視する','ストーリー性',160),revision};
 return {...out,hash:hash(out)};
}
function evidenceOf(value,source){
 need(Array.isArray(value)&&value.length>0&&value.length<=5,'本文根拠が必要です');
 return value.map(e=>{const row=source.rows.find(r=>r.id===e.sourceId);need(row,'存在しない原文IDです');const quote=text(e.quote,'根拠引用',2000);need(quote.length>=6&&norm(row.english).includes(norm(quote)),'根拠引用が本文と一致しません');return {sourceId:row.id,quote};});
}
function fingerprint(type,payload,source){const question=type==='vocabulary'?payload.word:type==='writing'?payload.japanese:payload.question;return hash([source.subject,source.unitId,source.part,type,key(question)]);}
function validateResult(type,raw,source,settings){
 need(TYPES.includes(type),'未対応の生成種類です');const items=type==='writing'?raw?.items:raw?.items;
 need(Array.isArray(items)&&items.length<=settings.counts[type],type+'の問題数が指定数を超過・形式不正です');
 const warnings=[],seen=new Set(),seenAnswers=new Set(),batchId='B-'+hash([source.hash,settings.hash]).slice(0,24),story=type==='writing'&&items.length?raw.story:null;
 if(type==='writing'&&items.length){need(story&&typeof story==='object','物語構成がありません');for(const k of ['title','genre','opening','development','twist','ending'])text(story[k],'物語 '+k);need(story.genre===settings.genre,'指定ジャンルと一致しません');}
 const candidates=items.map((item,i)=>{
  need(item&&typeof item==='object','問題が不正です');const evidence=evidenceOf(item.evidence,source);let payload;
  if(type==='vocabulary'){
   const word=text(item.word,'英単語',150),sourceExpression=text(item.sourceExpression,'本文中の表現',150);
   need(evidence.some(e=>contains(e.quote,sourceExpression)),'単語の出典表現が根拠にありません');
   payload={word,meaning:text(item.meaning,'日本語訳',500),hint:optional(item.hint,'ヒント'),reading:optional(item.reading,'読み方',150),sourceExpression,evidence};
   if(norm(word)!==norm(sourceExpression))warnings.push('見出語の変形・原形化は教員確認：'+word);
  }else if(type==='writing'){
   const sequence=item.sequence;need(sequence===i+1,'英作文の物語順序が不正です');need(['起','承','転','結'].includes(item.act),'起承転結が不正です');
   const modelAnswer=text(item.modelAnswer,'模範解答'),requiredExpressions=array(item.requiredExpressions,'指定表現'),acceptedAnswers=array(item.acceptedAnswers,'許容解答');
   need(!seenAnswers.has(key(modelAnswer)),'英作文の模範解答が重複しています');seenAnswers.add(key(modelAnswer));
   need(requiredExpressions.every(e=>contains(modelAnswer,e)),'模範解答が指定表現を使用していません');
   need(acceptedAnswers.every(a=>requiredExpressions.every(e=>contains(a,e))),'別解が指定表現を使用していません');
   need(!source.rows.some(r=>key(r.english).includes(key(modelAnswer))),'英作文が本文の複製です。新しいオリジナル文にしてください');
   payload={sequence,act:item.act,japanese:text(item.japanese,'日本語の問題文'),requiredExpressions,modelAnswer,acceptedAnswers,hintGrammar:text(item.hintGrammar,'文法ヒント'),hintWords:text(item.hintWords,'語句ヒント'),explanation:text(item.explanation,'解説'),targets:array(item.targets,'学習ターゲット'),evidence};
   need(payload.targets.length>0,'学習ターゲットが必要です');
  }else{
   const modelAnswer=text(item.modelAnswer,'模範解答');
   payload={question:text(item.question,'設問'),modelAnswer,acceptedAnswers:array(item.acceptedAnswers??[],'許容解答'),explanation:text(item.explanation,'解説'),evidence};
   if(type==='trueFalse'){need(['True','False'].includes(modelAnswer),'正誤の答えはTrue/Falseです');need(item.reasonKind===(modelAnswer==='True'?'supported':'contradicted'),'Falseは本文との明確な矛盾が必要です');payload.reasonKind=item.reasonKind;}
  }
  const fp=fingerprint(type,payload,source);need(!seen.has(fp),'同じ生成結果に重複問題があります');seen.add(fp);
  const candidate={id:'AI-'+batchId.slice(2)+'-'+type+'-'+String(i+1).padStart(3,'0'),batchId,type,subject:source.subject,unitId:source.unitId,unitName:settings.unitName,part:source.part,sourceIds:evidence.map(e=>e.sourceId),sourceHash:source.hash,settingsHash:settings.hash,fingerprint:fp,reviewStatus:'要確認',payload};
  if(story)candidate.story={...story};return {...candidate,contentHash:hash(candidate)};
 });
 if(type==='writing'&&items.length){const acts=items.map(x=>'起承転結'.indexOf(x.act));need(new Set(acts).size===4&&acts.every((v,i)=>!i||v>=acts[i-1]),'物語は起承転結を順番に含めてください');warnings.push('物語の自然さ・英文と日本語の対応・難易度は教員確認が必要です');}
 if(type==='trueFalse'&&items.length>=2){const trueCount=items.filter(x=>x.modelAnswer==='True').length;need(trueCount>0&&trueCount<items.length&&Math.abs(trueCount-(items.length-trueCount))<=1,'True/Falseの数が偏っています');}
 if(type==='qa'&&items.length>=4){const wh=new Set(items.map(x=>norm(x.question).split(' ')[0]));if(wh.size<3)warnings.push('Q&Aの疑問詞が偏っています');}
 if(items.length<settings.counts[type]){text(raw.shortageReason,'不足理由',1000);}
 if(items.length<settings.counts[type])warnings.push('指定'+settings.counts[type]+'問に対し'+items.length+'問：水増しせず不足として報告します');
 return {candidates,warnings,shortage:settings.counts[type]-items.length,reason:clean(raw.shortageReason)};
}
module.exports={TYPES,MASTER,HEADERS,clean,norm,key,hash,text,need,contains,headerMap,buildSource,settingsFor,validateResult,fingerprint};
