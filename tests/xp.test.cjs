const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, functionFromLine, NOW } = require('./helpers/app-harness.cjs');

const row = (overrides = {}) => ({ subject: '英C', lesson: '7', part: '1', mode: 'vocab',
  xpMode: 'vocab', right: 3, total: 10, repeatPolicyV1: true, completedSet: false,
  createdAt: NOW, ...overrides });
const records = rows => Object.fromEntries(rows.map((r, i) => [`row${i}`, r]));

for (const [mode, right, expected] of [
  ['text', 10, 0], ['textTyping', 3, 21], ['vocabTyping', 3, 12], ['vocab', 3, 3],
  ['textTyping', 10, 30], ['vocabTyping', 10, 30], ['vocab', 100, 30], ['unknown', 10, 0],
]) test(`XP: ${mode}, ${right} correct -> ${expected}`, async () => {
  const h = accountHarness({ records: records([row({ xpMode: mode, right, total: Math.max(10, right) })]) });
  assert.equal((await h.api.syncXP()).totalXP, expected);
});

for (const count of [1, 2, 3, 4, 5, 6]) {
  test(`unfinished normal attempts 1..${count} earn XP only for first four`, async () => {
    const rows = Array.from({ length: count }, (_, i) => row({ createdAt: NOW + i }));
    const h = accountHarness({ records: records(rows) });
    assert.equal((await h.api.syncXP()).totalXP, Math.min(count, 4) * 3);
  });
}

test('completed fifth and sixth attempts earn XP; chronological order wins over storage order', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => row({ createdAt: NOW + i, completedSet: i >= 4 }));
  const h = accountHarness({ records: records(rows.reverse()) });
  assert.equal((await h.api.syncXP()).totalXP, 18);
});

test('subject, lesson, part and XP mode each have independent attempt counters', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ createdAt: NOW + i }));
  rows.push(row({ subject: '論表' }), row({ lesson: '8' }), row({ part: '2' }), row({ xpMode: 'vocabTyping' }));
  assert.equal((await accountHarness({ records: records(rows) }).api.syncXP()).totalXP, 33);
});

test('legacy attempts count toward four, but legacy fifth records retain XP', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => row({ repeatPolicyV1: undefined, createdAt: NOW + i }));
  rows.push(row({ createdAt: NOW + 4 }), row({ repeatPolicyV1: undefined, createdAt: NOW + 5 }));
  assert.equal((await accountHarness({ records: records(rows) }).api.syncXP()).totalXP, 15);
});

test('invalid/unfinished rows earn nothing and do not consume the normal attempt counter', async () => {
  const rows = [row({ total: 0 }), row({ right: -1 }), row({ right: 11 }), row({ total: 'bad' }),
    row({ right: 'bad' }), ...Array.from({ length: 4 }, () => row())];
  assert.equal((await accountHarness({ records: records(rows) }).api.syncXP()).totalXP, 12);
});

test('weekly and season aggregates select by record timestamp; sync is repeatable', async () => {
  const h = accountHarness({ records: records([
    row(), row({ createdAt: Date.parse('2026-10-15T12:00:00+09:00') }),
    row({ createdAt: Date.parse('2026-09-01T12:00:00+09:00') }),
  ]) });
  const result = await h.api.syncXP();
  assert.equal(result.totalXP, 9);
  assert.equal(result.weeklyXP, 3);
  assert.equal(result.seasonXP, 6);
  assert.equal(result.seasonId, '2026-S3');
  assert.deepEqual(await h.api.syncXP(), result);
});

test('KNOWN DISCREPANCY: teacher and historical display omit Daily XP', async () => {
  const daily = row({ dailyV1: true, xpMode: 'daily', mode: 'daily', right: 10, dailyDeltaXP: 500 });
  const h = accountHarness({ records: records([daily]) });
  assert.equal((await h.api.syncXP()).totalXP, 500);
  assert.equal(functionFromLine('teacher.html', 'xpFromRecords')([daily]), 0);
  assert.equal(functionFromLine('ranking.html', 'recordXP')(daily), 0);
});

test('KNOWN DISCREPANCY: teacher and history ignore fifth-attempt restriction', async () => {
  const rows = Array.from({ length: 5 }, () => row());
  assert.equal((await accountHarness({ records: records(rows) }).api.syncXP()).totalXP, 12);
  assert.equal(functionFromLine('teacher.html', 'xpFromRecords')(rows), 15);
  const historical = functionFromLine('ranking.html', 'recordXP');
  assert.equal(rows.reduce((sum, r) => sum + historical(r), 0), 15);
});
