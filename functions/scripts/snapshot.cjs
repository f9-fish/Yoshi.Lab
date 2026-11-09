'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const data=fs.readFileSync(path.join(root,'writing_questions.json'),'utf8');
// Reuse the current parser for deploy-time validation; no network or Firebase.
require(path.join(root,'writing-training.js')).questions(JSON.parse(data));
fs.mkdirSync(path.join(__dirname,'../data'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'../data/writing_questions.json'),data);
console.log('Validated writing question snapshot prepared.');
