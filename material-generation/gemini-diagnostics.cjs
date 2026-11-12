'use strict';
// An allowlist, never a generic error/header/body serializer.
const EVENTS=new Set(['success','http_error','timeout','cancelled','network_error','invalid_response']);
const STATUSES=new Set(['INVALID_ARGUMENT','FAILED_PRECONDITION','OUT_OF_RANGE','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','RESOURCE_EXHAUSTED','CANCELLED','DEADLINE_EXCEEDED','INTERNAL','UNAVAILABLE','UNKNOWN','UNIMPLEMENTED','DATA_LOSS']);
function sanitizeDiagnostic(value){
 if(!value||!EVENTS.has(value.event))return null;
 const out={component:'material_gemini',event:value.event,retryAttempted:false};
 if(typeof value.modelId==='string'&&/^gemini-[a-z0-9._-]{1,80}$/i.test(value.modelId))out.modelId=value.modelId;
 if(['vocabulary','qa','writing','trueFalse','discussion'].includes(value.type))out.type=value.type;
 for(const name of ['elapsedMs','timeoutMs','requestBytes','sourceRows','maxOutputTokens'])if(Number.isSafeInteger(value[name])&&value[name]>=0&&value[name]<=100000000)out[name]=value[name];
 for(const name of ['httpStatus','providerCode'])if(Number.isInteger(value[name])&&value[name]>=100&&value[name]<=599)out[name]=value[name];
 if(STATUSES.has(value.providerStatus))out.providerStatus=value.providerStatus;
 if(Number.isInteger(value.retryAfterSeconds)&&value.retryAfterSeconds>=0&&value.retryAfterSeconds<=86400)out.retryAfterSeconds=value.retryAfterSeconds;
 return out;
}
module.exports={sanitizeDiagnostic};
