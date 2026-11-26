'use strict';
// Explicit opt-in only. Existing TEST01/TEST02 deployments keep the legacy defaults.
const LOW_LATENCY='writing-low-latency-v1';
function profileFor(name='legacy',model){
 if(!['legacy',LOW_LATENCY].includes(name))throw Error('未確認のGemini生成プロファイルです');
 if(name===LOW_LATENCY&&model?.trim()!=='gemini-3.8-flash')throw Error('低遅延プロファイルは確認済みgemini-3.8-flash専用です');
 return {name,timeoutMs:name===LOW_LATENCY?90000:55000,maxOutputTokens:12000,compact:name===LOW_LATENCY,...(name===LOW_LATENCY?{thinkingConfig:{thinkingLevel:'LOW',includeThoughts:false}}:{})};
}
function checkProfileRequest(profile,request){
 if(profile.name==='legacy')return;
 const {type,source,settings}=request;
 if(type!=='writing'||source.subject!=='英C'||source.unitId!=='TEST01'||source.part!=='1'||source.rows.length!==6||Object.entries({vocabulary:0,qa:0,writing:10,trueFalse:0,discussion:0}).some(([k,v])=>settings.counts[k]!==v))throw Error('低遅延プロファイルはTEST01本文6文からの英作文10問だけです');
}
module.exports={LOW_LATENCY,profileFor,checkProfileRequest};
