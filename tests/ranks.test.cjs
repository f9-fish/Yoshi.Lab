const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { context, read } = require('./helpers/app-harness.cjs');
const sandbox = context({ window: {} });
vm.runInContext(read('yoshi-ranks-v14.js'), sandbox, { timeout: 1000 });
const rank = sandbox.window.YoshiRanks.get;

// Explicit fixtures protect the current rounding and thresholds, without
// reproducing the application's division calculation in the expectation.
for (const [tier, name, boundaries] of [
  [0, 'ブロンズ', [0, 167, 334, 500]],
  [1, 'シルバー', [500, 834, 1167, 1500]],
  [2, 'ゴールド', [1500, 2167, 2834, 3500]],
  [3, 'プラチナ', [3500, 4667, 5834, 7000]],
  [4, 'ダイヤモンド', [7000, 8667, 10334, 12000]],
]) {
  for (const [i, division] of ['Ⅲ', 'Ⅱ', 'Ⅰ'].entries()) {
    test(`${name} ${division}: lower and upper boundaries`, () => {
      for (const xp of [boundaries[i], boundaries[i + 1] - 1]) {
        assert.equal(rank(xp).tier, tier);
        assert.equal(rank(xp).name, `${name} ${division}`);
        assert.equal(rank(xp).min, boundaries[i]);
        assert.equal(rank(xp).next, boundaries[i + 1]);
      }
    });
  }
}
test('master starts at 12000; radiant requires positions 0..9', () => {
  assert.equal(rank(11999, 0).tier, 4);
  for (const position of [-1, 10, 11]) assert.equal(rank(12000, position).name, 'マスター');
  for (const position of [0, 9]) assert.equal(rank(12000, position).name, 'レディアント');
  assert.equal(rank(12000).division, '');
  assert.equal(rank(12000).next, null);
  assert.equal(rank(-1).name, 'ブロンズ Ⅲ');
});

test('season standings exclude stale XP and do not require grade or class data', () => {
  const board = { a: { name: 'A', seasonId: 'current', seasonXP: 12000 },
    b: { name: 'B', seasonId: 'old', seasonXP: 90000, totalXP: 90000 },
    c: { name: 'C', seasonId: 'current', seasonXP: '13000', grade: 3, classNumber: 9 } };
  const before = structuredClone(board);
  const sorted = sandbox.window.YoshiRanks.standings(board, { id: 'current' });
  assert.deepEqual(Array.from(sorted, r => [r.id, r.seasonXP]), [['c', 13000], ['a', 12000], ['b', 0]]);
  assert.deepEqual(board, before);
});
test('equal XP and names use the same UID order regardless of snapshot entry order', () => {
  const a = { name: 'Same', seasonId: 'current', seasonXP: 12000 };
  const standings = sandbox.window.YoshiRanks.standings;
  for (const board of [{ b: a, a }, { a, b: a }]) {
    assert.deepEqual(Array.from(standings(board, { id: 'current' }), r => r.id), ['a', 'b']);
  }
});
test('missing active season and invalid leaderboard rows never produce radiant XP', () => {
  const standings = sandbox.window.YoshiRanks.standings;
  assert.equal(standings(null, null).length, 0);
  const board = { a: { name: 'A', seasonXP: 13000 }, b: null,
    c: { seasonId: 'current', seasonXP: Infinity }, d: { seasonId: 'current', seasonXP: -1 } };
  assert.ok(standings(board, null).every(r => r.seasonXP === 0));
  assert.ok(standings(board, { id: 'current' }).every(r => r.seasonXP === 0));
});
