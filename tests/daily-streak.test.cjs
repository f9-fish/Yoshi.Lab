const test = require('node:test');
const assert = require('node:assert/strict');
const { dailyHarness } = require('./helpers/app-harness.cjs');

const completed = (day, overrides = {}) => ({ dailyV1: true, dailyCompleted: true,
  dailyDate: day, dailySubject: 'ec', ...overrides });
const marks = h => h.elements.get('dailyStreak').children[3].children.map(cell => cell.children[1].textContent);

for (const [label, rows, expectedCount, expectedMarks] of [
  ['today completed', [completed('2026-11-05')], 1, ['·','·','·','·','·','·','✓']],
  ['yesterday completed, today not yet done', [completed('2026-11-04')], 1, ['·','·','·','·','·','✓','·']],
  ['consecutive dates and duplicate subject attempts', [completed('2026-11-03'), completed('2026-11-04'),
    completed('2026-11-05'), completed('2026-11-05', { dailySubject: 'rp' })], 3, ['·','·','·','·','✓','✓','✓']],
  ['abandoned and non-Daily records do not count', [completed('2026-11-05', { dailyCompleted: false }),
    completed('2026-11-04', { dailyV1: false })], 0, ['·','·','·','·','·','·','·']],
  ['gap breaks streak but preserves older checkmark', [completed('2026-11-03'), completed('2026-11-05')], 1,
    ['·','·','·','·','✓','·','✓']],
]) {
  test(`Daily weekday checkmarks: ${label}`, async () => {
    const h = dailyHarness({ records: Object.fromEntries(rows.map((r, i) => [`fixture${i}`, r])) });
    await h.ready();
    assert.equal(h.evaluate('dailyStreakCount(dailyRows)'), expectedCount);
    assert.equal(h.elements.get('dailyStreak').children[1].textContent, `🔥 ${expectedCount}日連続`);
    assert.deepEqual(marks(h), expectedMarks);
    assert.equal(h.elements.get('dailyStreak').children[3].children[6].children[0].textContent, '木');
  });
}

test('Daily streak continues across year boundary and excludes malformed dates', () => {
  const h = dailyHarness();
  const rows = [completed('2025-12-31'), completed('2026-01-01'), completed('not-a-date')];
  assert.equal(h.evaluate(`dailyStreakCount(${JSON.stringify(rows)},'2026-01-01')`), 2);
});

test('completing and saving a Daily immediately refreshes today checkmark', async () => {
  const h = dailyHarness(); await h.ready();
  assert.deepEqual(marks(h), ['·','·','·','·','·','·','·']);
  await h.evaluate('start()');
  assert.equal(marks(h)[6], '·', 'Starting alone must not mark completion');
  h.evaluate("index=9;answers=Array.from({length:10},()=>({ok:true,type:'word',prompt:'fixture',selected:'x',correct:'x'}));");
  await h.evaluate('next()');
  assert.equal(marks(h)[6], '✓');
  assert.equal(h.elements.get('dailyStreak').children[1].textContent, '🔥 1日連続');
});
