'use strict';

const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {parseArgs}=require('node:util');
const {normalizedKey,normalizeContent,TYPES}=require('../studio-functions/studio-core.cjs');

const FILE='studio-content.json';
const REPO='https://github.com/f9-fish/Yoshi.Lab.git';
const git=(...args)=>execFileSync('git',args,{maxBuffer:15*1024*1024,stdio:['ignore','pipe','pipe']});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const blobSha=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

function inspect(bytes,slot) {
 const groups=normalizeContent(JSON.parse(bytes.toString('utf8')));
 const existing=groups.find(group=>normalizedKey(group)===normalizedKey(slot));
 return {groups:groups.length,collision:Boolean(existing),
  existingQuestionCount:existing?TYPES.reduce((total,type)=>total+(existing.questions[type]?.length||0),0):0};
}

function makeBackup(output,bytes,manifest) {
 fs.mkdirSync(output,{mode:0o700});
 fs.writeFileSync(path.join(output,FILE),bytes,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
}

function verifyBackup(output) {
 const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
 const bytes=fs.readFileSync(path.join(output,FILE));
 if(manifest.repository!==REPO||manifest.file!==FILE||!(/^[a-f0-9]{40}$/.test(manifest.mainCommit))||
    blobSha(bytes)!==manifest.fileSha||sha256(bytes)!==manifest.sha256)
  throw Error('バックアップの内容または照合値が一致しません');
 return manifest;
}

function main() {
 const {values}=parseArgs({options:{
  subject:{type:'string'},lesson:{type:'string'},part:{type:'string'},output:{type:'string'},verify:{type:'string'},
 }});
 if(values.verify){
  if(Object.keys(values).length!==1)throw Error('--verify は単独で指定してください');
  const {mainCommit,fileSha}=verifyBackup(values.verify);
  console.log(JSON.stringify({backupVerified:true,mainCommit,fileSha}));
  return;
 }
 const {subject,lesson,part,output}=values;
 if(!['英C','論表'].includes(subject)||!lesson?.trim()||lesson.trim().length>80||!part?.trim()||part.trim().length>30||!output)
  throw Error('--subject、--lesson、--part、--output を指定してください');
 const slot={subject,lesson:lesson.trim(),part:part.trim()};
 git('fetch','--quiet','--no-tags',REPO,'refs/heads/main');
 const mainCommit=git('rev-parse','FETCH_HEAD^{commit}').toString().trim();
 const spec=mainCommit+':'+FILE;
 const fileSha=git('rev-parse',spec).toString().trim();
 const bytes=git('show',spec);
 if(blobSha(bytes)!==fileSha)throw Error('Git blob SHA と取得バイトが一致しません');
 const result=inspect(bytes,slot);
 const manifest={repository:REPO,file:FILE,mainCommit,fileSha,sha256:sha256(bytes),
  backedUpAt:new Date().toISOString(),slot,...result};
 makeBackup(output,bytes,manifest);
 verifyBackup(output);
 console.log(JSON.stringify({mainCommit,fileSha,...result,backupVerified:true}));
 if(result.collision)process.exitCode=2;
}

if(require.main===module){
 try{main()}catch(error){
  console.error(error.status||error.code?'監査に失敗しました。Git接続と出力先を確認してください':error.message);
  process.exitCode=1;
 }
}

module.exports={REPO,FILE,blobSha,sha256,inspect,makeBackup,verifyBackup};
