'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {REPO,FILE,blobSha,sha256,inspect,makeBackup,verifyBackup}=require('../scripts/studio-publication-audit.cjs');

test('audit uses the same trimmed subject, lesson and part identity as publication',()=>{
 const bytes=Buffer.from(JSON.stringify([{subject:'英C',id:'AUDIT',name:'1',
  questions:{vocabulary:[{question:'wave',answer:'波',translation:'海の波'}],cloze:[],qa:[],trueFalse:[],discussion:[]}}]));
 assert.deepEqual(inspect(bytes,{subject:'英C',lesson:' AUDIT ',part:'1'}),
  {groups:1,collision:true,existingQuestionCount:1});
 assert.deepEqual(inspect(bytes,{subject:'論表',lesson:'AUDIT',part:'1'}),
  {groups:1,collision:false,existingQuestionCount:0});
});

test('backup retains exact bytes, refuses overwrite, and detects tampering',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-audit-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const output=path.join(root,'backup');
 const bytes=Buffer.from('[]\n');
 const manifest={repository:REPO,file:FILE,mainCommit:'a'.repeat(40),fileSha:blobSha(bytes),sha256:sha256(bytes)};
 makeBackup(output,bytes,manifest);
 assert.deepEqual(verifyBackup(output),manifest);
 assert.throws(()=>makeBackup(output,bytes,manifest),{code:'EEXIST'});
 fs.writeFileSync(path.join(output,FILE),'[]');
 assert.throws(()=>verifyBackup(output),/一致しません/);
});
