'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {TYPES,checkInput,checkQuestions,normalizeContent,normalizedKey}=require('../studio-core.cjs');
const input={subject:'英C',lesson:'8',part:'1',source:'I visited Kyoto yesterday.',count:4};
function sample(){
 return {vocabulary:[{question:'visited',answer:'訪れた',translation:'visit の過去形'}],
 cloze:[{question:'I (visited) Kyoto yesterday.',answer:'私は昨日京都を訪れた。',translation:'過去形'}],
 qa:[{question:'Where did I go?',answer:'Kyoto.',translation:'私はどこへ行きましたか？'}],
 trueFalse:[{question:'I visited Kyoto.',answer:'True',translation:'私は京都を訪れた。本文に一致'}],
 discussion:[{question:'Where do you want to go?',answer:'I want to go to Kyoto.',translation:'どこへ行きたいですか？'}]};
}
test('五種類すべてを正常に受け付ける',()=>{const q=checkQuestions(sample());assert.deepEqual(Object.keys(q),TYPES);assert.equal(q.qa.length,1)});
test('教科・教材番号・本文を検証する',()=>{assert.deepEqual(checkInput(input),input);assert.throws(()=>checkInput({...input,subject:'数学'}));assert.throws(()=>checkInput({...input,source:''}));assert.throws(()=>checkInput({...input,count:16}))});
test('翻訳欠落を拒否する',()=>{const q=sample();q.qa[0].translation='';assert.throws(()=>checkQuestions(q),/問題・解答・訳/)});
test('重複した問題を拒否する',()=>{const q=sample();q.qa.push({...q.qa[0]});assert.throws(()=>checkQuestions(q),/重複/)});
test('True Falseの解答を検証する',()=>{const q=sample();q.trueFalse[0].answer='Maybe';assert.throws(()=>checkQuestions(q),/TrueまたはFalse/)});
test('穴埋めの括弧を検証する',()=>{const q=sample();q.cloze[0].question='I visited Kyoto.';assert.throws(()=>checkQuestions(q),/穴埋め/)});
test('5種類すべての形式が必要',()=>{const q=sample();delete q.discussion;assert.throws(()=>checkQuestions(q),/問題配列/)});
test('公開後は選択した種類だけ採用できる',()=>{const q=sample();q.qa=[];q.trueFalse=[];assert.equal(checkQuestions(q,{allowEmpty:true}).qa.length,0)});
test('同一科目・Lesson・Partを衝突として拒否',()=>{let a={subject:'英C',id:'8',name:'1',questions:sample()};let b={...a,questions:sample()};assert.throws(()=>normalizeContent([a,b]),/重複/)});
test('別科目の同名Lessonは共存できる',()=>{let a={subject:'英C',id:'8',name:'1',questions:sample()};let b={...a,subject:'論表'};assert.equal(normalizeContent([a,b]).length,2)});
test('新旧キーの同一性を保つ',()=>{assert.equal(normalizedKey({subject:'英C',id:'8',name:'1'}),normalizedKey(input))});
test('内容は新旧の入力順によらず規則的に整列',()=>{const a={subject:'英C',id:'10',name:'1',questions:sample()};const b={subject:'英C',id:'2',name:'1',questions:sample()};assert.equal(normalizeContent([a,b])[0].id,'2')});
