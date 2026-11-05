const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {context,read,accountHarness,functionFromLine}=require('./helpers/app-harness.cjs');
const sandbox=context();vm.runInContext(read('eiken-training.js'),sandbox);
const core=vm.runInContext('YoshiEiken',sandbox);
const id='01234567-0123-4123-8123-0123456789ab';
const payload=(overrides={})=>({sessionId:id,grade:'準2級',right:8,total:10,bestStreak:4,durationSeconds:60,...overrides});
const fixture=(i=1,answer=1)=>({id:'P2-'+i,grade:'準2級',sentence:'Question '+i+' (　　).',
  choices:['first','second','third','fourth'],answer,correctWord:['first','second','third','fourth'][answer-1],translation:'和訳 '+i,explanation:'解説 '+i});
const tick=()=>new Promise(setImmediate);

for(const [grade,file] of [['pre2','eiken_pre2.json'],['2','eiken_2.json']])test(`published ${file} matches the EIKEN contract`,()=>{
  const data=JSON.parse(read(file)),parsed=core.questions(data,grade);
  assert.equal(parsed.invalid,0);assert.equal(parsed.valid.length,data.length);
});
for(const answer of [1,2,3,4])test(`EIKEN answer ${answer} uses 1-based indexing`,()=>{
  const q=fixture(1,answer),s={grade:'pre2',questions:[q],answers:[answer]};
  assert.equal(core.score(s).right,1);assert.equal(core.score({...s,answers:[answer%4+1]}).right,0);
});
test('EIKEN validates invalid entries, duplicate IDs and grade mismatch without mutating data',()=>{
  const q=fixture(),data=[q,{...q},{...fixture(2),answer:0},{...fixture(3),answer:5},
    {...fixture(4),correctWord:'mismatch'},{...fixture(5),grade:'2級'},null];
  const before=structuredClone(data),parsed=core.questions(data,'pre2');
  assert.equal(parsed.valid.length,1);assert.equal(parsed.invalid,6);assert.deepEqual(data,before);
});
for(const count of [0,3,10,100])test(`EIKEN samples ${Math.min(10,count)} unique questions from ${count}`,()=>{
  const rows=Array.from({length:count},(_,i)=>fixture(i)),before=structuredClone(rows);
  const picked=core.pick(rows,()=>0);assert.equal(picked.length,Math.min(10,count));
  assert.equal(new Set(picked.map(q=>q.id)).size,picked.length);assert.deepEqual(rows,before);
  if(count>10)assert.notDeepEqual(Array.from(picked,q=>q.id),rows.slice(0,10).map(q=>q.id));
});
test('EIKEN empty data is valid; non-array and unknown grades are rejected',()=>{
  assert.equal(core.questions([],'pre2').valid.length,0);
  assert.throws(()=>core.questions({},'pre2'));assert.throws(()=>core.questions([],'pre2plus'));
});
test('EIKEN score requires a complete set and returns right count, XP and best streak',()=>{
  const questions=[fixture(1,1),fixture(2,2),fixture(3,3),fixture(4,4)];
  assert.equal(core.score({grade:'pre2',questions,answers:[1,2,1,4]}).bestStreak,2);
  assert.equal(core.score({grade:'pre2',questions,answers:[1,2,1,4]}).xp,3);
  assert.throws(()=>core.score({grade:'pre2',questions,answers:[1]}));
});
test('EIKEN save uses the normal record schema and contributes to all XP views',async()=>{
  const h=accountHarness();const row=await h.api.saveEikenResult(payload());
  assert.equal(row.subject,'英検');assert.equal(row.lesson,'準2級');assert.equal(row.xpMode,'vocab');
  assert.equal(row.completedSet,true);assert.equal(row.repeatPolicyV1,true);
  const xp=await h.api.syncXP();assert.equal(xp.totalXP,8);assert.equal(xp.weeklyXP,8);assert.equal(xp.seasonXP,8);
  assert.equal(functionFromLine('teacher.html','xpFromRecords')([row]),8);
  const history=functionFromLine('ranking.html','historicalSeasonXP',{recordXP:functionFromLine('ranking.html','recordXP')});
  assert.equal(history([row],h.api.getSeason()),8);
});
test('EIKEN duplicate/concurrent saves and repeated XP sync cannot double count a set',async()=>{
  const h=accountHarness();await Promise.all([h.api.saveEikenResult(payload()),h.api.saveEikenResult(payload())]);
  assert.equal((await h.api.records()).length,1);
  assert.equal((await h.api.syncXP()).totalXP,8);assert.equal((await h.api.syncXP()).totalXP,8);
});
test('EIKEN retries after a lost write acknowledgement reuse the original record',async()=>{
  const h=accountHarness(),transaction=h.sandbox.runTransaction;let lose=true;
  h.sandbox.runTransaction=async(...args)=>{const result=await transaction(...args);if(lose){lose=false;throw Error('lost acknowledgement');}return result;};
  await assert.rejects(h.api.saveEikenResult(payload()),/lost/);
  await h.api.saveEikenResult(payload());assert.equal((await h.api.records()).length,1);
  assert.equal((await h.api.syncXP()).totalXP,8);
});
test('EIKEN conflicting retries cannot overwrite an existing score',async()=>{
  const h=accountHarness();await h.api.saveEikenResult(payload());
  await assert.rejects(h.api.saveEikenResult(payload({right:9})),/異なる記録/);
  assert.equal((await h.api.records())[0].right,8);
});
test('EIKEN rejects signed-out users and malformed result payloads',async()=>{
  await assert.rejects(accountHarness({loggedIn:false}).api.saveEikenResult(payload()),/ログイン/);
  const h=accountHarness();for(const patch of [{grade:'準2級プラス'},{sessionId:'../bad'},{total:0},{total:11},
    {right:11},{right:-1},{right:1.5},{bestStreak:9},{durationSeconds:-1}])await assert.rejects(h.api.saveEikenResult(payload(patch)),/不正/);
  assert.equal((await h.api.records()).length,0);
});
test('EIKEN completed sets keep normal XP on fifth and later runs',async()=>{
  const h=accountHarness();for(let i=0;i<6;i++)await h.api.saveEikenResult(payload({sessionId:id.slice(0,-1)+i}));
  assert.equal((await h.api.syncXP()).totalXP,48);
});

function ui({data=Array.from({length:10},(_,i)=>fixture(i,i%4+1)),account=accountHarness(),storage=new Map(),fetchError=false}={}){
  const nodes=new Map(),events=new Map();
  function node(){return {hidden:false,disabled:false,textContent:'',className:'',children:[],dataset:{},
    classList:{add(){}},append(...v){this.children.push(...v)},replaceChildren(){this.children=[]},focus(){}};}
  for(const [,id] of read('eiken.html').matchAll(/\bid="([^"]+)"/g))nodes.set(id,node());
  const grades=['pre2','2'].map(grade=>Object.assign(node(),{dataset:{grade}}));
  const window={YoshiAccount:account.api,addEventListener:(name,fn)=>events.set(name,fn)};
  const local=context({window,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>grades,
    createElement:node,addEventListener:(name,fn)=>events.set(name,fn)},
    crypto:{randomUUID:()=>id},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    AbortController,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    fetch:async url=>{assert.match(url,/^\.\/eiken_(pre2|2)\.json$/);if(fetchError)throw Error('fixture unavailable');return {ok:true,json:async()=>data};}});
  vm.runInContext(read('eiken-training.js'),local);vm.runInContext(read('eiken.js'),local,{timeout:1000});
  return {nodes,grades,events,account,storage,async choose(){await grades[0].onclick();},
    async finish(){nodes.get('start').onclick();for(let i=0;i<Math.min(10,data.length);i++){
      const q=data.find(q=>q.sentence===nodes.get('sentence').textContent);
      nodes.get('choices').children[q.answer-1].onclick();nodes.get('choices').children[q.answer-1].onclick();
      nodes.get('next').onclick();
    }await tick();await tick();}};
}
test('EIKEN UI: empty publication shows a friendly message and cannot start',async()=>{
  const h=ui({data:[]});await h.choose();assert.equal(h.nodes.get('dataStatus').textContent,'公開中の問題がありません');assert.equal(h.nodes.get('start').disabled,true);
});
test('EIKEN UI: short sets disclose the actual available count',async()=>{
  const h=ui({data:[fixture(1),fixture(2),fixture(3)]});await h.choose();
  assert.match(h.nodes.get('dataStatus').textContent,/今回は3問/);await h.finish();
  assert.equal(h.nodes.get('resultScore').textContent,'3 / 3 問正解');assert.equal(h.nodes.get('review').children.length,3);
});
test('EIKEN UI: completion displays every result and saves once despite repeated answer clicks',async()=>{
  const h=ui();await h.choose();await h.finish();
  assert.equal(h.nodes.get('resultScore').textContent,'10 / 10 問正解');assert.equal(h.nodes.get('resultXP').textContent,'獲得 +10 XP');
  assert.equal(h.nodes.get('review').children.length,10);assert.equal((await h.account.api.records()).length,1);
  assert.equal((await h.account.api.syncXP()).totalXP,10);assert.equal(h.storage.size,0);
});
test('EIKEN UI: guests can study but no result or XP is written',async()=>{
  const h=ui({account:accountHarness({loggedIn:false})});await h.choose();await h.finish();
  assert.match(h.nodes.get('saveStatus').textContent,/ゲスト学習/);assert.equal(h.account.writes.length,0);
});
test('EIKEN UI: quit never saves a partial set',async()=>{
  const h=ui();await h.choose();h.nodes.get('start').onclick();h.nodes.get('choices').children[0].onclick();h.nodes.get('quit').onclick();
  assert.equal((await h.account.api.records()).length,0);assert.equal(h.nodes.get('gradeScreen').hidden,false);
});
test('EIKEN UI: failed save survives reload and retry keeps the same session ID',async()=>{
  const account=accountHarness(),save=account.api.saveEikenResult;let fail=true;
  account.api.saveEikenResult=async payload=>{await save(payload);if(fail)throw Error('lost acknowledgement');};
  const h=ui({account});await h.choose();await h.finish();assert.equal(h.storage.size,1);
  fail=false;const reload=ui({account,storage:h.storage});assert.equal(reload.nodes.get('restorePending').hidden,false);
  reload.nodes.get('restorePending').onclick();await tick();await tick();
  assert.equal((await account.api.records()).length,1);assert.equal((await account.api.syncXP()).totalXP,10);assert.equal(h.storage.size,0);
});
test('EIKEN UI: JSON fetch failure can be retried without starting a game',async()=>{
  const h=ui({fetchError:true});await h.choose();assert.match(h.nodes.get('dataStatus').textContent,/読み込みに失敗/);assert.equal(h.nodes.get('start').disabled,true);
});
test('EIKEN UI: changing login during a set never saves to the new user',async()=>{
  const h=ui();await h.choose();h.nodes.get('start').onclick();
  h.account.evaluate("current={uid:'other-student',emailVerified:true};listeners.forEach(fn=>fn(current))");
  // Finish using the same UI; the session still belongs to its start user.
  for(let i=0;i<10;i++){h.nodes.get('choices').children[0].onclick();h.nodes.get('next').onclick();}
  await tick();assert.match(h.nodes.get('saveStatus').textContent,/開始時のアカウント/);
  assert.ok(h.account.writes.every(path=>!path.startsWith('learningRecords/')));
});
test('EIKEN UI: sync failure retries only synchronization after a successful save',async()=>{
  const h=ui(),sync=h.account.api.syncXP;let fail=true;
  h.account.api.syncXP=async()=>{if(fail)throw Error('fixture sync failure');return sync.call(h.account.api);};
  await h.choose();await h.finish();assert.match(h.nodes.get('saveStatus').textContent,/記録は保存済み/);
  assert.equal((await h.account.api.records()).length,1);fail=false;
  h.nodes.get('retrySave').onclick();await tick();await tick();
  assert.equal((await h.account.api.records()).length,1);assert.equal((await h.account.api.syncXP()).totalXP,10);
});
