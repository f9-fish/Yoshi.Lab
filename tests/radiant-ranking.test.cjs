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
function harness({ count = 3, grade = 1, extra = {} } = {}) {
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
test('season XP, grade and deterministic tie ordering are preserved', async () => {
  const h = harness({ count: 1 });
  for (let i = 0; i < 12; i++) {
    h.board['other' + i] = { name: 'Other', seasonId: 'current', seasonXP: 99999 };
    h.grades['other' + i] = 2;
  }
  h.board.old = { name: 'Old', seasonId: 'past', seasonXP: 99999, totalXP: 99999 };
  h.grades.old = 1;
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'レディアント');
  assert.equal(h.$('radiantRows').children.length, 1);
  h.board.s0.seasonXP = 11999;
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'ダイヤモンド Ⅰ');
  h.board.s0.seasonXP = 12000;
  for (let i = 1; i <= 10; i++) {
    h.board['s' + i] = { name: 'A' + i, seasonId: 'current', seasonXP: 12000, classNumber: 1 };
    h.grades['s' + i] = 1;
  }
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'マスター');
});
test('missing grade displays registration instead of claiming no masters; saving promotes immediately', async () => {
  const h = harness({ grade: null });
  await h.evaluate('refresh()');
  assert.equal(h.$('rankTitle').textContent, 'マスター');
  assert.equal(h.$('gradeSetup').classList.contains('hidden'), false);
  assert.match(h.$('radiantRows').textContent, /学年を登録/);
  h.$('studentGrade').value = '1';
  await h.$('gradeForm').onsubmit({ preventDefault() {} });
  assert.equal(h.grades.s0, 1);
  assert.equal(h.$('rankTitle').textContent, 'レディアント');
  assert.equal(h.$('gradeSetup').classList.contains('hidden'), true);
});
test('invalid grade and denied save do not promote or hide retry controls', async () => {
  const h = harness({ grade: null }); let writes = 0;
  h.api.setGrade = async () => { writes++; throw Error('permission denied'); };
  await h.evaluate('refresh()');
  h.$('studentGrade').value = '';
  await h.$('gradeForm').onsubmit({ preventDefault() {} });
  assert.equal(writes, 0);
  h.$('studentGrade').value = '2';
  await h.$('gradeForm').onsubmit({ preventDefault() {} });
  assert.equal(writes, 1);
  assert.equal(h.$('rankTitle').textContent, 'マスター');
  assert.match(h.$('gradeStatus').textContent, /permission denied/);
  assert.equal(h.$('saveGrade').disabled, false);
  assert.equal(h.$('gradeSetup').classList.contains('hidden'), false);
});
test('signed-out and missing-profile visitors cannot see registration', async () => {
  const h = harness();
  h.api.user = null;
  await h.evaluate('refresh()');
  assert.equal(h.$('gradeSetup').classList.contains('hidden'), true);
  h.api.user = { uid: 's0' }; h.api.profile = async () => null;
  await h.evaluate('refresh()');
  assert.equal(h.$('gradeSetup').classList.contains('hidden'), true);
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
