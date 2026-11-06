const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { context, read, accountHarness } = require('./helpers/app-harness.cjs');

function node() {
  const classes = new Set();
  return { children: [], textContent: '', value: '', disabled: false,
    style: { setProperty() {} }, classList: {
      add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle(x, force) { const on = force ?? !classes.has(x); on ? classes.add(x) : classes.delete(x); },
    },
    append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
    replaceChildren(...items) { this.children = []; this.append(...items); },
    replaceWith(item) { const p = this.parent; p.children[p.children.indexOf(this)] = item; item.parent = p; },
    setAttribute() {},
  };
}
function harness({ count = 3, grade = null, extra = {} } = {}) {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const board = {}, grades = {};
  for (let i = 0; i < count; i++) {
    board['s' + i] = { name: 'Student ' + String(i).padStart(2, '0'), classNumber: 1,
      seasonId: 'current', seasonXP: 12000 + count - i, totalXP: 50000 };
    if (grade) grades['s' + i] = grade;
  }
  Object.assign(board, extra);
  const api = { user: { uid: 's0' }, getSeason: () => ({ id: 'current', label: 'SEASON 1', start: '2026-04-01', end: '2026-11-27' }),
    profile: async () => ({ classNumber: 1 }), syncXP: async () => {}, records: async () => [],
    getSeasons: () => [], leaderboard: async () => board, grades: async () => grades,
    grade: async () => grades[api.user.uid] || null,
    setGrade: async value => { grades[api.user.uid] = value; },
  };
  const sandbox = context({ window: {}, document: { getElementById: $, createElement: node, addEventListener() {} }, alert() {} });
  const evaluate = code => vm.runInContext(code, sandbox, { timeout: 1000 });
  evaluate(read('yoshi-ranks-v14.js'));
  const scripts = [...read('ranking.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  const app = scripts.filter(([, code]) => code.includes('let leaderboardRows='));
  assert.equal(app.length, 1);
  evaluate(app[0][1]);
  sandbox.window.YoshiAccount = api;
  return { $, api, board, grades, evaluate };
}

for (const count of [1, 2, 3, 9, 10, 11]) {
  test(`${count} masters: up to ten become radiant immediately, without a minimum headcount`, async () => {
    const h = harness({ count });
    for (let i = 0; i < count; i++) {
      h.api.user.uid = 's' + i;
      await h.evaluate('refresh()');
      assert.equal(h.$('rankTitle').textContent, i < 10 ? 'レディアント' : 'マスター');
      assert.equal(h.$('radiantRows').children.length, Math.min(count, 10));
    }
  });
}
test('season XP and deterministic tie ordering are preserved without grade filtering', async () => {
  const h = harness({ count: 1, grade: null });
  h.board.old = { name: 'Old', seasonId: 'past', seasonXP: 99999, totalXP: 99999 };
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'レディアント');
  assert.equal(h.$('radiantRows').children.length, 1);
  h.board.s0.seasonXP = 11999;
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'ダイヤモンド Ⅰ');
  h.board.s0.seasonXP = 12000;
  for (let i = 1; i <= 10; i++) {
    h.board['s' + i] = { name: 'A' + i, seasonId: 'current', seasonXP: 12000, classNumber: 2 };
    h.grades['s' + i] = 2;
  }
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'マスター');
  assert.equal(h.$('radiantRows').children.length, 10);
});
test('unregistered students become radiant without reading or writing grades', async () => {
  const h = harness({ grade: null });
  for (const method of ['grade','grades','setGrade']) h.api[method] = () => { throw Error('Grade API must not be used'); };
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'レディアント');
  assert.equal(h.$('radiantRows').children.length, 3);
  assert.match(h.$('rankXP').textContent, /全体 1位/);
  assert.doesNotMatch(read('ranking.html'), /gradeSetup|studentGrade|学年/);
});
test('class and weekly\/total display filters never change the global season rank', async () => {
  const h = harness({ count: 1 });
  for (let i = 0; i < 10; i++) h.board['other' + i] = { name: 'Other ' + i, classNumber: 2,
    seasonId: 'current', seasonXP: 20000, weeklyXP: 0, totalXP: 20000 };
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'マスター');
  for (const tab of ['rankAll','rankTotal','rankClass','rankWeek','rankSeason']) {
    h.$(tab).onclick();
    assert.equal(h.$('rankTitle').textContent, 'マスター');
    assert.match(h.$('rankXP').textContent, /全体 11位/);
  }
});
test('signed-out and missing-profile visitors see the existing login/profile guidance', async () => {
  const h = harness();
  h.api.user = null;
  await h.evaluate('refresh()');
  assert.match(h.$('authMessage').textContent, /ログイン/);
  h.api.user = { uid: 's0' }; h.api.profile = async () => null;
  await h.evaluate('refresh()');
  assert.match(h.$('authMessage').textContent, /プロフィール/);
});
test('existing grade API writes only the signed-in student grade, not XP or records', async () => {
  const h = accountHarness();
  // Let the independent login lastAccess write finish before measuring this API.
  await new Promise(resolve => setImmediate(resolve));
  h.writes.length = 0;
  await h.api.setGrade(2);
  assert.equal(await h.api.grade(), 2);
  assert.deepEqual(h.writes, ['studentGrades/' + h.uid]);
});

async function rankSurface(file,board,uid='s0') {
  const elements=new Map(),callbacks=[];
  const $=id=>{if(!elements.has(id)){const el=node();el.prepend=(...xs)=>el.children.unshift(...xs);el.add=o=>el.append(o);elements.set(id,el);}return elements.get(id);};
  const window={addEventListener(){}};
  const api={user:{uid},getSeason:()=>({id:'current'}),leaderboard:async()=>board,
    profile:async()=>({name:'Student',classNumber:1,studentNumber:1}),records:async()=>[],syncXP:async()=>{},
    grade(){throw Error('must not read grade')},grades(){throw Error('must not read grades')}};
  const sandbox=context({window,document:{getElementById:$,createElement:node,addEventListener(){}},
    setTimeout:fn=>callbacks.push(fn),fetch:async()=>({ok:true,json:async()=>[]}),Option:class {constructor(text,value){this.textContent=text;this.value=value;}}});
  const evaluate=code=>vm.runInContext(code,sandbox,{timeout:1000});
  evaluate(read('yoshi-ranks-v14.js'));
  const scripts=[...read(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  if(file==='index.html'){
    window.YoshiAccount=api;
    evaluate(scripts.find(([,attrs])=>attrs.includes('yoshi-v13-home-rank-script'))[2]);
    await callbacks[0]();
    return $('questProgress').children[0].children[2].textContent;
  }
  evaluate(scripts.find(([, ,code])=>code.includes('let leaderboardRows='))[2]);
  window.YoshiAccount=api;await evaluate('refresh()');
  return $('mySeasonRank').textContent;
}
for(const count of [2,3,11])test(`all three screens agree with ${count} masters and no grade registration`,async()=>{
  const h=harness({count});
  for(const i of [0,count-1]){
    h.api.user.uid='s'+i;await h.evaluate('refresh()');
    const expected=i<10?'レディアント':'マスター';
    assert.equal(h.$('rankTitle').textContent,expected);
    for(const file of ['index.html','mypage.html'])assert.equal(await rankSurface(file,h.board,'s'+i),expected,file);
  }
});
