// VM + in-memory services only. No Firebase, Gemini or GitHub network requests.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../studio-core.cjs');
const questions=()=>({vocabulary:[{question:'ocean',answer:'海',translation:'海'}],cloze:[{question:'We (protect) the ocean.',answer:'私たちは海を守る。',translation:'protectは守る'}],qa:[{question:'What do we protect?',answer:'The ocean.',translation:'何を守りますか'}],trueFalse:[{question:'We protect the ocean.',answer:'True',translation:'海を守る'}],discussion:[{question:'How can you help?',answer:'I collect rubbish.',translation:'どう協力できますか'}]});
const input={subject:'英C',lesson:'TEST',part:'1',source:'We protect the ocean.',count:1};
function harness({teacher=true,provider='google.com',verified=true,quota=true,sha='old',geminiFail=false,model='gemini-configured-test-model',geminiResponse,clock}={}){
 let handler;const calls=[],reads=[],logs=[];
 const ctx={exports:{},Buffer,AbortController,setTimeout:clock?.setTimeout||setTimeout,clearTimeout:clock?.clearTimeout||clearTimeout,console:{error(){},info(line){logs.push(JSON.parse(line))}},process:{env:{STUDIO_ALLOWED_ORIGINS:'https://f9-fish.github.io',STUDIO_GEMINI_MODEL:model}},fetch:async(url,opts)=>{calls.push({url,opts});if(url.includes('generativelanguage'))return geminiResponse?geminiResponse(opts):{ok:!geminiFail,status:geminiFail?503:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({questions:questions()})}]}}]})};if(opts.method==='PUT')return {ok:true,json:async()=>({commit:{sha:'mock-commit'}})};return {ok:true,json:async()=>({sha,type:'file',encoding:'base64',content:Buffer.from('[]').toString('base64')})};},require(name){if(name==='firebase-functions/v2/https')return {onRequest:(config,fn)=>(handler=fn)};if(name==='firebase-functions/params')return {defineSecret:()=>({value:()=> 'mock-secret'})};if(name==='firebase-admin/app')return {getApps:()=>[{}]};if(name==='firebase-admin/auth')return {getAuth:()=>({verifyIdToken:async()=>({uid:'teacher-test',email_verified:verified,firebase:{sign_in_provider:provider}})})};if(name==='firebase-admin/database')return {getDatabase:()=>({ref:p=>(reads.push(p),{get:async()=>({val:()=>teacher}),transaction:async()=>({committed:quota})})})};if(name==='./studio-core.cjs')return core;throw Error(name);}};
 if(model===null)delete ctx.process.env.STUDIO_GEMINI_MODEL;
 vm.runInNewContext(fs.readFileSync(require.resolve('../index.js'),'utf8'),ctx);
 return {calls,reads,logs,async send(action,body=input,{auth=true,origin='https://f9-fish.github.io',method='POST'}={}){const req={headers:{origin,...(auth?{authorization:'Bearer mock-token'}:{})},method,path:'/'+action,body,is:()=>true};let code=200,data;const res={set(){return this},status(c){code=c;return this},json(d){data=d;return this},end(){return this}};await handler(req,res);return {code,data};}};
}
test('studio API rejects unauthenticated, unverified, non-Google and non-teacher users',async()=>{for(const setup of [{teacher:false},{verified:false},{provider:'password'}]){const h=harness(setup);assert.equal((await h.send('generate')).code,403);assert.equal(h.calls.length,0);}const h=harness();assert.equal((await h.send('generate',input,{auth:false})).code,401);assert.equal(h.calls.length,0);});
test('studio API checks CORS before auth or service access',async()=>{const h=harness();assert.equal((await h.send('generate',input,{origin:'https://invalid.example'})).code,403);assert.equal(h.reads.length,0);});
test('studio API quota denial makes no Gemini call',async()=>{const h=harness({quota:false});assert.equal((await h.send('generate')).code,429);assert.equal(h.calls.length,0);});
test('generation uses configured model and sends no UID to Gemini',async()=>{const h=harness();const result=await h.send('generate');assert.equal(result.code,200);assert.equal(Object.keys(result.data.questions).length,5);assert.match(h.calls[0].url,/gemini-configured-test-model/);assert.ok(!h.calls[0].opts.body.includes('teacher-test'));assert.ok(h.reads.includes('studioQuota/teacher-test/generate'));});
test('generation failure returns error without publication',async()=>{const h=harness({geminiFail:true});assert.equal((await h.send('generate')).code,502);assert.equal(h.calls.length,1);});
test('preview reads existing content without GitHub writes',async()=>{const h=harness();const r=await h.send('preview',{...input,questions:questions()});assert.equal(r.code,200);assert.equal(r.data.sha,'old');assert.ok(h.calls.every(c=>c.opts.method==='GET'));});
test('stale publish confirmation refuses GitHub write',async()=>{const h=harness();assert.equal((await h.send('publish',{...input,questions:questions(),expectedSha:'stale'})).code,409);assert.ok(h.calls.every(c=>c.opts.method==='GET'));});
test('mock publish writes only studio-content.json on main with expected SHA',async()=>{const h=harness();const r=await h.send('publish',{...input,questions:questions(),expectedSha:'old'});assert.equal(r.code,200);const put=h.calls.find(c=>c.opts.method==='PUT');assert.equal(put.url,'https://api.github.com/repos/f9-fish/Yoshi.Lab/contents/studio-content.json');const body=JSON.parse(put.opts.body);assert.equal(body.branch,'main');assert.equal(body.sha,'old');const content=JSON.parse(Buffer.from(body.content,'base64').toString());assert.equal(content[0].id,'TEST');});

test('missing or blank model fails before quota and never falls back to another model',async()=>{for(const model of [null,'','   ']){const h=harness({model});const r=await h.send('generate');assert.equal(r.code,503);assert.match(r.data.error,/STUDIO_GEMINI_MODEL/);assert.equal(h.calls.length,0);assert.ok(!h.reads.some(p=>p.startsWith('studioQuota/')));}});
test('explicit model setting is trimmed and used without substitution',async()=>{const h=harness({model:'  gemini-runtime-model-id  '});assert.equal((await h.send('generate')).code,200);assert.ok(h.calls[0].url.includes('/models/gemini-runtime-model-id:generateContent'));});
test('missing generation model does not disable content preview',async()=>{const h=harness({model:''});assert.equal((await h.send('preview',{...input,questions:questions()})).code,200);});

test('Gemini 3.8 Flash requests LOW only for a small batch and keeps the output and time caps', async () => {
 const model='gemini-3.8-flash',h=harness({model});
 assert.equal((await h.send('generate',{...input,count:2})).code,200);
 const request=JSON.parse(h.calls[0].opts.body);
 assert.deepEqual(request.generationConfig,{
  temperature:0.35,responseMimeType:'application/json',maxOutputTokens:8192,
  thinkingConfig:{thinkingLevel:'LOW',includeThoughts:false},
 });
 assert.match(request.contents[0].parts[0].text,/Each array should have up to 2/);
 assert.equal(h.logs[0].timeoutMs,55000);
 assert.equal(h.logs[0].profile,'low');
 for(const [chosen,count] of [[model,3],['gemini-other',2]]){
  const unchanged=harness({model:chosen});
  await unchanged.send('generate',{...input,count});
  assert.equal(JSON.parse(unchanged.calls[0].opts.body).generationConfig.thinkingConfig,undefined);
 }
});

test('distinguishes a local deadline before headers or during body from an upstream HTTP error without retry', async () => {
 for(const stage of ['headers','body']){
  const callbacks=[]; let cleared;
  const pending=signal=>new Promise((_,reject)=>{
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
   callbacks[0]();
  });
  const h=harness({clock:{setTimeout(fn,ms){assert.equal(ms,55000);callbacks.push(fn);return 1},clearTimeout(id){cleared=id}},
   geminiResponse:({signal})=>stage==='headers'?pending(signal):{ok:true,status:200,json:()=>pending(signal)}});
  assert.equal((await h.send('generate')).code,504);
  assert.equal(cleared,1);
  assert.equal(h.calls.length,1);
  assert.equal(h.logs[0].stage,stage);
  assert.equal(h.logs[0].outcome,'deadline');
  assert.equal(h.logs[0].upstreamStatus,stage==='body'?200:undefined);
 }
 const upstream=harness({geminiFail:true});
 assert.equal((await upstream.send('generate')).code,502);
 assert.equal(upstream.logs[0].upstreamStatus,503);
 assert.equal(upstream.logs[0].outcome,'upstream_http_error');
});

test('records only allowlisted token counts, status and timing while retaining all ten questions', async () => {
 const ten=questions();
 for(const rows of Object.values(ten)) rows.push({...rows[0],question:'Another: '+rows[0].question});
 const h=harness({model:'gemini-3.8-flash',geminiResponse:async()=>({ok:true,status:200,json:async()=>({
  usageMetadata:{promptTokenCount:321,candidatesTokenCount:987,thoughtsTokenCount:123,totalTokenCount:1431,extra:'private-output'},
  candidates:[{finishReason:'STOP',content:{parts:[{text:'private-thought',thought:true},{text:JSON.stringify({questions:ten})}]}}],
 })})});
 const result=await h.send('generate',{...input,count:2});
 assert.equal(result.code,200);
 assert.deepEqual(Object.values(result.data.questions).map(rows=>rows.length),[2,2,2,2,2]);
 assert.deepEqual(h.logs.map(({event,outcome,questionCount,finishReason,promptTokenCount,candidatesTokenCount,thoughtsTokenCount,totalTokenCount})=>({
  event,outcome,questionCount,finishReason,promptTokenCount,candidatesTokenCount,thoughtsTokenCount,totalTokenCount
 })),[{event:'studio_gemini_generation',outcome:'success',questionCount:10,finishReason:'STOP',promptTokenCount:321,
  candidatesTokenCount:987,thoughtsTokenCount:123,totalTokenCount:1431}]);
 assert.doesNotMatch(JSON.stringify(h.logs),/private-|mock-secret|mock-token|teacher-test|ocean/);
});
