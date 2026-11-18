const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const data=file=>JSON.parse(read(file));
const load=()=>{
 const requested=[];
 const sandbox=vm.createContext({
  TextEncoder,crypto:webcrypto,
  fetch:async url=>{
   const file=url.slice(2);requested.push(file);
   return {ok:true,json:async()=>data(file)};
  }
 });
 for(const file of ['answer-variants.js','wordbook-data.js','eiken-training.js','writing-training.js','favorites-core.js','favorites-catalog.js']){
  vm.runInContext(read(file),sandbox,{filename:file});
 }
 return {Q:sandbox.YoshiFavoriteQuestions,catalog:sandbox.YoshiFavoriteCatalog,requested};
};

test('favorite keys ignore source order and separate distinct material and formats',async()=>{
 const {Q}=load();
 const a=Q.text('英C','textTyping','I ( go ).','私は行く。');
 const same=Q.text('英C','textTyping',' I ( go ). ','私は行く。\r\n');
 const check=Q.text('英C','cloze','I ( go ).','私は行く。');
 const rp=Q.text('論表','textTyping','I ( go ).','私は行く。');
 const keys=await Promise.all([a,same,check,rp].map(Q.key));
 assert.equal(keys[0],keys[1]);
 assert.equal(new Set(keys).size,3);
 assert.ok(keys.every(Q.validKey));
 assert.doesNotMatch(keys[0],/I \( go \)/);
});

test('the latest public catalog resolves references across teaching materials',async()=>{
 const {Q,catalog,requested}=load();
 const text=data('lessons.json')[0].cards[0],rp=data('ronpyo_text.json')[0].cards[0];
 const word=data('vocabulary.json')[0].words[0];
 const wb=data('wordbook.json').words.find(word=>word.examples.some(example=>example.reorder));
 const example=wb.examples.find(example=>example.reorder);
 const reorder={word:wb,prompt:example.japanese,answer:example.english,id:example.id};
 const writing=data('writing_questions.json').find(q=>q.status==='公開');
 const extension=data('extension_questions.json').find(q=>q.type==='True / False'&&q.status==='公開');
 const qa=data('pair_text_qa.json').find(q=>q.status==='公開');
 const eiken=data('eiken_2.json')[0];
 const references=[
  Q.text('英C','cloze',...text),Q.text('英C','textTyping',...text),Q.text('論表','textTyping',...rp),
  Q.word('英C','vocab',word.word,word.meaning),Q.word('英C','vocabTyping',word.word,word.meaning),
  Q.wordbook('reorder',reorder),Q.wordbook('spelling',{word:wb}),Q.wordbook('choice',{word:wb}),
  Q.ref('writing','writing',writing.id),Q.extension(extension),Q.ref('qa','qa',qa.id),Q.eiken(eiken.grade,eiken.id)
 ];
 const keys=await Promise.all(references.map(Q.key));
 assert.equal(await Q.key(Q.wordbook('reorder',{...reorder,id:'moved-example'})),keys[5]);
 const missing=await Q.key(Q.eiken('2級','removed'));
 const rows=await catalog.resolve([...keys,missing]);
 assert.equal(rows.filter(row=>row.item).length,keys.length);
 assert.equal(rows.at(-1).item,undefined);
 assert.equal(rows.at(-1).error,false);
 assert.equal(rows[3].item.judge([word.meaning]),true);
 assert.equal(rows[5].item.judge([example.english]),true);
 assert.equal(rows[11].item.judge([eiken.correctWord]),true);
 assert.equal(requested.filter(file=>file==='lessons.json').length,1);
 assert.ok(!requested.includes('studio-content.json'));
});
