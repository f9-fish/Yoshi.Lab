/* Shared by the browser, Node tests and Apps Script (paste as WordbookData.gs). */
var YoshiWordbookData=(function(){
 'use strict';
 const clean=v=>String(v??'').replace(/_x000D_/gi,'').replace(/\r\n?/g,'\n').trim();
 const normalize=v=>clean(v).normalize('NFKC').replace(/[’‘]/g,"'").replace(/\s+/g,' ').toLowerCase();
 const sentenceKey=v=>normalize(v).replace(/\s+([,.!?;:])/g,'$1').replace(/[.!?]+$/,'');
 const lines=v=>clean(v).split(/\n|\|\|/).map(clean).filter(Boolean);
 const meaning=v=>clean(v).split(/[\n→]/)[0].replace(/【[^】]*】/g,'').replace(/^[①-⑳\s]+/,'').trim();
 const tokens=v=>clean(v).match(/\S+/gu)||[];
 const reorderable=v=>{const t=tokens(v);return t.length>=2&&t.length<=32&&!/[.!?]["”']?\s+\S/.test(v)&&!/[─―]|\n/.test(v);};
 function fromSheets(sheets,options={}){
  const words=[],warnings=[],errors=[],seen=new Set(),numbers=new Map(),scope=options.scope||'ALL';
  const expected=['Unit','見出番号','見出語','見出語日本語','フレーズ','フレーズ日本語','例文','例文日本語','活用'];
  for(const sheet of sheets){
   const stage=clean(sheet.name);if(!/^STAGE[0-3]$/.test(stage))continue;
   const values=sheet.values;if(!Array.isArray(values)||!values.length){errors.push(stage+'：ヘッダーがありません');continue;}
   const headers=values[0].map(clean),column={};
   for(const h of expected){const matches=headers.flatMap((v,i)=>v===h?[i]:[]);if(matches.length!==1)errors.push(stage+'：列の不足・重複 '+h);column[h]=matches[0];}
   if(expected.some(h=>column[h]===undefined))continue;
   let current=null;
   values.slice(1).forEach((row,i)=>{
    if(!row.some(v=>clean(v)))return;
    const get=h=>column[h]===undefined?'':clean(row[column[h]]),extra=h=>headers.includes(h)?clean(row[headers.indexOf(h)]):'';
    const number=get('見出番号'),word=get('見出語'),unit=get('Unit'),where=stage+' 行'+(i+2);
    if(number||word){
     current=null;if(!number||!word||!unit||!get('見出語日本語')||!/^\d+$/.test(number)||Number(number)<1){errors.push(where+'：見出語の必須項目を確認してください');return;}
     const numberKey=stage+':'+Number(number),previous=numbers.get(numberKey);
     if(previous&&previous!==unit)warnings.push(where+'：見出番号 '+number+' が別Unit（'+previous+'）にもあります。Unitを含むIDで区別し、原本の番号は変更しません');
     numbers.set(numberKey,unit);
     const id='wb-'+stage.toLowerCase()+'-'+normalize(unit).replace(/\s+/g,'-')+'-'+Number(number);if(seen.has(id)){errors.push(where+'：見出番号が重複しています');return;}seen.add(id);
     current={id,stage,unit,number:Number(number),word,meaning:get('見出語日本語'),practiceMeaning:extra('出題用日本語')||meaning(get('見出語日本語')),acceptedAnswers:lines(extra('スペリング別解')),phrase:get('フレーズ'),phraseJapanese:get('フレーズ日本語'),inflections:get('活用'),status:headers.includes('公開状態')?(extra('公開状態')==='公開'?'公開':'非公開'):'公開',examples:[]};
     words.push(current);
    }else if(unit&&current&&unit!==current.unit){errors.push(where+'：続き行のUnitが一致しません');return;}
    const english=get('例文'),japanese=get('例文日本語');
    if(!current){warnings.push(where+'：対応する見出語がない行を除外しました');return;}
    if(!english&&!japanese)return;
    if(!english||!japanese){errors.push(where+'：例文と和訳の両方が必要です');return;}
    if(!number&&extra('公開状態')&&extra('公開状態')!=='公開')return;
    const explicit=extra('並び替え対象');
    current.examples.push({id:current.id+'-ex'+(current.examples.length+1),english,japanese,phrase:get('フレーズ'),phraseJapanese:get('フレーズ日本語'),reorder:explicit?explicit==='使用':reorderable(english),acceptedOrders:lines(extra('並び替え別解'))});
   });
  }
  const selected=words.filter(w=>w.status==='公開'&&(scope==='ALL'||w.stage+':'+w.unit===scope));
  selected.sort((a,b)=>a.stage.localeCompare(b.stage)||a.number-b.number);
  return {data:{schemaVersion:1,scope,words:selected},warnings,errors};
 }
 function parse(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.words))throw Error('単語帳データの形式を確認してください');
  const seen=new Set();return data.words.filter(w=>w?.status==='公開').map(w=>{
   if(!w.id||seen.has(w.id)||!/^STAGE[0-3]$/.test(w.stage)||!clean(w.unit)||!clean(w.word)||!clean(w.practiceMeaning)||!Number.isInteger(w.number)||w.number<1||!Array.isArray(w.examples)||!Array.isArray(w.acceptedAnswers))throw Error('単語帳の必須項目・重複を確認してください');seen.add(w.id);
   const ids=new Set();const examples=w.examples.map(e=>{if(!e.id||ids.has(e.id)||!clean(e.english)||!clean(e.japanese)||typeof e.reorder!=='boolean'||!Array.isArray(e.acceptedOrders))throw Error('例文の形式を確認してください');ids.add(e.id);return {...e,english:clean(e.english),japanese:clean(e.japanese),acceptedOrders:e.acceptedOrders.map(clean)};});
   return {...w,word:clean(w.word),practiceMeaning:clean(w.practiceMeaning),acceptedAnswers:w.acceptedAnswers.map(clean).filter(Boolean),examples};
  });
 }
 function shuffle(input,random=Math.random){const a=[...input];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function choices(word,pool,random=Math.random){
  const used=new Set([normalize(word.word),...word.acceptedAnswers.map(normalize)]),seenMeanings=new Set([normalize(word.practiceMeaning)]),others=[];
  for(const w of shuffle(pool,random)){const key=normalize(w.word),m=normalize(w.practiceMeaning);if(used.has(key)||seenMeanings.has(m))continue;used.add(key);seenMeanings.add(m);others.push({word:w.word,meaning:w.practiceMeaning});if(others.length===3)break;}
  return others.length===3?shuffle([{word:word.word,meaning:word.practiceMeaning},...others],random):[];
 }
 function questions(rows,stage,unit,mode,random=Math.random){
  const list=rows.filter(w=>w.stage===stage&&w.unit===unit),pool=rows.filter(w=>w.stage===stage),out=[];
  for(const word of list){
   if(mode==='choice'){const options=choices(word,[...list,...pool.filter(w=>w.unit!==unit)],random);if(options.length===4)out.push({id:word.id,prompt:word.practiceMeaning,answer:word.word,accepted:word.acceptedAnswers,options,word});}
   else if(mode==='spelling')out.push({id:word.id,prompt:word.practiceMeaning,answer:word.word,accepted:word.acceptedAnswers,word});
   else if(mode==='reorder')for(const example of word.examples){const parts=tokens(example.english);if(example.reorder&&parts.length>=2&&parts.length<=32)out.push({id:example.id,prompt:example.japanese,answer:example.english,accepted:example.acceptedOrders,word,tokens:parts});}
   else throw Error('練習形式が不正です');
  }
  return shuffle(out,random).slice(0,10);
 }
 function judge(q,answer,mode){const key=mode==='reorder'?sentenceKey:normalize;return !!key(answer)&&[q.answer,...q.accepted].some(a=>key(a)===key(answer));}
 function shuffledTokens(parts,random=Math.random){let result=shuffle(parts.map((text,id)=>({id,text})),random);if(result.length>1&&result.every((t,i)=>t.text===parts[i]))result.push(result.shift());return result;}
 const api={clean,normalize,sentenceKey,meaning,tokens,reorderable,fromSheets,parse,shuffle,choices,questions,judge,shuffledTokens};return api;
})();
if(typeof module==='object'&&module.exports)module.exports=YoshiWordbookData;
