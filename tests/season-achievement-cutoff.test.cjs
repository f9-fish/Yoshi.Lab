const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { captureAtCutoff, RetryableReadError, writePrivateOnce } = require('../scripts/season-achievement-cutoff.cjs');
const { cutoff, sourceHash } = require('../scripts/season-achievements.cjs');
const { seal } = require('../scripts/season-achievement-source.cjs');

const databaseURL = 'https://yoshi-lab-db3eb-default-rtdb.firebaseio.com';
const data = {
  studentProfiles: { user: { name: 'Sample', createdAt: cutoff - 1000 } },
  learningRecords: { user: { study: { createdAt: cutoff - 1 } } },
  unrelated: { private: true },
};

function clock(initial) {
  let now = initial, tick = 0;
  return {
    now: () => now,
    monotonic: () => tick,
    sleep: async ms => { now += ms; tick += ms; },
    shiftWall: ms => { now += ms; },
    reply: () => ({ data, date: new Date(now).toUTCString() }),
  };
}

test('waits without reading until midnight JST and records the HTTP date on a single successful read', async () => {
  const c = clock(cutoff - 1000);
  let reads = 0;
  const candidate = await captureAtCutoff({ databaseURL, ...c, readRoot: async (url, timeout) => {
    reads++;
    assert.equal(c.now(), cutoff);
    assert.equal(url, databaseURL);
    assert.equal(timeout, 30000);
    return c.reply();
  } });
  assert.equal(reads, 1);
  assert.equal(candidate.capture.httpDateAt, cutoff);
  assert.equal(candidate.capture.startedAt, cutoff);
  assert.equal(candidate.unrelated, undefined);
  const bytes = JSON.stringify(candidate);
  const proof = { method: 'unchanged-window', databaseURL, reference: 'fixture audit',
    inputSha256: sourceHash(bytes), unchangedFrom: cutoff - 20, unchangedThrough: cutoff + 1 };
  assert.throws(() => seal(bytes, undefined, cutoff + 1), /SHA-256/);
  assert.equal(seal(bytes, proof, cutoff + 1).provenance.httpDateAt, cutoff);
});

test('retries only transient errors, with no more than three reads and a finite deadline', async () => {
  let attempts = 0;
  const c = clock(cutoff);
  await captureAtCutoff({ databaseURL, ...c, readRoot: async () => {
    if (++attempts < 3) throw new RetryableReadError('transient');
    return c.reply();
  } });
  assert.equal(attempts, 3);
  assert.equal(c.now(), cutoff + 2000);

  attempts = 0;
  await assert.rejects(captureAtCutoff({ databaseURL, ...c, readRoot: async () => {
    attempts++;
    throw Error('HTTP 403');
  } }), /403/);
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(captureAtCutoff({ databaseURL, ...c, readRoot: async () => {
    attempts++;
    throw new RetryableReadError('offline');
  } }), /offline/);
  assert.equal(attempts, 3);

  const late = clock(cutoff + 119999);
  await assert.rejects(captureAtCutoff({ databaseURL, ...late, readRoot: async (_, timeout) => {
    assert.equal(timeout, 1);
    await late.sleep(1);
    return late.reply();
  } }), /読み取り時間/);
});

test('rejects early or missing HTTP dates, clock offsets or steps, and post-midnight changes', async () => {
  for (const date of [null, new Date(cutoff - 1000).toUTCString(), new Date(cutoff + 10000).toUTCString()]) {
    const c = clock(cutoff);
    await assert.rejects(captureAtCutoff({ databaseURL, ...c, readRoot: async () => ({ data, date }) }), /HTTP日時/);
  }
  const c = clock(cutoff);
  await assert.rejects(captureAtCutoff({ databaseURL, ...c, readRoot: async () => {
    c.shiftWall(5000);
    return c.reply();
  } }), /端末時計/);
  const d = clock(cutoff + 1000);
  await assert.rejects(captureAtCutoff({ databaseURL, ...d, readRoot: async () => ({
    ...d.reply(), data: { ...data, learningRecords: { user: { study: { createdAt: cutoff } } } },
  }) }), /締切以降/);

  await assert.rejects(captureAtCutoff({ databaseURL, ...clock(cutoff - 121000), readRoot: assert.fail }), /前後2分/);
});

test('publishes a private complete file once without replacing or leaving temporary files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'yoshi-cutoff-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'candidate.json');
  writePrivateOnce(path, 'original');
  assert.throws(() => writePrivateOnce(path, 'second'), { code: 'EEXIST' });
  assert.equal(readFileSync(path, 'utf8'), 'original');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['candidate.json']);
});
