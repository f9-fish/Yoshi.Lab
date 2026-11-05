const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { accountHarness, functionFromLine, context, read } = require('./helpers/app-harness.cjs');

const recordXP = functionFromLine('ranking.html', 'recordXP');
const historicalXP = functionFromLine('ranking.html', 'historicalSeasonXP', { recordXP });
const seasons = accountHarness().api.getSeasons();
const season = seasons.find(s => s.id === '2026-S2');
const timestamp = Date.parse('2026-07-15T12:00:00+09:00');
const row = (overrides = {}) => ({ subject: '英C', lesson: '7', part: '1', mode: 'vocab',
  xpMode: 'vocab', right: 3, total: 10, createdAt: timestamp,
  repeatPolicyV1: true, completedSet: false, ...overrides });
const attempts = (count, overrides = {}) => Array.from({ length: count }, (_, i) => row({ createdAt: timestamp + i, ...overrides }));
const daily = (xp, overrides = {}) => row({ dailyV1: true, mode: 'daily', xpMode: 'daily',
  total: 10, right: 10, dailyDeltaXP: xp, repeatPolicyV1: undefined, completedSet: true, ...overrides });

for (const [label, rows, expected] of [
  ['empty history', [], 0],
  ['Daily table and per-record clamp', [0, 5, 15, 30, 55, 90, 140, 205, 285, 385, 500]
    .map((xp, right) => daily(xp, { right })).concat([daily(999), daily(-1), daily(undefined)]), 2210],
  ['first four unfinished attempts', attempts(4), 12],
  ['fifth and sixth unfinished attempts', attempts(6), 12],
  ['fifth and sixth completed attempts', [...attempts(4), row({ createdAt: timestamp + 4, completedSet: true }),
    row({ createdAt: timestamp + 5, completedSet: true })], 18],
  ['legacy records retain XP and count toward new-policy attempts', [
    ...attempts(4, { repeatPolicyV1: undefined }), row({ createdAt: timestamp + 4 }),
    row({ createdAt: timestamp + 5, repeatPolicyV1: undefined })], 15],
  ['earlier seasons count toward the attempt limit', [
    ...attempts(4, { createdAt: Date.parse(seasons[0].start) }), row()], 0],
  ['chronological order rather than storage order', [...attempts(4),
    row({ createdAt: timestamp + 4, completedSet: true }), row({ createdAt: timestamp + 5 })].reverse(), 15],
  ['separate subject, lesson, part and mode counters', [...attempts(5),
    row({ subject: '論表' }), row({ lesson: '8' }), row({ part: '2' }), row({ xpMode: 'vocabTyping' })], 33],
  ['unchanged rates, cap and legacy fallback', [row({ xpMode: 'text' }),
    row({ xpMode: 'textTyping' }), row({ xpMode: 'vocabTyping' }), row({ xpMode: undefined }),
    row({ xpMode: 'textTyping', right: 10 }), row({ xpMode: 'vocabTyping', right: 10 })], 96],
  ['invalid and abandoned rows do not consume attempts', [row({ total: 0 }), row({ right: -1 }),
    row({ right: 11 }), row({ right: 'bad' }), row({ total: 'bad' }), daily(500, { total: 0, right: 0 }), ...attempts(4)], 12],
  ['inclusive season boundaries, excluding adjacent milliseconds', [
    daily(500, { createdAt: Date.parse(season.start) - 1 }), daily(500, { createdAt: Date.parse(season.start) }),
    daily(500, { createdAt: Date.parse(season.end) }), daily(500, { createdAt: Date.parse(season.end) + 1 })], 1000],
]) {
  test(`past season matches common seasonXP: ${label}`, async () => {
    const before = structuredClone(rows);
    // Run the actual common API with its clock inside the historical season.
    const h = accountHarness({ now: timestamp, records: Object.fromEntries(rows.map((r, i) => [`fixture${i}`, r])) });
    const common = await h.api.syncXP();
    assert.equal(common.seasonId, season.id);
    assert.equal(common.seasonXP, expected);
    assert.equal(historicalXP(rows, season), common.seasonXP);
    assert.deepEqual(rows, before);
  });
}

function historyRenderer(seasonList = seasons) {
  const node = tag => ({ tag, textContent: '', children: [],
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const output = node('section');
  const sandbox = context({ window: {} });
  vm.runInContext(read('yoshi-ranks-v14.js'), sandbox);
  const ranks = sandbox.window.YoshiRanks;
  const render = functionFromLine('ranking.html', 'renderHistory', {
    $: () => output, document: { createElement: node },
    window: { YoshiAccount: { getSeasons: () => seasonList }, YoshiRanks: ranks },
    tiers: ranks.tiers, rankOf: functionFromLine('ranking.html', 'rankOf', { tiers: ranks.tiers }),
    historicalSeasonXP: historicalXP,
  });
  return { output, render };
}

test('history renderer uses corrected XP, shows ended seasons newest first and no final radiant position', () => {
  const h = historyRenderer();
  h.render([daily(500), ...Array.from({ length: 24 }, () => daily(500, { createdAt: Date.parse(seasons[0].start) }))]);
  assert.equal(h.output.children.length, 3); // Two ended seasons and the existing explanatory note.
  const [s2, s1, note] = h.output.children;
  assert.equal(s2.children[1].children[0].textContent, '2026年前期 SEASON 2 · シルバー Ⅲ');
  assert.match(s2.children[1].children[1].textContent, /^500 XP ／ /);
  assert.equal(s1.children[1].children[0].textContent, '2026年前期 SEASON 1 · マスター');
  assert.match(s1.children[1].children[1].textContent, /^12,000 XP ／ /);
  assert.match(note.textContent, /レディアントの最終順位は保存されていないため表示しません/);
});

test('history renderer preserves the no-ended-season message', () => {
  const h = historyRenderer([]); h.render([]);
  assert.equal(h.output.textContent, '最初のシーズン終了後に、ここへ成績が残ります。');
});
