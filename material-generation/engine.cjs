'use strict';
const {TYPES,buildSource,settingsFor,validateResult,hash,need,key}=require('./core.cjs');
const STATES=Object.freeze(['未生成','生成待ち','生成中','要確認','生成完了','エラー']);
function similarity(a,b){const chars=s=>new Set(key(s).match(/.{1,2}/gu)||[]),x=chars(a),y=chars(b);const union=new Set([...x,...y]);return union.size?[...x].filter(c=>y.has(c)).length/union.size:0;}
function label(c){return c.payload.word||c.payload.japanese||c.payload.question;}
async function generateBatch({master,selection,settings={},checkpoint=null,existingCandidates=[]},{generate,onProgress=()=>{},maxKindsPerRun=5}){
 need(typeof generate==='function','生成アダプタを明示してください');const source=buildSource(master,selection),config=settingsFor(source,settings),batchId='B-'+hash([source.hash,config.hash]).slice(0,24);
 if(checkpoint)need(checkpoint.batchId===batchId&&checkpoint.sourceHash===source.hash&&checkpoint.settingsHash===config.hash,'本文または設定が変わっています。古い生成途中データは利用できません');
 need(Number.isInteger(maxKindsPerRun)&&maxKindsPerRun>=1&&maxKindsPerRun<=5,'1回の生成種類数は1〜5です');
 let calls=0,pending=0;const results={},rawResults={},candidates=[],errors=[],warnings=[];
 await onProgress({state:'生成待ち',batchId});
 for(const type of TYPES){
  if(!config.counts[type])continue;
  try{
   await onProgress({state:'生成中',batchId,type});
   const cached=checkpoint?.rawResults?.[type];
   if(cached===undefined&&calls>=maxKindsPerRun){pending++;results[type]={requested:config.counts[type],pending:true};continue;}
   let raw=cached;if(raw===undefined){calls++;raw=await generate({type,source,settings:config});}
   const validated=validateResult(type,raw,source,config);rawResults[type]=raw;
   const duplicates=[],kept=[];
   for(const c of validated.candidates){
    const existing=existingCandidates.filter(e=>e.type===c.type&&e.subject===c.subject&&e.unitId===c.unitId&&e.part===c.part);
    if(existing.some(e=>e.fingerprint===c.fingerprint)){duplicates.push(c.id);continue;}
    if(existing.some(e=>similarity(label(e),label(c))>=.72))warnings.push('類似候補の教員確認：'+c.id);
    kept.push(c);
   }
   candidates.push(...kept);results[type]={requested:config.counts[type],generated:validated.candidates.length,retained:kept.length,shortage:validated.shortage,duplicates:duplicates.length,shortageReason:validated.reason,warnings:validated.warnings};
   warnings.push(...validated.warnings.map(w=>type+'：'+w));
  }catch(e){errors.push({type,message:e.message});results[type]={requested:config.counts[type],error:e.message};}
 }
 const state=errors.length?'エラー':pending?'生成待ち':'要確認';await onProgress({state,batchId});
 return {schemaVersion:1,batchId,sourceHash:source.hash,settingsHash:config.hash,state,candidates,results,errors,warnings,checkpoint:{batchId,sourceHash:source.hash,settingsHash:config.hash,rawResults},requiresTeacherReview:true,publishEnabled:false};
}
module.exports={STATES,generateBatch};
