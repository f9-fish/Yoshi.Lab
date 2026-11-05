const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { context, read } = require('./helpers/app-harness.cjs');

const completed = (day, overrides = {}) => ({ dailyV1:true,dailyCompleted:true,
  total:10,right:10,dailyDate:day,dailySubject:'ec',...overrides });
const tick = () => new Promise(setImmediate);
function harness({ rows=[], user={uid:'student-a'}, records }={}) {
  const node=()=>({textContent:'',children:[],attributes:{},className:'',
    append(...children){this.children.push(...children)},replaceChildren(){this.children=[]},
    setAttribute(name,value){this.attributes[name]=value}});
  const summary=node(),days=node(),events=new Map();let notify,calls=0;
  const api={user,subscribe(fn){notify=fn;fn(this.user)},records(){calls++;return records?records():Promise.resolve(rows)}};
  const document={hidden:false,getElementById:id=>id==='dailyHomeSummary'?summary:id==='dailyHomeDays'?days:null,
    createElement:node,addEventListener:(name,fn)=>events.set(name,fn)};
  const sandbox=context({window:{YoshiAccount:api,addEventListener:(name,fn)=>events.set(name,fn)},document,
    console:{warn(){}},setInterval(){}});
  vm.runInContext(read('home-daily.js'),sandbox,{filename:'home-daily.js',timeout:1000});
  return {summary,days,api,events,get calls(){return calls},notify:()=>notify(api.user),sandbox};
}

test('home card shows Monday-Sunday checks from the same saved Daily completions',async()=>{
  const h=harness({rows:[completed('2026-11-02'),completed('2026-11-05')]});await tick();
  assert.equal(h.summary.textContent,'今週 2 / 7日達成');
  assert.deepEqual(h.days.children.map(c=>c.children[0].textContent),['月','火','水','木','金','土','日']);
  assert.deepEqual(h.days.children.map(c=>c.children[1].textContent),['✓','·','·','✓','·','·','·']);
  assert.equal(h.days.children[3].attributes['aria-label'],'2026-11-05 達成');
  assert.match(h.days.children[3].className,/is-today/);
});
test('home card counts one day across subjects and ignores abandoned/previous-week records',async()=>{
  const h=harness({rows:[completed('2026-11-02'),completed('2026-11-02',{dailySubject:'rp'}),
    completed('2026-11-03',{dailyCompleted:false}),completed('2026-11-01')]});await tick();
  assert.equal(h.summary.textContent,'今週 1 / 7日達成');
});
test('signed-out home card never requests records and does not claim days were missed',async()=>{
  const h=harness({user:null});await tick();
  assert.equal(h.calls,0);assert.equal(h.summary.textContent,'ログインで達成状況を表示');
  assert.ok(h.days.children.every(c=>c.children[1].textContent==='—'));
});
test('record load error is shown as unavailable, not zero completed days',async()=>{
  const h=harness({records:()=>Promise.reject(Error('fixture denial'))});await tick();
  assert.equal(h.summary.textContent,'達成状況を取得できません');
  assert.ok(h.days.children.every(c=>c.children[1].textContent==='—'));
});
test('logout clears checks and discards an in-flight previous user response',async()=>{
  let resolve;const h=harness({records:()=>new Promise(r=>{resolve=r})});
  h.api.user=null;h.notify();resolve([completed('2026-11-05')]);await tick();
  assert.equal(h.summary.textContent,'ログインで達成状況を表示');
  assert.ok(h.days.children.every(c=>!c.className.includes('is-done')));
});
test('switching accounts prevents a late response overwriting the current user',async()=>{
  let first;let call=0;
  const h=harness({records:()=>++call===1?new Promise(r=>{first=r}):Promise.resolve([])});
  h.api.user={uid:'student-b'};h.notify();await tick();
  first([completed('2026-11-05')]);await tick();
  assert.equal(h.summary.textContent,'今週 0 / 7日達成');
});
test('returning to home refreshes saved completions without reattaching auth listeners',async()=>{
  const rows=[];const h=harness({rows});await tick();
  rows.push(completed('2026-11-05'));h.events.get('focus')();await tick();
  assert.equal(h.summary.textContent,'今週 1 / 7日達成');
  h.events.get('yoshi-auth-ready')();await tick();assert.equal(h.calls,2);
});
test('home card retains its Daily destination and loads the read-only controller',()=>{
  const html=read('index.html');
  assert.match(html,/<a class="daily-hero-link" href="\.\/daily.html"/);
  assert.equal(html.split('<script src="./home-daily.js?v=1"></script>').length,2);
  assert.ok(html.indexOf('./weekly-daily.js?v=1')<html.indexOf('./home-daily.js?v=1'));
});
