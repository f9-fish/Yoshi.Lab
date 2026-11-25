'use strict';

const { cutoff, sourceHash } = require('./season-achievements.cjs');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function databaseOrigin(value) {
  if (!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)\/?$/.test(value || '')) {
    throw Error('Realtime Database の HTTPS URL を指定してください');
  }
  return new URL(value).origin;
}

function extract(input) {
  if (!isObject(input?.studentProfiles) || !Object.hasOwn(input, 'learningRecords') ||
      (input.learningRecords !== null && !isObject(input.learningRecords))) {
    throw Error('同じスナップショットの studentProfiles と learningRecords が必要です');
  }
  return { studentProfiles: input.studentProfiles, learningRecords: input.learningRecords || {} };
}

async function capture({ databaseURL, readRoot, now = Date.now }) {
  const origin = databaseOrigin(databaseURL);
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < cutoff) throw Error('締切前に開始した取得は使えません');
  const source = await readRoot(origin);
  const finishedAt = now();
  if (!Number.isSafeInteger(finishedAt) || finishedAt < startedAt) throw Error('取得時刻を確認できません');
  // Retain only the two requested paths from the single atomic root read.
  return { capture: { databaseURL: origin, startedAt, finishedAt }, ...extract(source) };
}

const windowMs = 120_000;
const clockToleranceMs = 2_000;

function validateHttpTiming({ startedAt, finishedAt, httpDateAt }) {
  if (finishedAt >= cutoff + windowMs) throw Error('締切後の読み取り時間を超えました');
  if (!Number.isSafeInteger(httpDateAt) || httpDateAt < cutoff ||
      httpDateAt < startedAt - clockToleranceMs || httpDateAt > finishedAt + clockToleranceMs) {
    throw Error('RTDBのHTTP日時と端末時計を照合できません');
  }
}

function validateProvenance(provenance) {
  if (provenance?.version !== 1 || !/^[a-f0-9]{64}$/.test(provenance.inputSha256 || '') ||
      typeof provenance.reference !== 'string' || !provenance.reference.trim() || provenance.reference.length > 240) {
    throw Error('管理者が検証した取得根拠と入力のハッシュが必要です');
  }
  databaseOrigin(provenance.databaseURL);
  if (provenance.method === 'verified-cutoff') {
    if (provenance.asOf !== cutoff) throw Error('復元点が締切と一致しません');
    return;
  }
  const { startedAt, finishedAt, unchangedFrom, unchangedThrough, httpDateAt } = provenance;
  if (provenance.method !== 'unchanged-window' ||
      ![startedAt, finishedAt, unchangedFrom, unchangedThrough].every(Number.isSafeInteger) ||
      unchangedFrom >= cutoff || startedAt < cutoff || finishedAt < startedAt || unchangedThrough < finishedAt) {
    throw Error('締切をまたいで取得完了まで変更がなかった根拠が必要です');
  }
  if (httpDateAt !== undefined) validateHttpTiming({ startedAt, finishedAt, httpDateAt });
}

function rejectLaterData({ studentProfiles, learningRecords }) {
  for (const profile of Object.values(studentProfiles)) {
    if (Number(profile?.createdAt) >= cutoff) throw Error('締切以降のプロフィールが含まれています');
  }
  for (const records of Object.values(learningRecords)) {
    if (!isObject(records) && !Array.isArray(records)) throw Error('学習記録の形式が不正です');
    for (const row of Object.values(records)) {
      if (Number(row?.createdAt) >= cutoff || (row?.dailyV1 === true && Number(row.finishedAt) >= cutoff)) {
        throw Error('締切以降の学習記録またはDaily完了が含まれています');
      }
    }
  }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes); }
  catch { throw Error('JSONの形式が不正です'); }
}

function seal(inputBytes, evidence, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < cutoff) throw Error('締切前には確定用入力を作成できません');
  const input = parseJson(inputBytes);
  const inputSha256 = sourceHash(inputBytes);
  if (evidence?.inputSha256 !== inputSha256) throw Error('監査した入力とSHA-256が一致しません');
  const provenance = { version: 1, method: evidence.method, inputSha256,
    reference: evidence.reference, databaseURL: databaseOrigin(evidence.databaseURL) };
  if (evidence.method === 'verified-cutoff') {
    if (Object.hasOwn(input, 'capture')) throw Error('締切後の取得データは検証済み復元点として使えません');
    provenance.asOf = evidence.asOf;
  } else if (evidence.method === 'unchanged-window') {
    const captured = input.capture;
    if (!captured || databaseOrigin(captured.databaseURL) !== provenance.databaseURL) {
      throw Error('取得元と監査対象のデータベースが一致しません');
    }
    Object.assign(provenance, {
      startedAt: captured.startedAt, finishedAt: captured.finishedAt, httpDateAt: captured.httpDateAt,
      unchangedFrom: evidence.unchangedFrom, unchangedThrough: evidence.unchangedThrough,
    });
  }
  const source = { asOf: cutoff, provenance, ...extract(input) };
  validateSource(source, now);
  return source;
}

function validateSource(source, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < cutoff) throw Error('締切前には確定できません');
  if (source?.asOf !== cutoff) throw Error('締切時点の入力が必要です');
  validateProvenance(source.provenance);
  if (source.provenance.method === 'unchanged-window' && source.provenance.unchangedThrough > now) {
    throw Error('取得後に確認済みの監査期間を指定してください');
  }
  rejectLaterData(extract(source));
  return databaseOrigin(source.provenance.databaseURL);
}

module.exports = { capture, databaseOrigin, parseJson, rejectLaterData, seal, validateSource,
  validateHttpTiming, windowMs, clockToleranceMs };
