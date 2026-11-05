const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, functionFromLine, NOW } = require('./helpers/app-harness.cjs');

const teacherXP = functionFromLine('teacher.html', 'xpFromRecords');
const row = (overrides = {}) => ({ subject: '英C', lesson: '7', part: '1',
  mode: 'vocab', xpMode: 'vocab', right: 3, total: 10,
  repeatPolicyV1: true, completedSet: false, createdAt: NOW, ...overrides });
const attempts = (count, overrides = {}) => Array.from({ length: count }, (_, i) =>
  row({ createdAt: NOW + i, ...overrides }));
const daily = (delta, overrides = {}) => row({ dailyV1: true, mode: 'daily', xpMode: 'daily',
  dailyDeltaXP: delta, right: 10, total: 10, completedSet: true,
  repeatPolicyV1: undefined, ...overrides });

for (const [label, rows, expected] of [
  ['empty history', [], 0],
  ['mode rates and 30 XP per-record cap', [row({ xpMode: 'text' }),
    row({ xpMode: 'textTyping' }), row({ xpMode: 'vocabTyping' }), row(),
    row({ xpMode: 'textTyping', right: 10 }), row({ xpMode: 'vocabTyping', right: 10 })], 96],
  ['first four unfinished attempts', attempts(4), 12],
  ['fifth and sixth unfinished attempts', attempts(6), 12],
  ['fifth and sixth completed attempts', [...attempts(4),
    row({ createdAt: NOW + 4, completedSet: true }), row({ createdAt: NOW + 5, completedSet: true })], 18],
  ['out-of-order history uses chronological attempt order', [...attempts(4),
    row({ createdAt: NOW + 4, completedSet: true }), row({ createdAt: NOW + 5 })].reverse(), 15],
  ['subject, lesson, part and mode have independent counters', [...attempts(5),
    row({ subject: '論表' }), row({ lesson: '8' }), row({ part: '2' }), row({ xpMode: 'vocabTyping' })], 33],
  ['legacy records count toward repeat limit but retain their own XP', [
    ...attempts(4, { repeatPolicyV1: undefined }), row({ createdAt: NOW + 4 }),
    row({ createdAt: NOW + 5, repeatPolicyV1: undefined })], 15],
  ['legacy mode fallback', [row({ xpMode: undefined, mode: 'vocab' }),
    row({ xpMode: undefined, mode: 'text' })], 3],
  ['invalid and abandoned records do not consume attempts', [row({ total: 0 }),
    row({ right: -1 }), row({ right: 11 }), row({ total: 'bad' }), row({ right: 'bad' }),
    daily(500, { total: 0, right: 0 }), ...attempts(4)], 12],
  ['Daily uses delta XP independently of normal limits', [...attempts(5),
    ...Array.from({ length: 6 }, () => daily(500))], 3012],
  ['Daily delta clamp and missing values match common calculation', [daily(999),
    daily(-1), daily(undefined), daily('bad'), daily(385)], 885],
  ['current Daily score table', [0, 5, 15, 30, 55, 90, 140, 205, 285, 385, 500]
    .map((xp, right) => daily(xp, { right })), 1710],
]) {
  test(`teacher XP matches common calculation: ${label}`, async () => {
    const before = structuredClone(rows);
    const records = Object.fromEntries(rows.map((r, i) => [`fixture${i}`, r]));
    const common = await accountHarness({ records }).api.syncXP();
    assert.equal(common.totalXP, expected);
    assert.equal(teacherXP(rows), expected);
    assert.deepEqual(rows, before, 'Teacher calculation must not mutate records or ordering');
  });
}
