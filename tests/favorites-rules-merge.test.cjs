const {test}=require('node:test');
const assert=require('node:assert/strict');
const {merge}=require('../scripts/merge-favorites-rules.cjs');
const fixture=require('../firebase-rtdb.rules.qa-integrated.json');
const favorites=require('../firebase-favorites.rules.proposed.json').rules.questionFavorites;

test('rules integration adds only questionFavorites and preserves input',()=>{
 const original=structuredClone(fixture);
 const result=merge(original);
 assert.deepEqual(result.rules.questionFavorites,favorites);
 delete result.rules.questionFavorites;
 assert.deepEqual(result,fixture);
 assert.deepEqual(original,fixture);
});

test('rules integration rejects an existing path or ambiguous inherited permissions',()=>{
 for(const rules of [
  {'questionFavorites':false},
  {'.read':true},
  {'.write':'auth != null'},
  {'$branch':{'.read':true}}
 ])assert.throws(()=>merge({rules}));
 assert.deepEqual(merge({rules:{}}).rules,{questionFavorites:favorites});
});
