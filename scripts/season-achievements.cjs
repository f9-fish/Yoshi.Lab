'use strict';

require('../practice-xp.js');
const { forEachEarned } = require('../learning-xp.js');
const { bonuses, today } = require('../weekly-daily.js');
const { get, standings } = require('../yoshi-ranks-v14.js');
const { createHash } = require('node:crypto');

const seasonId = '2026-S3';
const start = Date.parse('2026-10-01T00:00:00+09:00');
const cutoff = Date.parse('2026-11-28T00:00:00+09:00');
const path = 'seasonAchievements/' + seasonId;
const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Radiant'];
const validUid = uid => /^[^.#$\[\]/\x00-\x1f\x7f]+$/.test(uid) && !['__proto__', 'constructor', 'prototype'].includes(uid);

function makeBadge(tier, position) {
  if (tier === 'Radiant' && position >= 1 && position <= 10) {
    return { badgeType: 'radiant_top10', badgeLabel: 'TOP 10 RADIANT #' + position };
  }
  return { badgeType: 'season_record', badgeLabel: 'SEASON 1 ' + tier };
}

function summarize(records) {
  // Daily is assigned to its original attempt date by live XP. A finish at or
  // after the cutoff must not turn an unfinished attempt into a final result.
  const rows = Object.values(records || {}).filter(row => row && Number(row.createdAt) < cutoff &&
    (row.dailyV1 !== true || row.dailyCompleted !== true || row.finishedAt == null ||
      Number(row.finishedAt) < cutoff));
  const days = new Set();
  let xp = 0;
  forEachEarned(rows, (row, earned) => {
    const ts = Number(row.createdAt);
    if (ts < start || (row.dailyV1 === true && row.dailyCompleted !== true)) return;
    xp += earned;
    days.add(today(ts));
  });
  for (const bonus of bonuses(rows, cutoff - 1)) {
    if (bonus.earnedAt >= start && bonus.earnedAt < cutoff) xp += bonus.xp;
  }
  return { seasonXp: Math.min(xp, 99999999), studyDays: days.size };
}

function buildSnapshot(source, { now = Date.now(), sourceHash } = {}) {
  if (!Number.isFinite(now) || now < cutoff) throw Error('終了時刻より前には確定できません');
  if (source.asOf !== cutoff || !/^[a-f0-9]{64}$/.test(sourceHash || '')) {
    throw Error('締切時点のエクスポートとSHA-256が必要です');
  }
  const { studentProfiles, learningRecords } = source;
  if (!studentProfiles || typeof studentProfiles !== 'object' || Array.isArray(studentProfiles) ||
      !learningRecords || typeof learningRecords !== 'object' || Array.isArray(learningRecords)) {
    throw Error('studentProfiles と learningRecords が必要です');
  }
  const summaries = new Map();
  const roster = Object.create(null);
  for (const [uid, profile] of Object.entries(studentProfiles)) {
    if (!validUid(uid) || !profile || typeof profile.name !== 'string' || !profile.name.trim()) {
      throw Error('不正なプロフィールがあります');
    }
    if (Number(profile.createdAt) >= cutoff) continue;
    const summary = summarize(learningRecords[uid]);
    summaries.set(uid, summary);
    roster[uid] = { name: profile.name.trim(), seasonId, seasonXP: summary.seasonXp };
  }
  if (!summaries.size) throw Error('対象のプロフィールがありません');
  const students = Object.create(null);
  const badges = Object.create(null);
  const top10 = Object.create(null);
  for (const [index, row] of standings(roster, { id: seasonId }).entries()) {
    const finalPosition = index + 1;
    const finalRankTier = tiers[get(row.seasonXP, index).tier];
    const badge = makeBadge(finalRankTier, finalPosition);
    students[row.id] = { seasonId, finalRankTier, highestRankTier: 'unknown', finalPosition,
      ...summaries.get(row.id), ...badge, createdAt: now };
    badges[row.id] = { finalRankTier, ...badge, ...(badge.badgeType === 'radiant_top10' ? { finalPosition } : {}) };
    if (finalPosition <= 10) top10[finalPosition] = { name: row.name, finalPosition, ...badges[row.id] };
  }
  return { metadata: { seasonId, cutoff, sourceHash, count: summaries.size, createdAt: now, schemaVersion: 1,
    locale: Intl.Collator().resolvedOptions().locale }, students, ranking: { badges, top10 } };
}

function sourceHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function publishOnce(ref, snapshot) {
  // One RTDB transaction covers private records, display data and audit metadata.
  // Admin SDK has no optimistic UI; a retry after lost acknowledgement reads the winner.
  const result = await ref.transaction(existing => existing === null ? snapshot : undefined);
  const metadata = result.snapshot.val()?.metadata;
  for (const key of ['seasonId', 'sourceHash', 'schemaVersion', 'count', 'locale']) {
    if (metadata?.[key] !== snapshot.metadata[key]) throw Error('別の確定結果が存在します。既存データを保護しました');
  }
  return { status: result.committed ? 'published' : 'already-published', ...metadata };
}

module.exports = { buildSnapshot, cutoff, makeBadge, path, publishOnce, sourceHash };
