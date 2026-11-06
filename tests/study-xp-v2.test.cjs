const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { accountHarness, functionFromLine, context, read, NOW } = require('./helpers/app-harness.cjs');
const teacher = functionFromLine('teacher.html', 'xpFromRecords');
const history = functionFromLine('ranking.html', 'historicalSeasonXP', {
  recordXP: functionFromLine('ranking.html', 'recordXP'),
});
const row = (patch = {}) => ({ subject: '英C', lesson: '1', part: '1', mode: 'vocab',
  xpMode: 'vocab', right: 10, total: 10, xpPolicyV2: true, repeatPolicyV1: true,
  completedSet: true, createdAt: NOW, ...patch });
async function compare(rows, expected) {
  const before = structuredClone(rows);
  const h = accountHarness({ records: Object.fromEntries(rows.map((r, i) => ['row' + i, r])) });
  const result = await h.api.syncXP();
  for (const key of ['totalXP', 'weeklyXP', 'seasonXP']) assert.equal(result[key], expected, key);
  assert.equal(teacher(rows), expected, 'teacher');
  assert.equal(history(rows, h.api.getSeason()), expected, 'history');
  assert.deepEqual(await h.api.syncXP(), result, 'sync must be repeatable');
  assert.deepEqual(rows, before, 'must not rewrite history');
}
for (const [mode, right, expected] of [
  ['text', 10, 0], ['vocab', 10, 10], ['vocabTyping', 10, 70], ['textTyping', 10, 100],
  ['vocab', 100, 100], ['vocabTyping', 100, 700], ['textTyping', 100, 1000], ['unknown', 10, 0],
]) test(`new study XP ${mode}, ${right} correct -> ${expected} without per-record cap`, async () => {
  await compare([row({ xpMode: mode, right, total: Math.max(10, right) })], expected);
});
for (const [grade, expected] of [['準2級', 50], ['2級', 100]]) {
  test(`new EIKEN ${grade} ten correct matches all aggregates`, async () => {
    const h = accountHarness();
    const saved = await h.api.saveEikenResult({ sessionId: '01234567-0123-4123-8123-0123456789ab',
      grade, right: 10, total: 10 });
    assert.equal(saved.xpPolicyV2, true);
    await compare([saved], expected);
  });
}
for (const [mode, rate] of [['vocab', 1], ['vocabTyping', 7], ['textTyping', 10]]) {
  for (const count of [1, 2, 3, 4, 5, 6]) test(`new ${mode}: ${count} incomplete attempts respect fifth-run rule`, async () => {
    await compare(Array.from({ length: count }, (_, i) => row({ xpMode: mode, completedSet: false,
      createdAt: NOW + i })), Math.min(count, 4) * 10 * rate);
  });
  test(`new ${mode}: completing fifth and sixth earns full uncapped XP`, async () => {
    await compare(Array.from({ length: 6 }, (_, i) => row({ xpMode: mode, completedSet: i >= 4,
      createdAt: NOW + i })).reverse(), 60 * rate);
  });
}
test('old and new normal attempts share the counter, but preserve their own rates and caps', async () => {
  await compare([
    ...Array.from({ length: 4 }, (_, i) => row({ xpMode: 'vocabTyping', xpPolicyV2: undefined, createdAt: NOW + i })),
    row({ xpMode: 'vocabTyping', completedSet: false, createdAt: NOW + 4 }),
    row({ xpMode: 'vocabTyping', completedSet: true, createdAt: NOW + 5 }),
    row({ xpMode: 'textTyping', xpPolicyV2: undefined }),
    row({ subject: '英検', lesson: '2級', xpMode: 'eikenChoice', xpPolicyV2: undefined }),
    row({ subject: '英検', lesson: '2級', xpMode: 'vocab', xpPolicyV2: undefined }),
  ], 4 * 30 + 70 + 30 + 50 + 10);
});
test('new EIKEN 2 partial attempts remain eligible after the fourth attempt', async () => {
  await compare(Array.from({ length: 6 }, (_, i) => row({ subject: '英検', lesson: '2級',
    xpMode: 'eikenChoice', right: 2, total: 3, completedSet: false, createdAt: NOW + i })), 120);
});
test('retries never upgrade an old EIKEN 2 record to the new rate', async () => {
  const h = accountHarness();
  const payload = { sessionId: '01234567-0123-4123-8123-0123456789ab', grade: '2級', right: 10, total: 10 };
  await h.api.saveEikenResult({ ...payload, xpPolicyV2: false });
  const saved = await h.api.saveEikenResult(payload);
  assert.notEqual(saved.xpPolicyV2, true);
  await compare([saved], 50);
  assert.equal((await h.api.records()).length, 1);
});
test('invalid scores and non-boolean policy markers cannot accidentally receive new XP', async () => {
  await compare([row({ right: 11 }), row({ right: -1 }), row({ total: 0 }), row({ right: 'bad' }),
    row({ xpMode: 'textTyping', xpPolicyV2: 'true' })], 30);
  await assert.rejects(accountHarness().api.saveEikenResult({ sessionId: '01234567-0123-4123-8123-0123456789ab',
    grade: '2級', right: 10, total: 10, xpPolicyV2: 'true' }), /不正/);
});
test('normal practice saves the new policy marker along with its unchanged completion flag', async () => {
  const html = read('index.html'), start = html.indexOf('async function saveSoloRecord(');
  assert.ok(start > 0);
  const end = html.indexOf('\n}\n', start) + 2;
  let saved;
  const nodes = new Map(), getNode = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const sandbox = context({ window: { YoshiAccount: { user: { uid: 'fake' }, save: async r => { saved = r; },
    leaderboard: async () => ({}), syncXP: async () => ({ totalXP: 70 }) } },
    document: { getElementById: getNode }, $: getNode, subject: '英C', selectedLessonId: '1',
    unit: { name: '1' }, selectedStudyMode: 'vocabTyping', normalizedPart: x => x,
    refreshPracticeAttemptCount() {}, showXPCelebration() {}, yoshiLevel: () => ({ level: 1 }),
  });
  vm.runInContext(html.slice(start, end), sandbox);
  await vm.runInContext("saveSoloRecord('vocab',10,10,2,30,false)", sandbox);
  assert.equal(saved.xpPolicyV2, true);
  assert.equal(saved.completedSet, false);
  assert.equal(saved.repeatPolicyV1, true);
  assert.equal(saved.xpMode, 'vocabTyping');
});

test('Daily keeps its existing score even if a new policy flag is present', async () => {
  await compare([row({ dailyV1: true, dailyDeltaXP: 500, mode: 'daily', xpMode: 'daily' })], 500);
});
