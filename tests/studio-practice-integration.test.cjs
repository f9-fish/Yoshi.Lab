'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const practice=require('../studio-practice.js');
const writing=require('../writing-training.js');
const {additions,mergeQuestions,normalizedKey}=require('../studio-functions/studio-core.cjs');
const {prepareBatch}=require('../studio-functions/question-master.cjs');

const item=(question,answer='意味')=>({question,answer,translation:'説明'});
const questions={
 vocabulary:[item('coast')],idiom:[item('due to')],cloze:[item('It was (cold).','寒かった。')],
 qa:[item('Was it cold?','Yes, it was.')],discussion:[item('How do you feel?','I feel cold.')],trueFalse:[],
};
const published={subject:'英C',id:'Lesson 8',name:'Part 1',publishedAt:'2026-11-27T00:00:00Z',questions};

test('published formats map to existing practice and do not mix drafts, subjects or parts',()=>{
 const other={...published,subject:'論表',name:'2'};
 const [group,alternate]=practice.collect([
  {...published,publishedAt:undefined},published,{...published,id:'8',name:'1'},other,
 ]);
 assert.equal(group.id,'8');
 assert.equal(group.name,'1');
 assert.deepEqual(group.words,[{word:'coast',meaning:'意味',hint:'説明'},{word:'due to',meaning:'意味',hint:'説明'}]);
 assert.deepEqual(group.cards,[['It was (cold).','寒かった。\n説明']]);
 assert.equal(alternate.subject,'論表');
 assert.equal(alternate.name,'2');
 const [closed,open]=writing.questions(group.qa);
 assert.equal(writing.judge(closed,'YES, it was!').status,'correct');
 assert.equal(writing.judge(closed,'No, it was not.').status,'review');
 assert.equal(writing.judge(open,open.modelAnswer).status,'self-check');
 assert.equal(writing.judge(open,'I have a different opinion.').status,'self-check');
 assert.equal(writing.record(open,'A reason.',writing.judge(open,'A reason.'),[]).xp,0);
});

test('original passage is immutable and separate from the five reviewable question kinds',()=>{
 const body={batchId:'751fc4af-84a0-48b0-9981-79e998adf540',subject:'英C',lesson:'8',part:'1',count:1,
  source:'  Original passage.\r\n  Exact layout.  ',questions};
 const batch=prepareBatch(body,'teacher','2026-11-27T00:00:00Z');
 assert.equal(batch.rows.length,5);
 assert.ok(batch.rows.every(row=>row[10]==='要確認'&&row[7]!==body.source));
 assert.equal(batch.sourceRow[6],'source');
 assert.equal(batch.sourceRow[7],body.source);
 assert.notEqual(prepareBatch({...body,source:body.source.trim()},'teacher',batch.rows[0][12]).fingerprint,batch.fingerprint);
});

test('publication appends only new normalized prompts in the same slot',()=>{
 const existing={...published,questions:{...questions,vocabulary:[item('DUE TO','元の意味')],idiom:[]}};
 const incoming={...questions,idiom:[item(' due  to ','別の意味'),item('in spite of')]};
 const delta=additions(existing,incoming);
 assert.deepEqual(delta.idiom,[item('in spite of')]);
 assert.deepEqual(delta.qa,[]);
 assert.deepEqual(mergeQuestions(existing,delta).vocabulary,[item('DUE TO','元の意味'),item('coast')]);
 assert.equal(normalizedKey(published),normalizedKey({subject:'英C',lesson:'8',part:'1'}));
 assert.notEqual(normalizedKey(published),normalizedKey({subject:'論表',lesson:'8',part:'1'}));
});
