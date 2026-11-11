const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../pair-reading-tf.js'),source=require('../extension_questions.json');
const row=(patch={})=>({id:'TF-1',subject:'英C',lesson:'Lesson 8',part:'Part 1',type:'True / False',question:'A statement.',modelAnswer:'False',explanation:'Source evidence.',status:'公開',...patch});
test('pair TF reuses only public English Communication True/False rows from Reading Plus',()=>{
 const rows=core.parse(source),expected=source.filter(q=>q.status==='公開'&&q.subject==='英C'&&q.type==='True / False');assert.deepEqual(rows.map(q=>q.id),expected.map(q=>q.id));assert.ok(rows.every(q=>['True','False'].includes(q.modelAnswer)));const groups=core.entries(rows);assert.equal(groups.reduce((n,g)=>n+g.questions.length,0),rows.length);
});
test('pair TF excludes Discussion, private, invalid and duplicate rows; normalizes Lesson and Part safely',()=>{
 const rows=core.parse([row(),row(),row({id:'TF-2',subject:'論表'}),row({id:'TF-3',status:'非公開'}),row({id:'TF-4',type:'Discussion'}),row({id:'TF-5',modelAnswer:'yes'}),row({id:'TF-6',question:''}),row({id:'TF-7',part:'PUS',modelAnswer:' true '})]);assert.equal(rows.length,2);assert.equal(rows[0].lesson,'8');assert.equal(rows[0].part,'1');assert.equal(rows[1].modelAnswer,'True');assert.equal(core.entries(rows)[1].name,'PUS');assert.throws(()=>core.parse({}));assert.deepEqual(core.parse([]),[]);
});
test('pair TF frozen room set is independent from a later Reading Plus sync',()=>{
 const rows=core.parse([row(),row({id:'TF-2',question:'Another statement.',modelAnswer:'True'})]),snapshot=structuredClone(core.entries(rows)[0].questions);rows[0].question='Changed after sync';const cards=core.cards(snapshot);assert.deepEqual(cards,[['A statement.','False','Source evidence.'],['Another statement.','True','Source evidence.']]);assert.throws(()=>core.cards(Array(201).fill(row())));
});
test('pair getCards reads frozen TF questions while existing cloze and vocabulary branches still work',()=>{
 const html=fs.readFileSync(require.resolve('../pair.html'),'utf8'),line=html.split('\n').find(s=>s.startsWith('const getCards='));const sandbox={YoshiPairReadingTF:core,Array,catalog:()=>[{subject:'英C',id:'8',name:'1',text:[['A (word).','訳']],vocab:[['word','語']]}],normLesson:String,normPart:String,blank:s=>s.includes('('),vocabCards:g=>g.vocab};vm.runInNewContext(line+';this.cards=getCards;',sandbox);assert.equal(sandbox.cards({mode:'textTF',tfQuestions:[row()]}).length,1);assert.equal(sandbox.cards({mode:'cloze',subject:'英C',lesson:'8',part:'1'}).length,1);assert.equal(sandbox.cards({mode:'vocabChoice',subject:'英C',lesson:'8',part:'1'})[0][0],'word');
});
