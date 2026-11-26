const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HEADERS, assembleTextbookMaster, readTextbookMaster, validateSelection } = require('../textbook-master.cjs');
const config = { STUDIO_MASTER_SPREADSHEET_ID:'sheet-mock-1234567890123',
 STUDIO_MASTER_READER_SERVICE_ACCOUNT:'reader@sample-project.iam.gserviceaccount.com' };
const selection = validateSelection({subject:'論表',lesson:'12 不定詞(1)',part:'Part 1'});
const row = (id,number,english,extra={})=>[id,extra.subject||'論表',extra.lesson||'12 不定詞(1)',extra.part||'1',number,english,'非公開の和訳','メモ','対象','備考'];

test('sorts numeric sentence numbers, filters exactly, and returns only English', () => {
 const result=assembleTextbookMaster([HEADERS,row('b',10,'Last.'),row('ignored',1,'Other.',{part:'2'}),
  row('ignored',1,'Other.',{subject:'英C'}),row('a',2,'First.')],selection);
 assert.deepEqual(result,{source:'First.\nLast.',sentenceCount:2});
});

test('rejects invalid selection, missing rows, header changes, duplicate and invalid values', () => {
 const fails = (values,status) => assert.throws(()=>assembleTextbookMaster(values,selection),{status});
 assert.throws(()=>validateSelection({subject:'論表',lesson:'12',part:'Part'}),{status:400});
 fails([HEADERS,row('no',1,'Other.',{lesson:'12'})],404);
 fails([[...HEADERS,'別の列']],422);
 fails([[...HEADERS].reverse(),row('a',1,'First.')],422);
 fails([HEADERS,row('a',1,'First.'),row('a',2,'Second.')],422);
 fails([HEADERS,row('a',1,'First.'),row('b','01','Second.')],422);
 for(const number of [0,-1,'2.1','1e2','',Number.MAX_SAFE_INTEGER+1])fails([HEADERS,row('a',number,'Text')],422);
 fails([HEADERS,row('a',1,'')],422);
 fails([HEADERS,row('a',1,'a'.repeat(20001))],422);
});

test('no permission or an unconfigured connector fails without returning provider output or tokens', async () => {
 let calls=0;
 const getRuntimeToken=async()=>{calls++;return 'runtime';};
 await assert.rejects(readTextbookMaster(selection,{config:{},getRuntimeToken}),{status:503});
 assert.equal(calls,0);
 for(const status of [401,403,404]){
  await assert.rejects(readTextbookMaster(selection,{config,getRuntimeToken,fetcher:async url=>
   url.includes('iamcredentials')?new Response('{"accessToken":"test"}'):new Response('private provider text',{status})}),
  {status:502,message:'本文マスターのシート名または閲覧権限を確認してください'});
 }
 await assert.rejects(readTextbookMaster(selection,{config,getRuntimeToken:async()=>{
  throw Object.assign(Error('private credentials'),{status:502});
 }}),{status:502,message:'教科書本文マスターの読み取りに失敗しました'});
});
