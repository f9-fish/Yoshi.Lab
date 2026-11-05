const test = require('node:test');
const assert = require('node:assert/strict');
const { dailyHarness } = require('./helpers/app-harness.cjs');

const completed = (day, overrides = {}) => ({ dailyV1: true, dailyCompleted: true,
  dailyDate: day, dailySubject: 'ec', total: 10, right: 10, ...overrides });
const marks = h => h.elements.get('dailyStreak').children[3].children.map(cell => cell.children[1].textContent);

for (const [label, rows, expectedCount, expectedMarks] of [
  ['today completed', [completed('2026-11-05')], 1, ['·','·','·','✓','·','·','·']],
  ['yesterday completed, today not yet done', [completed('2026-11-04')], 1, ['·','·','✓','·','·','·','·']],
  ['consecutive dates and duplicate subject attempts', [completed('2026-11-03'), completed('2026-11-04'),
    completed('2026-11-05'), completed('2026-11-05', { dailySubject: 'rp' })], 3, ['·','✓','✓','✓','·','·','·']],
  ['abandoned and non-Daily records do not count', [completed('2026-11-05', { dailyCompleted: false }),
    completed('2026-11-04', { dailyV1: false })], 0, ['·','·','·','·','·','·','·']],
  ['nonconsecutive days both count toward the week', [completed('2026-11-03'), completed('2026-11-05')], 2,
    ['·','✓','·','✓','·','·','·']],
]) {
  test(`Daily weekday checkmarks: ${label}`, async () => {
    const h = dailyHarness({ records: Object.fromEntries(rows.map((r, i) => [`fixture${i}`, r])) });
    await h.ready();
    assert.equal(h.evaluate('YoshiWeeklyDaily.progress(dailyRows).count'), expectedCount);
    assert.equal(h.elements.get('dailyStreak').children[1].textContent, `🔥 ${expectedCount}日 / 7日達成`);
    assert.deepEqual(marks(h), expectedMarks);
    assert.equal(h.elements.get('dailyStreak').children[3].children[3].children[0].textContent, '木');
  });
}

test('Daily weekly count spans year boundary and excludes malformed dates', () => {
  const h = dailyHarness();
  const rows = [completed('2025-12-31'), completed('2026-01-01'), completed('not-a-date')];
  assert.equal(h.evaluate(`YoshiWeeklyDaily.progress(${JSON.stringify(rows)},Date.parse('2026-01-01T12:00:00+09:00')).count`), 2);
});

test('completing and saving a Daily immediately refreshes today checkmark', async () => {
  const h = dailyHarness(); await h.ready();
  assert.deepEqual(marks(h), ['·','·','·','·','·','·','·']);
  await h.evaluate('start()');
  assert.equal(marks(h)[3], '·', 'Starting alone must not mark completion');
  h.evaluate("index=9;answers=Array.from({length:10},()=>({ok:true,type:'word',prompt:'fixture',selected:'x',correct:'x'}));");
  await h.evaluate('next()');
  assert.equal(marks(h)[3], '✓');
  assert.equal(h.elements.get('dailyStreak').children[1].textContent, '🔥 1日 / 7日達成');
});
