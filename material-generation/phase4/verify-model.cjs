'use strict';
// Reads a Secret Manager pipe through stdin, never args, URL query, file, or logs.
async function verifyModel({model,apiKey,fetchImpl=fetch}){
 if(!/^gemini-[a-z0-9._-]+$/i.test(model||'')||!apiKey?.trim())throw Error('モデルIDとSecret設定が必要です');
 const response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model),{headers:{'x-goog-api-key':apiKey.trim()},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('モデル照会失敗 HTTP '+response.status+'。代替モデルは自動選択しません');
 const value=await response.json();
 if(value.name!=='models/'+model||!value.supportedGenerationMethods?.includes('generateContent'))throw Error('モデルIDまたはgenerateContent対応を確認できません');
 return {modelId:model,generateContentSupported:true,inputTokenLimit:value.inputTokenLimit,outputTokenLimit:value.outputTokenLimit,verifiedAt:new Date().toISOString()};
}
if(require.main===module){(async()=>{const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>16384)throw Error('Secret入力サイズ不正');chunks.push(chunk);}const result=await verifyModel({model:process.argv[2],apiKey:Buffer.concat(chunks).toString('utf8')});console.log(JSON.stringify(result));})().catch(e=>{console.error(/^モデル|^Secret/.test(e.message)?e.message:'モデル照会に失敗しました。認証・通信・モデル設定を確認してください');process.exitCode=1;});}
module.exports={verifyModel};
