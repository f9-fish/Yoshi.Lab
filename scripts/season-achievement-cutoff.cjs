'use strict';

const { linkSync, rmSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { cutoff } = require('./season-achievements.cjs');
const { capture, databaseOrigin, rejectLaterData, validateHttpTiming,
  windowMs, clockToleranceMs } = require('./season-achievement-source.cjs');

class RetryableReadError extends Error {}

async function captureAtCutoff({
  databaseURL, readRoot, now = Date.now, monotonic = () => performance.now(), sleep = delay,
}) {
  const origin = databaseOrigin(databaseURL);
  const boot = now();
  const bootTick = monotonic();
  if (boot < cutoff - windowMs || boot >= cutoff + windowMs) {
    throw Error('締切の前後2分以内に実行してください');
  }
  function clock() {
    const current = now();
    if (Math.abs((current - boot) - (monotonic() - bootTick)) > clockToleranceMs) {
      throw Error('取得中に端末時計が変化しました');
    }
    return current;
  }

  while (clock() < cutoff) await sleep(Math.min(1000, cutoff - clock()));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = cutoff + windowMs - clock();
    if (remaining <= 0) throw Error('締切後の読み取り時間を超えました');
    try {
      let responseTime;
      const result = await capture({ databaseURL: origin, now: clock, readRoot: async url => {
        const response = await readRoot(url, Math.min(30_000, remaining));
        responseTime = Date.parse(response.date);
        return response.data;
      } });
      result.capture.httpDateAt = responseTime;
      validateHttpTiming(result.capture);
      rejectLaterData(result);
      return result;
    } catch (error) {
      if (!(error instanceof RetryableReadError) || attempt === 3) throw error;
      await sleep(1000);
    }
  }
}

function writePrivateOnce(destination, bytes) {
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
    // Same-directory publication is atomic and cannot overwrite a previous capture.
    linkSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

module.exports = { captureAtCutoff, RetryableReadError, writePrivateOnce };
