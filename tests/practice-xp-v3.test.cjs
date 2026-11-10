const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../practice-xp.js'),{accountHarness,functionFromLine,NOW}=require('./helpers/app-harness.cjs');
const id='01234567-0123-4123-8123-0123456789ab';
const payload=(patch={})=>({sessionId:id,stage:'STAGE0',units:['Part1'],wordbookMode:'choice',right:7,total:10,...patch});
async function compare(rows,expected){const h=accountHarness({records:Object.fromEntries(rows.map((r,i)=>['r'+i,r]))});const v=await h.api.syncXP();assert.equal(v.totalXP,expected);assert.equal(v.weeklyXP,expected);assert.equal(v.seasonXP,expected);assert.equal(functionFromLine('teacher.html','xpFromRecords')(rows),expected);const history=functionFromLine('ranking.html','historicalSeasonXP',{recordXP:functionFromLine('ranking.html','recordXP')});assert.equal(history(rows,h.api.getSeason()),expected);}
for(const [stage,rates]of Object.entries({STAGE0:[1,3,10],STAGE1:[3,6,10],STAGE2:[3,6,10],STAGE3:[5,8,10]}))for(const [i,mode]of ['choice','spelling','reorder'].entries())test(`V3 wordbook ${stage} ${mode}: ${rates[i]} XP in account, teacher and history`,async()=>{
 const h=accountHarness(),row=await h.api.saveWordbookResult(payload({stage,units:[stage==='STAGE0'?'Part1':'Unit1'],wordbookMode:mode,right:10}));assert.equal(row.xpPolicyV3,true);assert.equal(P.wordbookRate(stage,mode),rates[i]);await compare([row],10*rates[i]);
});
for(const grade of ['準2級','2級'])test(`V3 EIKEN ${grade}: 7 XP, legacy V2/old pending saves unchanged`,async()=>{
 const h=accountHarness(),base={sessionId:id,grade,right:8,total:10};const row=await h.api.saveEikenResult({...base,xpPolicyV3:true});await compare([row],56);
 // A retry from new code must keep a record already stored under the old policy.
 const old=accountHarness();await old.api.saveEikenResult(base);const saved=await old.api.saveEikenResult({...base,xpPolicyV3:true});assert.notEqual(saved.xpPolicyV3,true);await compare([saved],grade==='2級'?80:40);
});
test('V3 partial wordbook records remain eligible on fifth and later sessions and do not change normal repeat policy',async()=>{
 const h=accountHarness();for(let i=0;i<6;i++)await h.api.saveWordbookResult(payload({sessionId:id.slice(0,-1)+i,stage:'STAGE3',wordbookMode:'spelling',right:1,total:2,completedSet:false}));await compare(await h.api.records(),48);
});
test('V3 wordbook retries/concurrent finishes are idempotent, reject changed scores or ranges',async()=>{
 const h=accountHarness();await Promise.all([h.api.saveWordbookResult(payload({units:['Unit2','Unit1']})),h.api.saveWordbookResult(payload({units:['Unit1','Unit2']}))]);assert.equal((await h.api.records()).length,1);await compare(await h.api.records(),7);
 for(const patch of [{right:8},{stage:'STAGE1'},{wordbookMode:'reorder'},{units:['Unit3']},{completedSet:false}])await assert.rejects(h.api.saveWordbookResult(payload(patch)),/異なる記録/);
});
test('V3 wordbook acknowledgement loss never produces an extra record',async()=>{
 const h=accountHarness(),tx=h.sandbox.runTransaction;let lose=true;h.sandbox.runTransaction=async(...args)=>{const v=await tx(...args);if(lose){lose=false;throw Error('lost acknowledgement');}return v;};await assert.rejects(h.api.saveWordbookResult(payload()),/lost/);await h.api.saveWordbookResult(payload());assert.equal((await h.api.records()).length,1);await compare(await h.api.records(),7);
});
test('V3 wordbook requires verified Google auth and valid stage/mode/score/session/range',async()=>{
 await assert.rejects(accountHarness({loggedIn:false}).api.saveWordbookResult(payload()),/ログイン/);const h=accountHarness();
 for(const patch of [{stage:'STAGE4'},{wordbookMode:'bad'},{units:[]},{units:['a','a']},{units:[null]},{units:['x'.repeat(81)]},{sessionId:'bad'},{right:11},{right:-1},{right:0.5},{total:0},{total:11},{completedSet:'true'}])await assert.rejects(h.api.saveWordbookResult(payload(patch)),/不正/);
 h.sandbox.getAuth=()=>({});h.evaluate("current.emailVerified=false");await assert.rejects(h.api.saveWordbookResult(payload()),/Google/);
});
test('V3 invalid policy data earns no XP; legacy normal and Daily values remain untouched',async()=>{
 assert.equal(P.wordbookRate('constructor','choice'),0);assert.equal(P.wordbookRate('STAGE0','constructor'),0);
 const base={subject:'単語帳',lesson:'STAGE0',xpMode:'wordbook',wordbookMode:'choice',right:5,total:10,xpPolicyV3:true,createdAt:NOW};
 for(const patch of [{right:11},{right:-1},{right:0.5},{total:0},{total:11},{wordbookMode:'bad'},{lesson:'STAGE4'}])assert.equal(P.recordXP({...base,...patch}),0);
 await compare([{...base,xpPolicyV3:'true'},{subject:'英C',lesson:'1',part:'1',xpMode:'vocabTyping',right:10,total:10,xpPolicyV2:true,createdAt:NOW},{...base,subject:'英C',dailyV1:true,dailyDeltaXP:500}],570);
});

test('MY PAGE recognizes wordbook history without switching back to normal vocabulary mode',()=>{
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',classList:{toggle(name,on){this[name]=on;}}});return nodes.get(id);};$('subject').value='単語帳';
 const choose=functionFromLine('mypage.html','selections',{$,catalog:[{subject:'単語帳',lesson:'STAGE0',part:'1'},{subject:'英C',lesson:'7',part:'1'}],mode:'text',uniq:a=>[...new Set(a)],options:(id,values)=>{if(!values.includes($(id).value))$(id).value=values[0];},render(){}});
 choose();assert.equal($('textMode').disabled,true);assert.equal($('vocabMode').textContent,'単語帳練習');assert.equal($('vocabMode').classList.active,true);
 $('subject').value='英C';choose();assert.equal($('textMode').disabled,false);assert.equal($('vocabMode').textContent,'単語チェック');assert.equal($('vocabMode').classList.active,true);
});
