'use strict';
const {ReviewError}=require('./review-core.cjs');
function createOpenAI({apiKey,fetchImpl=fetch,timeoutMs=18000}){
 return async ({instructions,question,answer,schema})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const input=JSON.stringify({question,studentAnswer:answer});
   if(Buffer.byteLength(input+instructions)>24000)throw new Error('input-too-large');
   const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+apiKey(),'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:'gpt-4.1-mini',store:false,max_output_tokens:1000,instructions,input,text:{format:{type:'json_schema',name:'writing_feedback',strict:true,schema}}})});
   if(!response.ok){await response.body?.cancel();throw new Error('provider-error');}
   const reader=response.body.getReader();let bytes=0;const chunks=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>64000){await reader.cancel();throw new Error('oversize');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(payload.status!=='completed')throw new Error('incomplete');
   const messages=(payload.output||[]).filter(item=>item.type==='message'&&item.role==='assistant');
   const parts=messages.flatMap(item=>item.content||[]);
   if(parts.some(p=>p.type==='refusal'))throw new Error('refusal');
   const text=parts.filter(p=>p.type==='output_text').map(p=>p.text).join('');
   if(!text||Buffer.byteLength(text)>8000)throw new Error('invalid-output');
   return JSON.parse(text);
  }catch{throw new ReviewError('unavailable','AI添削に接続できませんでした。');}
  finally{clearTimeout(timer);}
 };
}
module.exports={createOpenAI};
