// VM + in-memory services only. No Firebase, Gemini or GitHub network requests.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../studio-core.cjs');
const master=require('../textbook-master.cjs');
const questions=()=>({vocabulary:[{question:'ocean',answer:'海',translation:'海'}],cloze:[{question:'We (protect) the ocean.',answer:'私たちは海を守る。',translation:'protectは守る'}],qa:[{question:'What do we protect?',answer:'The ocean.',translation:'何を守りますか'}],trueFalse:[{question:'We protect the ocean.',answer:'True',translation:'海を守る'}],discussion:[{question:'How can you help?',answer:'I collect rubbish.',translation:'どう協力できますか'}]});
const input={subject:'英C',lesson:'TEST',part:'1',source:'We protect the ocean.',count:1};
function harness({uid='teacher-test',teacher=true,provider='google.com',verified=true,quota=true,sha='old',geminiFail=false,model='gemini-configured-test-model',geminiResponse,githubResponse,clock,masterConfig={},masterResponse}={}){
 let handler;const calls=[],reads=[],logs=[];
 const ctx={exports:{},Buffer,AbortController,setTimeout:clock?.setTimeout||setTimeout,clearTimeout:clock?.clearTimeout||clearTimeout,console:{error(){},info(line){logs.push(JSON.parse(line))}},process:{env:{STUDIO_ALLOWED_ORIGINS:'https://f9-fish.github.io',STUDIO_GEMINI_MODEL:model,...masterConfig}},fetch:async(url,opts)=>{calls.push({url,opts});if(url.startsWith('https://iamcredentials.googleapis.com')||url.startsWith('https://sheets.googleapis.com'))return masterResponse(url,opts);if(url.includes('generativelanguage'))return geminiResponse?geminiResponse(opts):{ok:!geminiFail,status:geminiFail?503:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({questions:questions()})}]}}]})};if(githubResponse)return githubResponse(url,opts);if(opts.method==='PUT')return {ok:true,json:async()=>({commit:{sha:'mock-commit'}})};return {ok:true,json:async()=>({sha,type:'file',encoding:'base64',content:Buffer.from('[]').toString('base64')})};},require(name){if(name==='firebase-functions/v2/https')return {onRequest:(config,fn)=>(handler=fn)};if(name==='firebase-functions/params')return {defineSecret:()=>({value:()=> 'mock-secret'})};if(name==='firebase-admin/app')return {getApps:()=>[{}],applicationDefault:()=>({getAccessToken:async()=>({access_token:'mock-runtime'})})};if(name==='firebase-admin/auth')return {getAuth:()=>({verifyIdToken:async()=>({uid,email_verified:verified,firebase:{sign_in_provider:provider}})})};if(name==='firebase-admin/database')return {getDatabase:()=>({ref:p=>(reads.push(p),{get:async()=>({val:()=>teacher}),transaction:async()=>({committed:quota})})})};if(name==='./studio-core.cjs')return core;if(name==='./textbook-master.cjs')return master;if(name==='./question-master.cjs')return require('../question-master.cjs');throw Error(name);}};
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

test('textbook master is available only to authorized teachers and uses no generation quota or publication', async () => {
 const selection={subject:'英C',lesson:'8',part:'1'};
 for(const [setup,options,status] of [[{}, {auth:false},401],[{teacher:false},{},403],[{provider:'password'},{},403],
  [{},{origin:'https://unapproved.example'},403]]){
  const h=harness(setup);
  assert.equal((await h.send('textbook-master',selection,options)).code,status);
  assert.equal(h.calls.length,0);
 }
 const disabled=harness({model:''});
 assert.equal((await disabled.send('textbook-master',selection)).code,503);
 assert.equal(disabled.calls.length,0);
 const h=harness({model:'',masterConfig:{STUDIO_MASTER_SPREADSHEET_ID:'fake-sheet-id-1234567890123',
  STUDIO_MASTER_READER_SERVICE_ACCOUNT:'reader@sample-project.iam.gserviceaccount.com'},
 masterResponse(url,opts){
  if(url.includes('iamcredentials.googleapis.com'))return {ok:true,json:async()=>({accessToken:'ephemeral-reader'})};
  return new Response(JSON.stringify({values:[master.HEADERS,
   ['b','英C','8','1','2','Second.','private translation'],
   ['a','英C','8','Part 1','1','First.','private translation']]}));
 }});
 const result=await h.send('textbook-master',selection);
 assert.equal(result.code,200);
 assert.deepEqual(result.data,{source:'First.\nSecond.',sentenceCount:2});
 assert.deepEqual(h.reads,['teacherUids/teacher-test']);
 assert.equal(h.calls.length,2);
 assert.equal(h.calls[0].opts.method,'POST');
 assert.deepEqual(JSON.parse(h.calls[0].opts.body),{scope:['https://www.googleapis.com/auth/spreadsheets.readonly'],lifetime:'300s'});
 assert.equal(h.calls[1].opts.method,'GET');
 assert.match(decodeURIComponent(h.calls[1].url),/\/values\/'教科書本文マスター'/);
 assert.equal(h.calls[1].opts.headers.Authorization,'Bearer ephemeral-reader');
 assert.doesNotMatch(JSON.stringify(result),/private|ephemeral/);
});

test('runtime diagnostic reads only the test sheet header after teacher auth', async () => {
 const masterConfig={
  STUDIO_MASTER_SPREADSHEET_ID:'1ClfR5S6qYTCbKOjjs4Aq3KFQjnOH2QIhysMpppv5_1Q',
  STUDIO_MASTER_READER_SERVICE_ACCOUNT:'reader@sample-project.iam.gserviceaccount.com'
 };
 for(const [setup,options,status] of [
  [{},{auth:false},401],[{teacher:false},{},403],[{provider:'anonymous'},{},403],
  [{},{origin:'https://not-allowed.example'},403],
  [{masterConfig:{...masterConfig,STUDIO_MASTER_SPREADSHEET_ID:'different-sheet-id-123456789'}},{},503],
 ]){
  const h=harness({masterConfig,...setup});
  assert.equal((await h.send('textbook-master/check',{},options)).code,status);
  assert.equal(h.calls.length,0);
 }
 for(const [upstream,headers,status] of [
  ['ok',master.HEADERS,200],['ok',['wrong'],422],['denied',master.HEADERS,502],
  ['token-denied',master.HEADERS,502]
 ]){
  const h=harness({model:'',quota:false,masterConfig,masterResponse(url,opts){
   if(url.includes('iamcredentials.googleapis.com')){
    assert.equal(opts.headers.Authorization,'Bearer mock-runtime');
    assert.deepEqual(JSON.parse(opts.body),{scope:['https://www.googleapis.com/auth/spreadsheets.readonly'],lifetime:'300s'});
    return {ok:upstream!=='token-denied',json:async()=>({accessToken:'ephemeral-reader'})};
   }
   assert.equal(opts.method,'GET');
   assert.equal(opts.headers.Authorization,'Bearer ephemeral-reader');
   assert.equal(decodeURIComponent(new URL(url).pathname),"/v4/spreadsheets/"+masterConfig.STUDIO_MASTER_SPREADSHEET_ID+"/values/'教科書本文マスター'!1:1");
   return new Response(JSON.stringify({values:[headers]}),{status:upstream==='denied'?403:200});
  }});
  const result=await h.send('textbook-master/check',{spreadsheetId:'caller-supplied'});
  assert.equal(result.code,status);
  assert.deepEqual(h.reads,['teacherUids/teacher-test']);
  assert.equal(h.calls.length,upstream==='token-denied'?1:2);
  if(status===200)assert.deepEqual({...result.data},{headerVerified:true});
  assert.doesNotMatch(JSON.stringify({result,logs:h.logs}),/ephemeral|mock-runtime|原文ID/);
 }
});

test('separate save atomically stores all ten generated questions and verifies retries',async()=>{
 const batchId='751fc4af-84a0-48b0-9981-79e998adf540';
 const config={STUDIO_QUESTION_MASTER_SPREADSHEET_ID:'independent-sheet-id-123456789',
  STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT:'writer@sample-project.iam.gserviceaccount.com'};
 const ten=Object.fromEntries(Object.entries(questions()).map(([type,items])=>[type,[items[0],
  {...items[0],question:items[0].question+' 2'}]]));
 let cells,writeAttempts=0,tabs=0;
 const h=harness({masterConfig:config,
  geminiResponse:()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({questions:ten})}]}}]})}),
  masterResponse(url,opts){
   if(url.includes('iamcredentials'))return {ok:true,json:async()=>({accessToken:'writer-token'})};
   if(url.endsWith(':batchUpdate')){
    writeAttempts++;
    const [add,update]=JSON.parse(opts.body).requests;
    assert.equal(add.addSheet.properties.sheetId,update.updateCells.start.sheetId);
    if(cells)return {ok:false,status:400};
    tabs++;
    cells=update.updateCells.rows.map(row=>row.values.map(v=>v.userEnteredValue.stringValue));
    throw Error('response lost after commit');
   }
   if(url.includes('?fields='))return {ok:true,json:async()=>({sheets:[{properties:{title:'batch_'+batchId.replaceAll('-','_'),index:1}}]})};
   if(url.includes(':batchGet'))return {ok:true,json:async()=>({valueRanges:[{values:cells}]})};
   assert.equal(opts.method,'GET');
   return {ok:true,json:async()=>({values:cells})};
  }});
 const generated=await h.send('generate',{...input,count:2});
 assert.equal(generated.code,200);
 assert.equal(generated.data.sharedDraft,true);
 assert.equal(h.calls.length,1);
 const data={...input,count:2,batchId,questions:generated.data.questions};
 const saved=await Promise.all([h.send('question-master/save',data),h.send('question-master/save',data)]);
 assert.ok(saved.every(r=>r.code===200&&r.data.savedCount===10));
 assert.equal(tabs,1);
 assert.equal(writeAttempts,2);
 assert.ok(cells.slice(1,-1).every(row=>row[10]==='要確認'&&row[14]==='teacher-test'));
 assert.ok(cells.slice(1,-1).every(row=>row[15].length===64));
 const history=await h.send('question-master/search',{subject:'英C',type:'cloze',status:'要確認'});
 assert.equal(history.code,200);
 assert.equal(history.data.batches[0].items.length,2);
 assert.equal(history.data.batches[0].batchId,batchId);
 assert.equal(history.data.batches[0].source,input.source);
 assert.equal((await h.send('question-master/save',{...data,source:'Changed source'})).code,409);
 assert.equal((await h.send('publish',{...data,expectedSha:'old'})).code,400);
 assert.ok(h.calls.every(c=>!c.url.includes('api.github.com')));
});

test('question master saves fail closed for unauthorized teachers, permission and network failure',async()=>{
 const data={...input,batchId:'751fc4af-84a0-48b0-9981-79e998adf540',questions:questions()};
 const config={STUDIO_QUESTION_MASTER_SPREADSHEET_ID:'independent-sheet-id-123456789',
  STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT:'writer@sample-project.iam.gserviceaccount.com'};
 for(const [setup,status] of [[{},503],[{teacher:false,masterConfig:config},403]]){
  const h=harness(setup);
  assert.equal((await h.send('question-master/save',data)).code,status);
  assert.equal(h.calls.length,0);
 }
 for(const reply of [()=>({ok:false,status:403}),()=>{throw new DOMException('timeout','TimeoutError')}]){
  const h=harness({masterConfig:config,masterResponse(url){
   if(url.includes('iamcredentials'))return {ok:true,json:async()=>({accessToken:'writer-secret-response'})};
   return reply();
  }});
  const saved=await h.send('question-master/save',data);
  assert.equal(saved.code,502);
  assert.doesNotMatch(JSON.stringify(saved),/writer-secret-response/);
 }
});

for(const replacing of [false,true])test('managed publication preserves other groups and recovers once (replacement='+replacing+')',async()=>{
 const config={STUDIO_QUESTION_MASTER_SPREADSHEET_ID:'independent-sheet-id-123456789',
  STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT:'writer@sample-project.iam.gserviceaccount.com'};
 const batchId='751fc4af-84a0-48b0-9981-79e998adf540';
 const ten=Object.fromEntries(Object.entries(questions()).map(([type,[item]])=>[
  type,[item,{...item,question:item.question+' 2'}]
 ]));
 const seed={...input,lesson:'8',count:2,batchId,questions:ten};
 const oldSha='a'.repeat(40),commit='b'.repeat(40);
 const unrelated={subject:'論表',id:seed.lesson,name:input.part,questions:questions()};
 const existingSlot={subject:input.subject,id:seed.lesson,name:input.part,questions:questions()};
 let rows,entries=replacing?[existingSlot,unrelated]:[unrelated],history=[],puts=0,failFinish=true;
 const locks=new Set();
 const reply=(payload,status=200)=>({ok:status===200,status,json:async()=>structuredClone(payload)});
 const setup={
  masterConfig:config,
  masterResponse(url,opts){
   if(url.includes('iamcredentials'))return reply({accessToken:'writer-token'});
   if(!url.endsWith(':batchUpdate'))return reply({values:rows});
   const [guard,update]=JSON.parse(opts.body).requests;
   const changed=update.updateCells.rows.map(row=>row.values.map(v=>v.userEnteredValue.stringValue));
   if(guard.addSheet){rows=changed;return reply({});}
   const lock=guard.createDeveloperMetadata.developerMetadata.metadataId;
   if(locks.has(lock))return reply({},400);
   if(changed.some(row=>row[10]==='公開済')&&failFinish){failFinish=false;return reply({},503);}
   locks.add(lock);rows=[rows[0],...changed,rows.at(-1)];return reply({});
  },
  githubResponse(url,opts){
   if(opts.method==='PUT'){
    puts++;
    const info=JSON.parse(opts.body);
    assert.equal(info.sha,oldSha);
    entries=JSON.parse(Buffer.from(info.content,'base64'));
    history=[{sha:commit,commit:{message:info.message,committer:{date:new Date().toISOString()}}}];
    return reply({commit:{sha:commit}});
   }
   if(url.includes('/commits?'))return reply(history);
   return reply({type:'file',encoding:'base64',sha:history.length?'c'.repeat(40):oldSha,
    content:Buffer.from(JSON.stringify(entries)).toString('base64')});
  }
 };
 const h=harness(setup), concurrent=harness(setup);
 assert.equal((await h.send('question-master/save',seed)).data.savedCount,10);
 const first=rows[1][2];
 const edit={batchId,questionId:first,version:1,operation:'edit',question:'waves',answer:'波',translation:'海の波',accepted:true};
 const race=await Promise.all([h.send('question-master/update',edit),concurrent.send('question-master/update',{...edit,question:'sand'})]);
 assert.deepEqual(race.map(r=>r.code).sort(),[200,409]);
 assert.equal((await h.send('preview',{batchId,version:2})).code,400);
 assert.equal(puts,0);
 assert.equal((await h.send('question-master/update',{batchId,questionId:first,version:2,operation:'approve'})).code,200);
 const beforePreview=h.calls.length;
 const preview=await h.send('preview',{batchId,version:3});
 assert.ok(h.calls.slice(beforePreview).every(({url,opts})=>opts.method==='GET'||url.includes('iamcredentials')));
 assert.equal(preview.data.slot,'英C / Lesson 8 / Part 1');
 assert.equal(preview.code,200);
 assert.equal(preview.data.newCount,1);
 assert.equal(preview.data.replacing,false);
 assert.equal(preview.data.appending,true);
 assert.equal((await h.send('publish',{batchId,version:3,expectedSha:'d'.repeat(40),allowReplace:replacing})).code,409);
 assert.equal(puts,0);
 assert.equal(rows[1][16],'');
 assert.equal((await h.send('publish',{batchId,version:3,expectedSha:preview.data.sha,allowReplace:replacing})).code,502);
 assert.equal(puts,1);
 assert.equal(rows[1][10],'承認済');
 const published=entries.filter(entry=>entry.subject===input.subject&&entry.id===seed.lesson&&entry.name===input.part);
 assert.equal(published.length,1);
 assert.equal(published[0].questions.vocabulary.length,replacing?2:1);
 assert.deepEqual(published[0].questions.cloze,replacing?existingSlot.questions.cloze:[]);
 assert.deepEqual(entries.find(entry=>entry.subject==='論表'),unrelated);
 const recovery=await concurrent.send('preview',{batchId,version:4});
 assert.equal(recovery.data.pending,true);
 assert.equal((await concurrent.send('publish',{batchId,version:4,expectedSha:recovery.data.sha})).code,200);
 assert.equal(puts,1);
 assert.equal(rows[1][10],'公開済');
 assert.equal(rows[1][17],commit);
 assert.ok(rows.slice(2,-1).every(row=>row[10]==='要確認'));
 assert.equal((await h.send('question-master/update',{batchId,questionId:first,version:5,operation:'return'})).code,409);
});

test('pilot limits shared writes to one teacher and blocks pilot publication',async()=>{
 const masterConfig={STUDIO_QUESTION_MASTER_SPREADSHEET_ID:'independent-sheet-id-123456789',
  STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT:'writer@sample-project.iam.gserviceaccount.com',
  STUDIO_QUESTION_MASTER_PILOT_TEACHER_UID:'teacher-test'};
 const pilot=harness({masterConfig});
 assert.equal((await pilot.send('generate')).data.sharedDraft,true);
 for(const route of ['preview','publish'])assert.equal((await pilot.send(route)).code,409);
 assert.equal(pilot.calls.length,1);
 const peer=harness({masterConfig,uid:'other-teacher'});
 for(const action of ['save','search','update'])
  assert.equal((await peer.send('question-master/'+action)).code,403);
 assert.equal(peer.calls.length,0);
 assert.equal((await peer.send('generate')).data.sharedDraft,undefined);
 assert.equal((await peer.send('publish',{...input,questions:questions(),expectedSha:'old'})).code,200);
});

test('connection-only rollout reads metadata and disables the shared write path',async()=>{
 const sheet='independent-sheet-id-123456789';
 const config={STUDIO_QUESTION_MASTER_SPREADSHEET_ID:sheet,
  STUDIO_QUESTION_MASTER_WRITER_SERVICE_ACCOUNT:'writer@sample-project.iam.gserviceaccount.com',
  STUDIO_QUESTION_MASTER_CONNECTION_ONLY:'true'};
 const denied=harness({teacher:false,masterConfig:config});
 assert.equal((await denied.send('question-master/check',{})).code,403);
 assert.equal(denied.calls.length,0);
 const h=harness({masterConfig:config,masterResponse(url,opts){
  if(url.includes('iamcredentials')){
   assert.deepEqual(JSON.parse(opts.body).scope,['https://www.googleapis.com/auth/spreadsheets.readonly']);
   return {ok:true,json:async()=>({accessToken:'mock-writer-token'})};
  }
  assert.equal(opts.method,'GET');
  assert.ok(url.endsWith(sheet+'?fields=spreadsheetId'));
  return {ok:true,json:async()=>({spreadsheetId:sheet})};
 }});
 for(const action of ['save','update','search'])assert.equal((await h.send('question-master/'+action,{})).code,503);
 assert.equal(h.calls.length,0);
 const result=await h.send('question-master/check',{spreadsheetId:'ignored'});
 assert.deepEqual({...result.data},{connected:true,readOnly:true});
 assert.equal(h.calls.length,2);
 assert.equal((await h.send('generate')).data.sharedDraft,undefined);
 assert.equal((await h.send('publish',{...input,questions:questions(),expectedSha:'old'})).code,200);
});

test('practice format generates ten questions with separate words and idioms and keeps LOW',async()=>{
 const legacy=questions();
 delete legacy.trueFalse;
 legacy.idiom=[{question:'due to',answer:'〜が理由で',translation:'原因を示す'}];
 const ten=Object.fromEntries(Object.entries(legacy).map(([kind,[item]])=>[
  kind,[item,{...item,question:item.question+' 2'}]
 ]));
 const h=harness({model:'gemini-3.8-flash',geminiResponse(opts){
  const request=JSON.parse(opts.body);
  assert.equal(request.generationConfig.thinkingConfig.thinkingLevel,'LOW');
  assert.match(request.contents[0].parts[0].text,/vocabulary, idiom, cloze, qa, discussion/);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({questions:ten})}]}}]})};
 }});
 const result=await h.send('generate',{...input,count:2,practiceFormat:2});
 assert.equal(result.code,200);
 assert.equal(result.data.questions.idiom.length,2);
 assert.deepEqual(result.data.questions.trueFalse,[]);
 assert.equal(Object.values(result.data.questions).flat().length,10);
});
