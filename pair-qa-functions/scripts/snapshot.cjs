'use strict';
const fs=require('node:fs'),path=require('node:path'),core=require('../core.cjs');
const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../pair_text_qa.json'),'utf8'));
const rows=core.parseQuestions(raw),expected=core.catalog(rows),actual=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../pair_text_qa_catalog.json'),'utf8'));
if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Q&A本文と目録が一致しません。両方のJSONを同期してください');
fs.writeFileSync(path.resolve(__dirname,'../data/questions.json'),JSON.stringify(rows,null,2)+'\n');
console.log('Validated QA snapshot: '+rows.length+' questions');
