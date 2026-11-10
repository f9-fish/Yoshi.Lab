const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {context,read,accountHarness,functionFromLine}=require('./helpers/app-harness.cjs');
const sandbox=context();vm.runInContext(read('eiken-training.js'),sandbox);
const core=vm.runInContext('YoshiEiken',sandbox);
const id='01234567-0123-4123-8123-0123456789ab';
const payload=(overrides={})=>({sessionId:id,grade:'準2級',right:8,total:10,bestStreak:4,durationSeconds:60,...overrides});
const fixture=(i=1,answer=1)=>({id:'P2-'+i,grade:'準2級',sentence:'Question '+i+' (　　).',
  choices:['first','second','third','fourth'],answer,correctWord:['first','second','third','fourth'][answer-1],translation:'和訳 '+i,explanation:'解説 '+i});
const tick=()=>new Promise(setImmediate);

test('EIKEN glossary URL changes with its content so old cached scripts are not reused',()=>{
  const version=createHash('sha256').update(read('eiken-training.js')).digest('hex').slice(0,12);
  const urls=[...read('eiken.html').matchAll(/src="\.\/eiken-training\.js\?v=([^"]+)"/g)];
  assert.equal(urls.length,1);assert.equal(urls[0][1],version,'辞書更新時はeiken.htmlの読み込みバージョンも更新してください');
});

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
  assert.equal(core.score({grade:'pre2',questions,answers:[1,2,1,4]}).xp,15);
  assert.throws(()=>core.score({grade:'pre2',questions,answers:[1]}));
});
test('EIKEN save uses the normal record schema and contributes to all XP views',async()=>{
  const h=accountHarness();const row=await h.api.saveEikenResult(payload());
  assert.equal(row.subject,'英検');assert.equal(row.lesson,'準2級');assert.equal(row.xpMode,'eikenChoice');
  assert.equal(row.completedSet,true);assert.equal(row.repeatPolicyV1,true);
  const xp=await h.api.syncXP();assert.equal(xp.totalXP,40);assert.equal(xp.weeklyXP,40);assert.equal(xp.seasonXP,40);
  assert.equal(functionFromLine('teacher.html','xpFromRecords')([row]),40);
  const history=functionFromLine('ranking.html','historicalSeasonXP',{recordXP:functionFromLine('ranking.html','recordXP')});
  assert.equal(history([row],h.api.getSeason()),40);
});
test('EIKEN duplicate/concurrent saves and repeated XP sync cannot double count a set',async()=>{
  const h=accountHarness();await Promise.all([h.api.saveEikenResult(payload()),h.api.saveEikenResult(payload())]);
  assert.equal((await h.api.records()).length,1);
  assert.equal((await h.api.syncXP()).totalXP,40);assert.equal((await h.api.syncXP()).totalXP,40);
});
test('EIKEN retries after a lost write acknowledgement reuse the original record',async()=>{
  const h=accountHarness(),transaction=h.sandbox.runTransaction;let lose=true;
  h.sandbox.runTransaction=async(...args)=>{const result=await transaction(...args);if(lose){lose=false;throw Error('lost acknowledgement');}return result;};
  await assert.rejects(h.api.saveEikenResult(payload()),/lost/);
  await h.api.saveEikenResult(payload());assert.equal((await h.api.records()).length,1);
  assert.equal((await h.api.syncXP()).totalXP,40);
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
  assert.equal((await h.api.syncXP()).totalXP,240);
});

function ui({data=Array.from({length:10},(_,i)=>fixture(i,i%4+1)),account=accountHarness(),storage=new Map(),fetchError=false}={}){
  const nodes=new Map(),events=new Map();
  function node(){return {hidden:false,disabled:false,textContent:'',className:'',children:[],dataset:{},
    classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},contains(x){return this.values.has(x)}},append(...v){this.children.push(...v)},replaceChildren(){this.children=[]},focus(){}};}
  for(const [,id] of read('eiken.html').matchAll(/\bid="([^"]+)"/g))nodes.set(id,node());
  const grades=['pre2','2'].map(grade=>Object.assign(node(),{dataset:{grade}}));
  const window={YoshiAccount:account.api,addEventListener:(name,fn)=>events.set(name,fn)};
  const local=context({window,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>grades,
    createElement:node,addEventListener:(name,fn)=>events.set(name,fn)},
    crypto:{randomUUID:()=>id},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    AbortController,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    fetch:async url=>{assert.match(url,/^\.\/eiken_(pre2|2)\.json$/);if(fetchError)throw Error('fixture unavailable');return {ok:true,json:async()=>data};}});
  vm.runInContext(read('eiken-training.js'),local);vm.runInContext(read('eiken.js'),local,{timeout:1000});
  return {nodes,grades,events,account,storage,async choose(index=0){await grades[index].onclick();},
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
  assert.equal(h.nodes.get('resultScore').textContent,'10 / 10 問正解');assert.equal(h.nodes.get('resultXP').textContent,'獲得 +70 XP');
  assert.equal(h.nodes.get('review').children.length,10);assert.equal((await h.account.api.records()).length,1);
  assert.equal((await h.account.api.syncXP()).totalXP,70);assert.equal(h.storage.size,0);
});
test('EIKEN UI: guests can study but no result or XP is written',async()=>{
  const h=ui({account:accountHarness({loggedIn:false})});await h.choose();await h.finish();
  assert.match(h.nodes.get('saveStatus').textContent,/ゲスト学習/);assert.equal(h.account.writes.length,0);
});
test('EIKEN UI: quit with zero answers never saves a record',async()=>{
  const h=ui();await h.choose();h.nodes.get('start').onclick();h.nodes.get('quit').onclick();
  assert.equal((await h.account.api.records()).length,0);assert.equal(h.nodes.get('gradeScreen').hidden,false);
});
test('EIKEN UI: failed save survives reload and retry keeps the same session ID',async()=>{
  const account=accountHarness(),save=account.api.saveEikenResult;let fail=true;
  account.api.saveEikenResult=async payload=>{const row=await save(payload);if(fail)throw Error('lost acknowledgement');return row;};
  const h=ui({account});await h.choose();await h.finish();assert.equal(h.storage.size,1);
  fail=false;const reload=ui({account,storage:h.storage});assert.equal(reload.nodes.get('restorePending').hidden,false);
  reload.nodes.get('restorePending').onclick();await tick();await tick();
  assert.equal((await account.api.records()).length,1);assert.equal((await account.api.syncXP()).totalXP,70);assert.equal(h.storage.size,0);
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
  assert.equal((await h.account.api.records()).length,1);assert.equal((await h.account.api.syncXP()).totalXP,70);
});
test('every currently published EIKEN choice has a Japanese meaning',()=>{
  for(const [grade,file] of [['pre2','eiken_pre2.json'],['2','eiken_2.json']]){
   for(const q of JSON.parse(read(file))){
    assert.equal(core.meanings(q).length,4);
    assert.ok(core.meanings(q).every(m=>m!=='意味未登録'),q.id);
    assert.deepEqual(Array.from(core.meanings(q)),q.choiceMeanings,q.id);
   }
  }
});
test('JSON meanings keep their index; missing meanings never use guessed or dictionary translations',()=>{
  const q={...fixture(),choices:['accept','write','unknown term','constructor'],choiceMeanings:['招待を受ける','',null,{}]};
  assert.deepEqual(Array.from(core.meanings(q)),['招待を受ける','意味未登録','意味未登録','意味未登録']);
  assert.deepEqual(Array.from(core.meanings({...q,choiceMeanings:['先頭の訳']})),['先頭の訳','意味未登録','意味未登録','意味未登録']);
});
test('choice meanings are hidden before answering, revealed for all four choices and reset next question',async()=>{
  const data=[{...fixture(1),choices:['accept','write','close','save'],choiceMeanings:['受け入れる','書く','閉める／近い','節約する／救う／保存する'],correctWord:'accept'},
    {...fixture(2),choices:['accept','write','close','save'],choiceMeanings:['受け入れる','書く','閉める／近い','節約する／救う／保存する'],correctWord:'accept'}];
  const h=ui({data});await h.choose();h.nodes.get('start').onclick();
  assert.ok(h.nodes.get('choices').children.every(b=>b.children.length===2));
  h.nodes.get('choices').children[1].onclick();
  assert.deepEqual(h.nodes.get('choices').children.map(b=>b.children[2].textContent),
    ['（受け入れる）','（書く）','（閉める／近い）','（節約する／救う／保存する）']);
  h.nodes.get('choices').children[1].onclick();
  assert.ok(h.nodes.get('choices').children.every(b=>b.children.length===3),'No duplicate reveal');
  h.nodes.get('next').onclick();
  assert.ok(h.nodes.get('choices').children.every(b=>b.children.length===2));
});
test('final review includes the meanings of correct and incorrect choices',async()=>{
  const h=ui({data:[{...fixture(1),choices:['accept','write','close','save'],choiceMeanings:['受け入れる','書く','閉める／近い','節約する／救う／保存する'],correctWord:'accept'}]});
  await h.choose();await h.finish();
  const choices=h.nodes.get('review').children[0].children[1].children;
  assert.equal(choices.length,4);
  assert.deepEqual(choices.map(li=>li.children[0].textContent),
    ['（受け入れる）','（書く）','（閉める／近い）','（節約する／救う／保存する）']);
});
test('JSON translation strings are returned verbatim without whitespace normalization or HTML interpretation',()=>{
  const q={...fixture(),choiceMeanings:['  日本語の訳  ','訳\n続き','<b>訳</b>','意味・別の意味']};
  assert.deepEqual(Array.from(core.meanings(q)),q.choiceMeanings);
});
test('legacy questions without choiceMeanings remain playable and show an explicit unavailable label',async()=>{
  const h=ui({data:[fixture()]});await h.choose();await h.finish();
  assert.equal(h.nodes.get('resultScore').textContent,'1 / 1 問正解');
  const choices=h.nodes.get('review').children[0].children[1].children;
  assert.ok(choices.every(li=>li.children[0].textContent==='（意味未登録）'));
});
for(const [right,expected] of [[0,0],[1,5],[6,30],[7,35],[10,50]])test(`V2 EIKEN ${right} correct gives ${expected} XP in every view`,async()=>{
  const h=accountHarness(),row=await h.api.saveEikenResult(payload({right,bestStreak:0}));
  assert.equal((await h.api.syncXP()).totalXP,expected);
  assert.equal((await h.api.syncXP()).weeklyXP,expected);
  assert.equal((await h.api.syncXP()).seasonXP,expected);
  assert.equal(functionFromLine('teacher.html','xpFromRecords')([row]),expected);
  const history=functionFromLine('ranking.html','historicalSeasonXP',{recordXP:functionFromLine('ranking.html','recordXP')});
  assert.equal(history([row],h.api.getSeason()),expected);
  assert.equal(core.score({grade:'pre2',questions:Array.from({length:10},(_,i)=>fixture(i)),answers:Array.from({length:10},(_,i)=>i<right?1:2)}).xp,expected);
});
test('legacy EIKEN keeps 1 XP, normal learning keeps 30 XP cap, and retry never upgrades an old record',async()=>{
  const h=accountHarness();const row=await h.api.saveEikenResult(payload({right:10}));
  h.data.learningRecords[h.uid]['eiken_'+id].xpMode='vocab';
  delete h.data.learningRecords[h.uid]['eiken_'+id].xpPolicyV2;
  h.data.learningRecords[h.uid].normal={...row,subject:'英C',xpMode:'vocabTyping',xpPolicyV2:undefined,right:10};
  const saved=await h.api.saveEikenResult(payload({right:10}));
  assert.equal(saved.xpMode,'vocab');assert.equal((await h.api.syncXP()).totalXP,40);
  assert.equal(functionFromLine('teacher.html','xpFromRecords')(await h.api.records()),40);
});
test('partial EIKEN sets earn 5 XP per correct answer even after four prior runs, in every view',async()=>{
  const h=accountHarness();for(let i=0;i<6;i++)await h.api.saveEikenResult(payload({sessionId:id.slice(0,-1)+i,right:1,total:2,bestStreak:1,completedSet:false}));
  const rows=await h.api.records(),xp=await h.api.syncXP();
  assert.equal(xp.totalXP,30);assert.equal(xp.weeklyXP,30);assert.equal(xp.seasonXP,30);
  assert.ok(rows.every(r=>r.completedSet===false));
  assert.equal(functionFromLine('teacher.html','xpFromRecords')(rows),30);
  const history=functionFromLine('ranking.html','historicalSeasonXP',{recordXP:functionFromLine('ranking.html','recordXP')});
  assert.equal(history(rows,h.api.getSeason()),30);
});
test('partial save retries are idempotent and cannot change the saved completion state',async()=>{
  const h=accountHarness(),partial=payload({right:2,total:3,bestStreak:1,completedSet:false});
  await Promise.all([h.api.saveEikenResult(partial),h.api.saveEikenResult(partial)]);
  await assert.rejects(h.api.saveEikenResult({...partial,completedSet:true}),/異なる記録/);
  assert.equal((await h.api.records()).length,1);assert.equal((await h.api.syncXP()).totalXP,10);
  await assert.rejects(h.api.saveEikenResult({...partial,completedSet:'false'}),/不正/);
});
test('quit after four answers saves only those answers and displays their earned XP',async()=>{
  const data=Array.from({length:10},(_,i)=>fixture(i)),h=ui({data});await h.choose();h.nodes.get('start').onclick();
  for(let i=0;i<4;i++){
   h.nodes.get('choices').children[i===3?1:0].onclick();
   if(i<3)h.nodes.get('next').onclick();
  }
  h.nodes.get('quit').onclick();await tick();await tick();
  const rows=await h.account.api.records();assert.equal(rows.length,1);assert.equal(rows[0].right,3);assert.equal(rows[0].total,4);assert.equal(rows[0].completedSet,false);
  assert.equal(h.nodes.get('resultXP').textContent,'獲得 +21 XP');assert.equal(h.nodes.get('review').children.length,4);
  assert.match(h.nodes.get('completionStatus').textContent,/10問中4問に解答/);
  assert.match(h.nodes.get('completionStatus').textContent,/未解答の6問は採点しません/);
});
test('quit before answering the current question does not count it as wrong',async()=>{
  const h=ui({data:Array.from({length:10},(_,i)=>fixture(i))});await h.choose();h.nodes.get('start').onclick();
  h.nodes.get('choices').children[0].onclick();h.nodes.get('next').onclick();h.nodes.get('quit').onclick();await tick();await tick();
  const row=(await h.account.api.records())[0];assert.equal(row.total,1);assert.equal(row.right,1);
  assert.equal((await h.account.api.syncXP()).totalXP,7);
});
test('a failed partial save can be restored after reload without completing unattempted questions',async()=>{
  const account=accountHarness(),save=account.api.saveEikenResult;let fail=true;
  account.api.saveEikenResult=async payload=>{const row=await save(payload);if(fail)throw Error('fixture lost response');return row;};
  const h=ui({account,data:Array.from({length:10},(_,i)=>fixture(i))});await h.choose();h.nodes.get('start').onclick();
  h.nodes.get('choices').children[0].onclick();h.nodes.get('quit').onclick();await tick();await tick();
  assert.equal(h.storage.size,1);fail=false;
  const restored=ui({account,storage:h.storage});restored.nodes.get('restorePending').onclick();await tick();await tick();
  assert.equal((await account.api.records()).length,1);assert.equal((await account.api.syncXP()).totalXP,7);
  assert.match(restored.nodes.get('completionStatus').textContent,/10問中1問/);assert.equal(h.storage.size,0);
});

for(const [selected,label,rate] of [[0,'準2級',7],[1,'2級',7]])test(`EIKEN ${label} completion popup matches saved XP and closes without awarding again`,async()=>{
  const h=ui({data:Array.from({length:10},(_,i)=>({...fixture(i),grade:label}))});
  await h.choose(selected);await h.finish();
  assert.equal(h.nodes.get('resultXP').textContent,'獲得 +'+10*rate+' XP');
  assert.equal(h.nodes.get('xpCelebrationEarned').textContent,'+'+10*rate+' XP');
  assert.ok(h.nodes.get('xpCelebrationOverlay').classList.contains('open'));
  h.nodes.get('xpCelebrationClose').onclick();
  assert.equal(h.nodes.get('xpCelebrationOverlay').classList.contains('open'),false);
  h.nodes.get('retrySave').onclick();await tick();await tick();
  assert.equal(h.nodes.get('xpCelebrationOverlay').classList.contains('open'),false);
  assert.equal((await h.account.api.records()).length,1);
  assert.equal((await h.account.api.syncXP()).totalXP,10*rate);
});
test('EIKEN 2 partial exit celebrates only answered correct questions',async()=>{
  const h=ui({data:Array.from({length:10},(_,i)=>({...fixture(i),grade:'2級'}))});
  await h.choose(1);h.nodes.get('start').onclick();
  h.nodes.get('choices').children[0].onclick();h.nodes.get('next').onclick();
  h.nodes.get('choices').children[1].onclick();h.nodes.get('quit').onclick();await tick();await tick();
  assert.equal(h.nodes.get('xpCelebrationEarned').textContent,'+7 XP');
  const [row]=await h.account.api.records();assert.equal(row.right,1);assert.equal(row.total,2);
});
test('popup does not claim earned XP until synchronization succeeds',async()=>{
  const h=ui(),sync=h.account.api.syncXP;let fail=true;
  h.account.api.syncXP=async()=>{if(fail)throw Error('offline');return sync.call(h.account.api);};
  await h.choose();await h.finish();
  assert.equal(h.nodes.get('xpCelebrationOverlay').classList.contains('open'),false);
  fail=false;h.nodes.get('retrySave').onclick();await tick();await tick();
  assert.equal(h.nodes.get('xpCelebrationEarned').textContent,'+70 XP');
  assert.ok(h.nodes.get('xpCelebrationOverlay').classList.contains('open'));
});
test('missing profile popup shows zero reflected XP and explains pending credit',async()=>{
  const h=ui();h.account.api.syncXP=async()=>null;await h.choose();await h.finish();
  assert.equal(h.nodes.get('xpCelebrationEarned').textContent,'+0 XP');
  assert.match(h.nodes.get('xpCelebrationMessage').textContent,/プロフィール登録/);
});
test('pre-update pending EIKEN 2 session keeps its original rate on restore',async()=>{
  const account=accountHarness(),storage=new Map();
  storage.set('yoshiEikenPendingV1:'+account.uid,JSON.stringify({id,grade:'2',uid:account.uid,
    questions:[{...fixture(),grade:'2級'}],answers:[1],completedSet:false,plannedTotal:10}));
  const h=ui({account,storage});h.nodes.get('restorePending').onclick();await tick();await tick();
  assert.equal(h.nodes.get('resultXP').textContent,'獲得 +5 XP');
  assert.equal(h.nodes.get('xpCelebrationEarned').textContent,'+5 XP');
  assert.notEqual((await account.api.records())[0].xpPolicyV2,true);
});

test('V3 score is 7 XP for both grades; previously pending V2 2級 stays 10 XP',async()=>{
 for(const grade of ['pre2','2'])for(const right of [0,1,6,10]){const qs=Array.from({length:10},(_,i)=>({...fixture(i),grade:grade==='2'?'2級':'準2級'}));assert.equal(core.score({grade,xpPolicyV3:true,questions:qs,answers:qs.map((q,i)=>i<right?1:2)}).xp,right*7);}
 const account=accountHarness(),storage=new Map();storage.set('yoshiEikenPendingV1:'+account.uid,JSON.stringify({id,grade:'2',uid:account.uid,xpPolicyV2:true,questions:[{...fixture(),grade:'2級'}],answers:[1],completedSet:false,plannedTotal:10}));const h=ui({account,storage});h.nodes.get('restorePending').onclick();await tick();await tick();assert.equal(h.nodes.get('resultXP').textContent,'獲得 +10 XP');assert.equal((await account.api.syncXP()).totalXP,10);
});
