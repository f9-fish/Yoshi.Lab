const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSnapshot, cutoff, makeBadge, publishOnce, sourceHash } = require('../scripts/season-achievements.cjs');
const { merge } = require('../scripts/merge-season-achievement-rules.cjs');
const { accountHarness, read } = require('./helpers/app-harness.cjs');
const ranks = require('../yoshi-ranks-v14.js');

const uid = 'student_test_001';
const record = (ts, right = 1, extra = {}) => ({
  createdAt: ts, total: right, right, xpPolicyV2: true, mode: 'textTyping',
  subject: '英C', lesson: '1', part: '1', ...extra,
});
const source = (studentProfiles, learningRecords = {}) => ({ asOf: cutoff, studentProfiles, learningRecords });
const snapshot = (input, now = cutoff) => buildSnapshot(input, { now, sourceHash: sourceHash(JSON.stringify(input)) });

test('cannot finalize at 23:59:59 JST, accepts midnight and 00:00:01, and includes the last millisecond', () => {
  const data = source({ [uid]: { name: 'Student' }, late: { name: 'Late', createdAt: cutoff } }, {
    [uid]: [record(cutoff - 1000), record(cutoff - 1), record(cutoff), record(cutoff + 1000)],
  });
  data.leaderboard = { [uid]: { seasonId: '2026-S4', seasonXP: 999999 } };
  assert.throws(() => snapshot(data, cutoff - 1000), /終了時刻/);
  for (const now of [cutoff, cutoff + 1000]) {
    const result = snapshot(data, now);
    assert.equal(result.metadata.count, 1);
    assert.equal(result.students[uid].seasonXp, 20);
    assert.equal(result.students[uid].studyDays, 1);
    assert.equal(result.students[uid].createdAt, now);
    assert.equal(result.students[uid].highestRankTier, 'unknown');
  }
  assert.throws(() => snapshot({ ...data, asOf: cutoff + 1 }), /エクスポート/);
});

test('final order uses the current tie-breakers and all registered profiles, with only ten Radiant', () => {
  const profiles = { zero: { name: 'Zero' }, bronze: { name: 'Bronze' } };
  const records = { bronze: [record(cutoff - 1000)] };
  for (let i = 11; i >= 1; i--) {
    const key = 'p' + String(i).padStart(2, '0');
    profiles[key] = { name: i === 2 ? 'A' : 'Same' };
    records[key] = [record(cutoff - 1000, 1200)];
  }
  const result = snapshot(source(profiles, records));
  assert.equal(result.metadata.count, 13);
  assert.equal(result.students.p02.finalPosition, 1);
  assert.equal(result.students.p01.finalPosition, 2);
  for (const [position, row] of Object.entries(result.ranking.top10)) {
    assert.equal(row.badgeLabel, 'TOP 10 RADIANT #' + position);
  }
  assert.equal(result.students.p11.finalPosition, 11);
  assert.equal(result.students.p11.finalRankTier, 'Master');
  assert.equal(result.students.p11.badgeLabel, 'SEASON 1 Master');
  assert.deepEqual(makeBadge('Radiant', 11), { badgeType: 'season_record', badgeLabel: 'SEASON 1 Radiant' });
  assert.equal(result.students.zero.seasonXp, 0);
  assert.equal(result.students.zero.studyDays, 0);
  assert.equal(result.students.zero.finalRankTier, 'Bronze');
  assert.deepEqual(Object.keys(result.ranking.badges.zero).sort(), ['badgeLabel', 'badgeType', 'finalRankTier']);
});

test('pre-season repeats carry over, late Daily finishes are excluded, and milestones follow JST days', () => {
  const daily = day => ({
    ...record(Date.parse('2026-11-' + day + 'T23:00:00+09:00'), 10),
    total: 10, dailyV1: true, dailyCompleted: true, dailySubject: 'ec', dailyDeltaXP: 20,
    dailyDate: '2026-11-' + day, finishedAt: Date.parse('2026-11-' + day + 'T23:10:00+09:00'),
    mode: 'daily', lesson: 'DAILY', part: String(day),
  });
  const rows = Array.from({ length: 4 }, (_, i) => record(Date.parse('2026-09-01T00:00:00+09:00') + i));
  rows.push(record(cutoff - 1000, 1, { repeatPolicyV1: true, completedSet: false }));
  rows.push(daily(25), daily(26), daily(27), { ...daily(27), finishedAt: cutoff }, daily(28));
  rows.push(record(Date.parse('2027-01-01T00:00:00+09:00'), 999));
  const result = snapshot(source({ [uid]: { name: 'Student' } }, { [uid]: rows }));
  assert.equal(result.students[uid].seasonXp, 160);
  assert.equal(result.students[uid].studyDays, 3);
});

test('saved S3 achievements are read independently and do not change S4 sync or standings', async () => {
  const data = source({ [uid]: { name: 'Student' } }, { [uid]: [record(cutoff - 1000), record(cutoff)] });
  const final = snapshot(data);
  const h = accountHarness({ records: data.learningRecords[uid], now: cutoff });
  h.data.seasonAchievements = { '2026-S3': final };
  const result = await h.api.syncXP();
  assert.equal(result.seasonId, '2026-S4');
  assert.equal(result.seasonXP, 10);
  assert.equal(result.totalXP, 20);
  const saved = await h.api.seasonAchievement();
  assert.equal(saved.seasonId, '2026-S3');
  assert.equal(saved.seasonXp, 10);
  assert.equal((await h.api.seasonAchievementRanking()).top10[1].name, 'Student');
  assert.equal(ranks.standings({ [uid]: result }, h.api.getSeason())[0].seasonXP, 10);
  assert.equal(await accountHarness({ loggedIn: false }).api.seasonAchievement(), null);
});

test('a lost acknowledgement or concurrent retry leaves one immutable snapshot', async () => {
  const data = source({ [uid]: { name: 'Student' } });
  const first = snapshot(data);
  let stored = null;
  let loseAck = true;
  const ref = { async transaction(update) {
    const next = update(stored);
    if (next) stored = structuredClone(next);
    if (loseAck) { loseAck = false; throw Error('lost acknowledgement'); }
    return { committed: Boolean(next), snapshot: { val: () => stored } };
  } };
  await assert.rejects(publishOnce(ref, first), /lost acknowledgement/);
  const retry = await publishOnce(ref, snapshot(data, cutoff + 1000));
  assert.equal(retry.status, 'already-published');
  assert.equal(retry.createdAt, cutoff);
  await assert.rejects(publishOnce(ref, snapshot(source({ other: { name: 'Other' } }))), /既存データ/);
  assert.deepEqual(Object.keys(stored.students), [uid]);
  stored = null;
  const results = await Promise.all([publishOnce(ref, first), publishOnce(ref, first)]);
  assert.deepEqual(results.map(result => result.status), ['published', 'already-published']);
});

test('Rules merge adds a protected namespace without modifying existing permissions', () => {
  const baseline = require('../firebase-rtdb.rules.qa-integrated.json');
  const { seasonAchievements, ...rules } = merge(baseline).rules;
  assert.deepEqual(rules, baseline.rules);
  assert.equal(seasonAchievements['.write'], false);
  assert.throws(() => merge(merge(baseline)), /確認/);
  assert.throws(() => merge({ rules: { '.read': true } }), /包括的/);
  assert.throws(() => merge({ rules: { '$other': { '.read': true } } }), /確認/);
});

test('badge renderer displays large numbered special variants and treats names as text', () => {
  const element = () => ({
    children: [], attributes: {}, classList: { add(...values) { this.values = values; } },
    append(...values) { this.children.push(...values); },
    replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attributes[key] = value; },
  });
  const sandbox = { window: {}, document: { createElement: element } };
  vm.runInNewContext(read('season-achievements-ui.js'), sandbox);
  const ui = sandbox.window.YoshiSeasonAchievements;
  for (const position of [1, 2, 3, 4, 10]) {
    const emblem = ui.badge({ finalRankTier: 'Radiant', finalPosition: position, badgeType: 'radiant_top10' });
    assert.equal(emblem.attributes['aria-label'], 'TOP 10 RADIANT #' + position);
    assert.equal(emblem.children[1].textContent, String(position));
    assert.equal(emblem.children[0].textContent, position === 1 ? '♛' : '★');
  }
  const container = element();
  ui.renderTop(container, { first: { name: '<b>Student</b>', finalRankTier: 'Gold', finalPosition: 1 } });
  assert.equal(container.children[0].children[0].children[1].textContent, '<b>Student</b>');
});
