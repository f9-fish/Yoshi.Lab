const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../pair-qa-spark-core.js'),server=require('../pair-qa-functions/core.cjs'),{inflate,pack,factory}=require('../pair-qa-spark.js');
const rows=server.parseQuestions(require('../pair_text_qa.json'));
for(const part of ['1','2','3','PUS'])for(const rotation of ['half','one','two'])test(`Spark: Lesson 7 ${part}, ${rotation} keeps the existing roles, hints, grading and scores`,()=>{
 const selected=rows.filter(q=>q.part===part);assert.equal(selected.length,part==='PUS'?6:5);
 let reference=server.createRoom({code:'012345',uid:'a',lesson:'7',part,duration:0,expectedVersion:server.version(selected)},rows,1000);
 const {questions,...raw}=reference;let room=inflate({...raw,count:selected.length,hintMasks:selected.map(q=>(q.hints[0]?1:0)+(q.hints[1]?2:0)).join(''),ready:true,version:server.version(selected)});
 const step=(uid,action,data={},time=2000)=>{reference=server.act(reference,uid,action,data,time);room=core.act(room,uid,action,data,time);assert.deepEqual(room.state,reference.state);assert.equal(core.asker(room),server.asker(reference));assert.equal(room.revision,reference.revision);assert.deepEqual(room.reveal,reference.reveal);room=inflate(pack(room,action));};
 step('b','join');step('a','rotation',{rotation});step('a','start');
 for(let index=0;index<selected.length;index++){
  const asker=core.asker(room)==='A'?'a':'b',answerer=asker==='a'?'b':'a';assert.equal(core.view(room,answerer,2000).question,undefined);
  assert.throws(()=>core.act(room,answerer,'answer-open',{index},2000));
  if(selected[index].hints.some(Boolean)){step(answerer,'hint-request',{index});step(asker,'hint-next',{index});}
  step(asker,'answer-open',{index});step(asker,'grade',{index,ok:index%2===0});assert.throws(()=>core.act(room,answerer,'next',{index},2000));step(asker,'next',{index});assert.throws(()=>core.act(room,asker,'next',{index},2000));
 }
 assert.equal(room.state.total,selected.length);assert.equal(room.state.right,Math.ceil(selected.length/2));
});
test('Spark: old index, missing membership, expired room and timeout match the original state machine',()=>{
 const selected=rows.filter(q=>q.part==='1');let r=server.createRoom({code:'012345',uid:'a',lesson:'7',part:'1',duration:10,expectedVersion:server.version(selected)},rows,1000);
 r=core.act(r,'b','join',{},1000);r=core.act(r,'a','rotation',{rotation:'one'},1000);r=core.act(r,'a','start',{},1000);
 assert.throws(()=>core.act(r,'x','get',{},2000));assert.throws(()=>core.act(r,'a','get',{},10801001));assert.throws(()=>core.act(r,'a','grade',{index:1,ok:true},2000));
 const timed=core.act(r,'b','get',{},11000);assert.deepEqual(timed.reveal,{index:0,ok:false,timeout:true});assert.equal(timed.revision,r.revision+1);
});
test('Spark: frozen snapshot has no full question/answer in room state',()=>{const r=inflate({count:2,hintMasks:'13'});assert.deepEqual(r.questions[0].hints,['hint','']);assert.deepEqual(r.questions[1].hints,['hint','hint']);assert.equal(pack(r,'get').questions,undefined);});
test('Spark: config stays disabled until Rules are reviewed; Functions implementation retained',()=>{const config=fs.readFileSync(require.resolve('../pair-qa-config.js'),'utf8');assert.match(config,/enabled:false/);assert.match(config,/backend:'spark'/);assert.ok(fs.existsSync(require.resolve('../pair-qa-functions/index.cjs')));const html=fs.readFileSync(require.resolve('../pair.html'),'utf8');assert.ok(html.indexOf('pair-qa-spark-core.js')<html.indexOf('pair-qa-spark.js'));assert.ok(html.indexOf('pair-qa-spark.js')<html.indexOf('pair-qa-client.js'));});
