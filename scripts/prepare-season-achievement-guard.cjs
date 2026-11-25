'use strict';

const { readFileSync } = require('node:fs');
const { cutoff, sourceHash } = require('./season-achievements.cjs');
const { parseJson } = require('./season-achievement-source.cjs');
const { writePrivateOnce } = require('./season-achievement-cutoff.cjs');

const guardedPaths = ['studentProfiles', 'learningRecords'];
const guardStart = cutoff - 60_000;
const guardEnd = cutoff + 120_000;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFalse = value => value === false || (typeof value === 'string' && value.trim() === 'false');

function prepareGuard(input, { start = guardStart, end = guardEnd, boundary = cutoff } = {}) {
  if (![start, end, boundary].every(Number.isSafeInteger) || start >= boundary || end <= boundary) {
    throw Error('停止期間は締切をまたいでください');
  }
  if (!isObject(input?.rules)) throw Error('現在のRTDB RulesのJSONが必要です');
  const output = structuredClone(input);
  const root = output.rules;
  if ((Object.hasOwn(root, '.write') && !isFalse(root['.write'])) ||
      Object.keys(root).some(key => key.startsWith('$'))) {
    throw Error('ルートに書き込みを許可する可能性があるため、適用できません');
  }

  const condition = '(now < ' + start + ' || now >= ' + end + ')';
  function guardWrites(node) {
    if (!isObject(node)) throw Error('書き込みルールの形式が不正です');
    let count = 0;
    if (Object.hasOwn(node, '.write') && !isFalse(node['.write'])) {
      const rule = node['.write'];
      if (rule !== true && (typeof rule !== 'string' || !rule.trim())) throw Error('既存の.writeが不正です');
      node['.write'] = condition + ' && (' + rule + ')';
      count++;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith('.')) count += guardWrites(child);
    }
    return count;
  }
  for (const path of guardedPaths) {
    if (!guardWrites(root[path])) throw Error(path + ' に保護対象の書き込みルールがありません');
  }
  return output;
}

if (require.main === module) {
  try {
    const [, , input, output, ...extra] = process.argv;
    if (!input || !output || extra.length) throw Error('現行Rulesの入力とレビュー用の出力を指定してください');
    if (Date.now() >= guardStart) throw Error('締切直前または締切後のRules案生成は行えません');
    const raw = readFileSync(input);
    const guarded = JSON.stringify(prepareGuard(parseJson(raw)), null, 2) + '\n';
    writePrivateOnce(output, guarded);
    console.log(JSON.stringify({ status: 'review-only', guardStart, guardEnd,
      inputSha256: sourceHash(raw), proposedSha256: sourceHash(guarded) }));
  } catch (error) {
    console.error('Rules案を生成できませんでした。', error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareGuard, guardStart, guardEnd };
