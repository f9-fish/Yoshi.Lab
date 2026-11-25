const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, functionFromLine } = require('./helpers/app-harness.cjs');

const boundary = Date.parse('2026-11-28T00:00:00+09:00');
const study = createdAt => ({
  createdAt, subject: '英C', lesson: '7', part: '1', mode: 'textTyping',
  total: 1, right: 1, xpPolicyV2: true, completedSet: true,
});
const daily = day => ({
  createdAt: Date.parse('2026-11-' + day + 'T08:00:00+09:00'),
  dailyDate: '2026-11-' + day, dailySubject: 'ec', dailyV1: true,
  dailyCompleted: true, dailyDeltaXP: 5, total: 10, right: 1,
  subject: '英C', lesson: 'DAILY', part: String(day), mode: 'daily',
});

test('SEASON 2 starts at midnight JST and XP starts at zero without resetting total or weekly XP', async () => {
  const h = accountHarness({ now: boundary - 1000, records: {
    lastSecond: study(boundary - 1000),
  } });
  await new Promise(resolve => setImmediate(resolve));
  h.writes.length = 0;
  const before = await h.api.syncXP();
  assert.equal(before.seasonId, '2026-S3');
  assert.equal(before.seasonXP, 10);
  h.advanceTo(boundary - 1);
  assert.equal(h.api.getSeason().id, '2026-S3');
  h.data.learningRecords[h.uid].lastMillisecond = study(boundary - 1);
  h.data.questionFavorites = { [h.uid]: { example: true } };
  h.advanceTo(boundary);
  const at = await h.api.syncXP();
  assert.deepEqual([at.seasonId, at.seasonXP, at.totalXP, at.weeklyXP], ['2026-S4', 0, 20, 20]);
  assert.equal(at.weekKey, before.weekKey);
  h.data.learningRecords[h.uid].firstMillisecond = study(boundary);
  h.data.learningRecords[h.uid].firstSecond = study(boundary + 1000);
  h.advanceTo(boundary + 1000);
  const after = await h.api.syncXP();
  assert.deepEqual([after.seasonId, after.seasonXP, after.totalXP, after.weeklyXP], ['2026-S4', 20, 40, 40]);
  assert.equal(after.weekKey, before.weekKey);
  const historyXP = functionFromLine('ranking.html', 'historicalSeasonXP', {
    recordXP: functionFromLine('ranking.html', 'recordXP'),
  });
  const past = h.api.getSeasons().find(s => s.id === '2026-S3');
  assert.equal(historyXP(await h.api.records(), past), 20);
  assert.equal(Object.keys(h.data.learningRecords[h.uid]).length, 4);
  assert.deepEqual(h.data.questionFavorites, { [h.uid]: { example: true } });
  assert.deepEqual(h.writes, Array(3).fill('leaderboard/' + h.uid));
});

test('Daily completions across the boundary still earn the same weekly milestone', async () => {
  const h = accountHarness({ now: boundary + 9 * 3600000, records: {
    first: daily(26), second: daily(27), third: daily(28),
  } });
  const xp = await h.api.syncXP();
  assert.deepEqual([xp.seasonXP, xp.totalXP, xp.weeklyXP], [105, 115, 115]);
});

test('an open guest tab detects midnight by timer and suspended tabs catch up when visible', async () => {
  const timed = accountHarness({ now: boundary - 1000, loggedIn: false });
  const seen = [];
  timed.sandbox.document.addEventListener('yoshi-season-change', () => seen.push(timed.api.getSeason().id));
  timed.advanceTo(boundary - 1);
  assert.deepEqual(seen, []);
  timed.advanceTo(boundary);
  timed.advanceTo(boundary + 1000);
  assert.deepEqual(seen, ['2026-S4']);
  assert.equal(await timed.api.syncXP(), null);
  assert.deepEqual(timed.writes, []);

  const suspended = accountHarness({ now: boundary - 1000, loggedIn: false });
  const resumed = [];
  suspended.sandbox.document.addEventListener('yoshi-season-change', () => resumed.push(suspended.api.getSeason().id));
  suspended.advanceTo(boundary + 1000, { runTimers: false });
  suspended.sandbox.document.dispatchEvent(new Event('visibilitychange'));
  suspended.sandbox.window.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(resumed, ['2026-S4']);
  assert.deepEqual(suspended.writes, []);
});
