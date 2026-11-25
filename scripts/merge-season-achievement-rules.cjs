'use strict';

const fs = require('node:fs');
const proposal = require('../firebase-season-achievements.rules.proposed.json').rules.seasonAchievements;

function merge(existing) {
  const rules = existing?.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw Error('現行Rulesが必要です');
  for (const permission of ['.read', '.write']) {
    if (Object.hasOwn(rules, permission) && rules[permission] !== false && rules[permission] !== 'false') {
      throw Error('ルートの包括的な許可を確認してください');
    }
  }
  if (Object.hasOwn(rules, 'seasonAchievements') || Object.keys(rules).some(key => key.startsWith('$'))) {
    throw Error('既存の実績ルールまたはルートのワイルドカードを確認してください');
  }
  return { ...existing, rules: { ...rules, seasonAchievements: structuredClone(proposal) } };
}

if (require.main === module) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw Error('現行Rulesと統合結果のパスを指定してください');
    const rules = merge(JSON.parse(fs.readFileSync(input, 'utf8')));
    fs.writeFileSync(output, JSON.stringify(rules, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { merge };
