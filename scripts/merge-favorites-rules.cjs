'use strict';

const fs = require('node:fs');
const proposal = require('../firebase-favorites.rules.proposed.json').rules.questionFavorites;
const hasOwn = (object, key) => Object.hasOwn(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const denies = value => value === false || (typeof value === 'string' && value.trim() === 'false');

function merge(existing) {
 if (!isObject(existing) || !isObject(existing.rules)) throw Error('Realtime Database RulesのJSONを指定してください');
 const rules = existing.rules;
 for (const permission of ['.read', '.write']) {
  if (hasOwn(rules, permission) && !denies(rules[permission])) {
   throw Error('ルートの'+permission+'に包括的な許可の可能性があります。既存ルールを手動で確認してください');
  }
 }
 if (hasOwn(rules, 'questionFavorites')) throw Error('既存のquestionFavoritesルールがあります。手動で差分を確認してください');
 if (Object.keys(rules).some(key => key.startsWith('$'))) {
  throw Error('ルートにワイルドカードがあります。questionFavoritesへの継承を手動で確認してください');
 }
 return {...existing, rules:{...rules, questionFavorites:structuredClone(proposal)}};
}

if (require.main === module) {
 try {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('node scripts/merge-favorites-rules.cjs <現行Rules.json> <統合版.json>');
  const original = JSON.parse(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, JSON.stringify(merge(original), null, 2)+'\n', {flag:'wx', mode:0o600});
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}

module.exports = {merge};
