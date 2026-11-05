const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, dailyHarness } = require('./helpers/app-harness.cjs');
const day = '2026-11-05';
const start = (h, attemptNumber = 1, dailySubject = 'ec') => h.api.startDailyAttempt({
  dailyDate: day, dailySubject, attemptNumber,
});

for (const [score, xp] of [0, 5, 15, 30, 55, 90, 140, 205, 285, 385, 500].entries()) {
  test(`Daily UI result and persisted XP: ${score}/10 -> ${xp}`, async () => {
    const h = dailyHarness();
    await h.ready();
    await h.evaluate('start()');
    // Feed synthetic answers into the real result handler; scoring values are
    // taken from the existing HTML, never from a copied implementation.
    h.evaluate(`index=9; answers=Array.from({length:10},(_,i)=>({ok:i<${score},type:'word',prompt:'fixture',selected:'x',correct:'x'}));`);
    await h.evaluate('next()');
    const rows = await h.api.records();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].right, score);
    assert.equal(rows[0].dailyScoreXP, xp);
    assert.equal(rows[0].dailyDeltaXP, xp);
    assert.equal(rows[0].dailyCompleted, true);
    assert.equal(h.elements.get('dailyResultXP').textContent, `+${xp} XP`);
    assert.equal((await h.api.syncXP()).totalXP, xp);
  });
}

test('student gets two starts per subject; abandoned slots persist across page reloads', async () => {
  const h = dailyHarness();
  await h.ready();
  await h.evaluate('start()');
  assert.equal((await h.api.records()).length, 1);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  h.listeners.get('beforeunload')(event);
  assert.equal(event.prevented, true);
  assert.equal((await h.api.syncXP()).totalXP, 0);
  // Recreate the page using a snapshot of the fake store, with no completion.
  const second = dailyHarness({ records: h.data.learningRecords[h.uid] });
  await second.ready();
  assert.equal(second.elements.get('start').disabled, false);
  await second.evaluate('start()');
  const rows = await second.api.records();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.total === 0 && r.dailyCompleted === false && r.dailyDeltaXP === 0));
  assert.equal(second.elements.get('start').disabled, true);
  second.evaluate('running=false');
  await second.evaluate('start()');
  assert.equal((await second.api.records()).length, 2);
  second.evaluate("chooseSubject('rp')");
  assert.equal(second.elements.get('start').disabled, false);
  await second.evaluate('start()');
  assert.equal((await second.api.records()).length, 3);
});

test('duplicate/concurrent reservations only create one slot; third slot is rejected', async () => {
  const h = accountHarness();
  const results = await Promise.allSettled([start(h), start(h)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  await start(h, 2);
  await assert.rejects(start(h, 3), /挑戦情報が不正/);
  await assert.rejects(start(h), /既に開始/);
  assert.equal((await h.api.records()).length, 2);
});

test('Daily reservations reject unauthenticated users, stale JST dates and invalid subjects', async () => {
  await assert.rejects(start(accountHarness({ loggedIn: false })), /ログイン/);
  const h = accountHarness();
  await assert.rejects(h.api.startDailyAttempt({ dailyDate: '2026-11-04', dailySubject: 'ec', attemptNumber: 1 }), /日付が変わり/);
  await assert.rejects(start(h, 1, 'invalid'), /挑戦情報が不正/);
  assert.equal((await h.api.records()).length, 0);
});

test('each completed attempt earns full XP; both subjects yield at most 2000 for four perfect runs', async () => {
  const h = accountHarness();
  for (const subject of ['ec', 'rp']) for (const attempt of [1, 2]) {
    const slot = await start(h, attempt, subject);
    await h.api.finishDailyAttempt(slot, { right: 10, dailyScoreXP: 500, dailyDeltaXP: 500 });
  }
  const result = await h.api.syncXP();
  assert.equal(result.totalXP, 2000);
  assert.equal(result.weeklyXP, 2000);
  assert.equal(result.seasonXP, 2000);
});

test('completion retry is idempotent and cannot replace an already completed score', async () => {
  const h = accountHarness();
  const slot = await start(h);
  await h.api.finishDailyAttempt(slot, { right: 9, dailyScoreXP: 385, dailyDeltaXP: 385 });
  const result = await h.api.finishDailyAttempt(slot, { right: 10, dailyScoreXP: 500, dailyDeltaXP: 500 });
  assert.equal(result.alreadySaved, true);
  assert.equal((await h.api.records())[0].right, 9);
  assert.equal((await h.api.syncXP()).totalXP, 385);
});

test('completion rejects missing start, invalid score and negative XP', async () => {
  const h = accountHarness();
  const payload = { right: 10, dailyScoreXP: 500, dailyDeltaXP: 500 };
  await assert.rejects(h.api.finishDailyAttempt('daily_20261105_ec_1', payload), /開始記録がありません/);
  const slot = await start(h);
  for (const right of [-1, 11, 1.5]) await assert.rejects(h.api.finishDailyAttempt(slot, { ...payload, right }), /得点が不正/);
  await assert.rejects(h.api.finishDailyAttempt(slot, { ...payload, dailyDeltaXP: -1 }), /得点が不正/);
});

test('teacher third run is practice: no extra record and no XP', async () => {
  const h = dailyHarness({ teacher: true });
  await start(h, 1); await start(h, 2);
  await h.ready();
  assert.equal(h.elements.get('start').disabled, false);
  await h.evaluate('start()');
  assert.equal(h.evaluate('teacherPractice'), true);
  h.evaluate("index=9;answers=Array.from({length:10},()=>({ok:true,type:'word',prompt:'fixture',selected:'x',correct:'x'}));");
  await h.evaluate('next()');
  assert.equal((await h.api.records()).length, 2);
  assert.equal(h.elements.get('dailyResultXP').textContent, '+0 XP');
  assert.equal((await h.api.syncXP()).totalXP, 0);
});

test('Daily deck is 3 choices + 3 words + 4 sentences; second attempt reuses same questions', async () => {
  const h = dailyHarness(); await h.ready(); await h.evaluate('start()');
  const first = JSON.parse(h.evaluate('JSON.stringify(deck)'));
  assert.deepEqual(first.map(q => q.type), ['choice', 'choice', 'choice', 'word', 'word', 'word', 'sentence', 'sentence', 'sentence', 'sentence']);
  assert.equal(new Set(first.slice(0, 6).map(q => q.type === 'choice' ? q.prompt : q.correct)).size, 6);
  const second = dailyHarness({ records: h.data.learningRecords[h.uid] });
  await second.ready(); await second.evaluate('start()');
  const again = JSON.parse(second.evaluate('JSON.stringify(deck)'));
  const identities = deck => deck.map(q => JSON.stringify([q.type, q.prompt, q.correct])).sort();
  assert.deepEqual(identities(again), identities(first));
});

test('KNOWN GAP: completion API accepts XP unrelated to score; aggregation clamps it to 500', async () => {
  const h = accountHarness(); const slot = await start(h);
  await h.api.finishDailyAttempt(slot, { right: 0, dailyScoreXP: 999, dailyDeltaXP: 999 });
  assert.equal((await h.api.records())[0].dailyDeltaXP, 999);
  assert.equal((await h.api.syncXP()).totalXP, 500);
});
