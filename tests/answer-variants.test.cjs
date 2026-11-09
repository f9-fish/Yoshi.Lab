const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {context,read,functionFromLine,dailyHarness}=require('./helpers/app-harness.cjs');
const core=context().YoshiAnswers;
const sentence="I’m not so hungry. I don’t (feel) (like) (having) the steak.";
const alternate="I’m not so hungry. I don’t (feel) (like) (eating) the steak.";
for(const separator of ['\n','\r\n','<br>','<br/>','<BR />','\\n','\\r\\n']){
 test(`cell alternatives split ${JSON.stringify(separator)} and preserve one question`,()=>{
  const source=sentence+separator+alternate+separator+sentence;
  assert.equal(core.lines(source).length,2);
  assert.equal(core.primary(source),sentence);
  assert.equal(core.clozeMatch(['feel','like','having'],source),true);
  assert.equal(core.clozeMatch(['feel','like','eating'],source),true);
 });
}
test('three or more registered word alternatives accept each, not their concatenation',()=>{
 for(const word of ['attract','charm','fascinate'])assert.equal(core.wordMatches(word,'attract\ncharm\nfascinate'),true);
 assert.equal(core.wordMatches('attract charm','attract\ncharm'),false);
 assert.equal(core.wordMatches('appeal','attract\ncharm'),false);
 assert.equal(core.wordMatches('to be honest','to tell the truth<br>to be honest'),true);
 assert.equal(core.wordMatches('honest','to tell the truth<br>to be honest'),false);
});
test('normalization handles whitespace, apostrophes and invisible spreadsheet characters',()=>{
 assert.equal(core.wordMatches(" DON’T ",'have\n\u200bdon’t\u200b'),true);
 assert.deepEqual(Array.from(core.lines(' \n\u200b\n charm \n charm \n')),['charm']);
 assert.equal(core.primary('rock and/or roll'),'rock and/or roll');
 assert.equal(core.wordMatches('begin','start'),false,'no new inferred synonyms');
});
test('cloze alternatives are whole registered rows, not per-slot combinations',()=>{
 const source='I (have) (a) (rest).\nI (take) (some) (time).\nI (enjoy) (my) (break).';
 for(const values of [['have','a','rest'],['take','some','time'],['enjoy','my','break']])assert.equal(core.clozeMatch(values,source),true);
 for(const values of [['have','some','time'],['take','a','rest'],['enjoy','some','break']])assert.equal(core.clozeMatch(values,source),false);
 assert.equal(core.clozeMatch(['have','',''],source),null);
 assert.equal(core.clozeMatch([],source),null);
});
test('phrases with differing word/blank counts can be entered together without extra questions',()=>{
 const source='I (decided) (to) (go).\nI (opted to go).';
 assert.equal(core.clozeMatch(['opted to go','',''],source),true);
 assert.equal(core.clozeMatch(['decided','to','go'],source),true);
 assert.equal(core.clozeMatch(['opted','to','stay'],source),false);
 assert.equal(core.clozeMatch(['','',''],source),null);
});
function node(tag='div'){
 const classes=new Set();
 return {tag,children:[],dataset:{},value:'',className:'',style:{setProperty(){}},
  append(...items){for(const item of items){item.parentElement=this;this.children.push(item)}},
  appendChild(item){this.append(item)},replaceChildren(){this.children=[]},
  setAttribute(){},addEventListener(){},focus(){},
  classList:{add:c=>classes.add(c),contains:c=>classes.has(c)},
  querySelectorAll(selector){const result=[];for(const child of this.children){if(selector.startsWith('.')&&child.className?.split(' ').includes(selector.slice(1)))result.push(child);if(child.querySelectorAll)result.push(...child.querySelectorAll(selector))}return result;},
  querySelector(s){return this.querySelectorAll(s)[0]||null},
 };
}
for(const file of ['index.html','pair.html'])test(`${file}: display only the first sentence, accept every alternate in inline fields`,()=>{
 const document={createElement:node,createTextNode:text=>({textContent:text})};
 const make=functionFromLine(file,'makeClozeInlineInputs',{document});
 const check=functionFromLine(file,'checkClozeInlineInputs',{normalizeYoshiAnswer:v=>String(v).toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim()});
 const root=node(),source=sentence+'<br>'+alternate;
 const fields=make(root,source,'test');assert.equal(fields.length,3,'not six duplicated blanks');
 for(const ending of ['having','eating']){
  ['feel','like',ending].forEach((value,i)=>fields[i].value=value);
  assert.equal(check(root),true);
 }
 fields[2].value='ordering';assert.equal(check(root),false);
 fields[2].value='';assert.equal(check(root),null);
 const single=node();assert.equal(make(single,'I (would like) tea.','test').length,2,'legacy per-word layout unchanged');
 const phrase=node();const phraseFields=make(phrase,'I (feel like having) tea.\nI (feel like drinking) tea.','test');
 assert.equal(phraseFields.length,1);phraseFields[0].value='feel like drinking';assert.equal(check(phrase),true);
});
for(const [type,source,answer] of [
 ['word','attract\ncharm','charm'],
 ['word','attract<br>charm<br>fascinate','fascinate'],
 ['sentence',sentence+'\n'+alternate,['feel','like','eating']],
])test(`Daily ${type}: alternate is correct once, without duplicate score on repeated submit`,async()=>{
 const h=dailyHarness();await h.ready();await h.evaluate('start()');
 h.sandbox.source=source;h.sandbox.response=answer;
 h.evaluate(type==='word'?"deck[0]=makeQuestion('word',{word:source,meaning:'和訳'},'fixture')":"deck[0]=makeQuestion('sentence',{english:source,japanese:'和訳'},'fixture')");
 if(type==='sentence')assert.equal(h.evaluate('deck[0].blankCount'),3);
 h.evaluate('select(response);select(response)');
 assert.equal(h.evaluate('answers.length'),1);
 assert.equal(h.evaluate('answers[0].ok'),true);
 assert.equal(h.evaluate('answers[0].prompt.includes("eating")'),false);
 // Finish a normal ten-question run; aliases must not change the Daily XP table.
 h.evaluate("answers=[answers[0],...Array.from({length:9},()=>({ok:true}))];index=9");
 await h.evaluate('next()');
 const rows=await h.api.records();assert.equal(rows.length,1);assert.equal(rows[0].right,10);assert.equal(rows[0].dailyDeltaXP,500);
});
test('all consumers load the shared parser before their application script',()=>{
 for(const file of ['index.html','daily.html','pair.html']){
  const html=read(file),parser=html.indexOf('src="./answer-variants.js?v=1"');
  const app=html.indexOf(file==='pair.html'?'<script type="module">':file==='daily.html'?'const dailyXP=':'const $=id=>');
  assert.ok(parser>=0&&parser<app,file);
 }
});

for(const typed of ['attract','charm','fascinate','wrong'])test(`pair vocabulary submit grades registered alias ${typed} once`,async()=>{
 const source=read('pair.html').split('\n').find(line=>line.startsWith("$('pairTypingSubmit').onclick="));
 const handler=source.slice(source.indexOf('=')+1,source.indexOf(";$('pairTypingInput')"));
 const room={mode:'vocabTyping',state:{index:0}},nodes=new Map();let calls=0,judgment;
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 $('pairTypingInput').value=typed;
 const sandbox=context({room,side:'B',getCards:()=>[['attract\ncharm\nfascinate','魅了する']],pairAsker:()=> 'A',$,
  normalizeYoshiAnswer:v=>String(v).toLowerCase().trim(),grade:async ok=>{judgment=ok;calls++;room.reveal={index:0,ok};}});
 const submit=vm.runInContext('('+handler+')',sandbox);
 await submit();await submit();
 assert.equal(judgment,typed!=='wrong');assert.equal(calls,1);
});
