const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, parseJson, seal, validateSource } = require('../scripts/season-achievement-source.cjs');
const { buildSnapshot, cutoff, sourceHash } = require('../scripts/season-achievements.cjs');

const databaseURL = 'https://yoshi-lab-db3eb-default-rtdb.firebaseio.com';
const fixture = { studentProfiles: { student: { name: 'Test', createdAt: cutoff - 10000 } },
  learningRecords: { student: { record: { createdAt: cutoff - 1, right: 1, total: 1, mode: 'vocab' } } },
  leaderboard: { student: { seasonXP: 99999 } }, unrelated: 'private' };
const ref = 'restricted audit record 31';
const bytes = value => Buffer.from(JSON.stringify(value));
const verified = input => ({
  method: 'verified-cutoff', asOf: cutoff, databaseURL, reference: ref, inputSha256: sourceHash(input),
});

test('read-only capture uses one post-cutoff root response, retaining only the two input paths', async () => {
  let calls = 0;
  const readRoot = async url => { assert.equal(url, databaseURL); calls++; return fixture; };
  await assert.rejects(capture({ databaseURL, readRoot, now: () => cutoff - 1 }), /締切前/);
  assert.equal(calls, 0);
  const captured = await capture({ databaseURL, readRoot, now: () => cutoff + 2 });
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(captured), ['capture', 'studentProfiles', 'learningRecords']);
  assert.equal(captured.capture.startedAt, cutoff + 2);
  assert.throws(() => validateSource(captured, cutoff + 3), /締切時点/);
  const input = bytes(captured);
  assert.throws(() => seal(input, verified(input), cutoff + 5), /復元点として使えません/);
  const witness = { method: 'unchanged-window', databaseURL, reference: ref,
    inputSha256: sourceHash(input), unchangedFrom: cutoff - 2, unchangedThrough: cutoff + 4 };
  assert.throws(() => seal(input, { ...witness, unchangedFrom: cutoff }, cutoff + 5), /監査|根拠/);
  assert.throws(() => seal(input, { ...witness, unchangedThrough: cutoff + 1 }, cutoff + 5), /根拠/);
  assert.throws(() => seal(input, witness, cutoff + 3), /確認済み/);
  const ready = seal(input, witness, cutoff + 5);
  assert.equal(validateSource(ready, cutoff + 5), databaseURL);
});

test('verified cutoff requires exact proof, integrity and completed season', () => {
  const input = bytes(fixture);
  const proof = verified(input);
  assert.throws(() => seal(input, proof, cutoff - 1), /締切前/);
  assert.throws(() => seal(input, { ...proof, asOf: cutoff - 1 }, cutoff), /復元点/);
  assert.throws(() => seal(bytes({ ...fixture, extra: 1 }), proof, cutoff), /SHA-256/);
  assert.throws(() => validateSource({ ...fixture, asOf: cutoff }, cutoff), /取得根拠/);
  assert.equal(validateSource(seal(input, proof, cutoff), cutoff), databaseURL);
  assert.throws(() => parseJson('confidential raw bytes'), { message: 'JSONの形式が不正です' });
});

test('preparation rejects both newer records and a pre-cutoff Daily completed after midnight', () => {
  for (const changed of [
    { ...fixture, studentProfiles: { student: { name: 'Test', createdAt: cutoff } } },
    { ...fixture, learningRecords: { student: { record: { createdAt: cutoff } } } },
    { ...fixture, learningRecords: { student: { record: { createdAt: cutoff - 1,
      dailyV1: true, dailyCompleted: true, finishedAt: cutoff } } } },
  ]) {
    const input = bytes(changed);
    assert.throws(() => seal(input, verified(input), cutoff + 1), /締切以降/);
  }
  const input = bytes(fixture);
  const sealed = seal(input, verified(input), cutoff + 1);
  const snapshot = buildSnapshot(sealed, { now: cutoff + 1, sourceHash: sourceHash(bytes(sealed)) });
  assert.equal(snapshot.students.student.seasonXp, 1);
  assert.equal(snapshot.metadata.count, 1);
});
