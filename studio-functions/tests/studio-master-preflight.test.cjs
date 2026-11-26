const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preflight, selectRevision } = require('../../scripts/studio-master-preflight.cjs');

const name='studioapi-revision-1';
const runtime='runtime@sample-project.iam.gserviceaccount.com';
const reader='reader@sample-reader-project.iam.gserviceaccount.com';
const sheet='private-sheet-123456789';

function setup({ missing=false, api=true, denied=false, noActAs=false, binding=true }={}) {
 const calls=[], reports=[];
 const ops={
  service:async()=>({status:{traffic:[{revisionName:name,percent:100}]}}),
  revision:async revision=>{
   assert.equal(revision,name);
   return {metadata:{name},spec:{serviceAccountName:runtime,containers:[{env:missing?[]:[
    {name:'STUDIO_MASTER_READER_SERVICE_ACCOUNT',value:reader},
    {name:'STUDIO_MASTER_SPREADSHEET_ID',value:sheet},
    {name:'PRIVATE',value:'secret-env-value'},
   ]}]}};
  },
  apiEnabled:async(project,apiName)=>{calls.push([project,apiName]);return api;},
  readerPolicy:async account=>{
   if(account!==reader)throw Error('unexpected account');
   calls.push(['read-policy']);
   return {bindings:binding?[{role:'roles/iam.serviceAccountTokenCreator',members:['serviceAccount:'+runtime]}]:[]};
  },
  runtimeToken:async account=>{
   calls.push(['runtime-identity',account]);
   if(noActAs)throw Error('代理できません');
   return 'runtime-token';
  },
  checkHeader:async({ config,getRuntimeToken })=>{
   calls.push(['header']);
   assert.equal(config.STUDIO_MASTER_SPREADSHEET_ID,sheet);
   assert.equal(await getRuntimeToken(),'runtime-token');
   if(denied)throw Object.assign(Error('閲覧権限を確認してください'),{status:502});
  },
 };
 return {calls,reports,run:candidate=>preflight(ops,entry=>reports.push(entry),candidate)};
}

test('unconfigured or disabled API stops before attempting impersonation or accessing Sheets',async()=>{
 for(const fixture of [{missing:true},{api:false}]){
  const h=setup(fixture);
  await assert.rejects(h.run(),/未設定|無効/);
  assert.equal(h.calls.some(([method])=>method==='runtime-identity'||method==='header'),false);
  assert.equal(h.reports[0].runtimeServiceAccount,runtime);
  assert.equal(h.reports.some(report=>report.stage==='ready'),false);
 }
});
test('successful check uses effective identity and never prints tokens, reader identity, or the sheet ID',async()=>{
 const h=setup();
 await h.run();
 assert.deepEqual(h.calls,[
  ['yoshi-lab-db3eb','iamcredentials.googleapis.com'],
  ['sample-reader-project','sheets.googleapis.com'],
  ['read-policy'],['runtime-identity',runtime],['header'],
 ]);
 assert.deepEqual(h.reports.at(-1),{stage:'ready',readOnlyHeaderVerified:true,dataRowsRead:false,deployedSettingsVerified:true});
 assert.doesNotMatch(JSON.stringify(h.reports),/private-sheet|runtime-token|secret-env-value|reader@/);
});
test('operator impersonation failure and missing sheet permission both stop without readiness result',async()=>{
 for(const fixture of [{denied:true},{noActAs:true}]){
  const h=setup(fixture);
  await assert.rejects(h.run(),/閲覧権限|代理/);
  assert.equal(h.reports.some(report=>report.stage==='ready'),false);
 }
});
test('does not choose an arbitrary revision when traffic is split',()=>{
 assert.throws(()=>selectRevision({status:{traffic:[{revisionName:name,percent:80},{revisionName:'studioapi-old',percent:20}]}}),/単一/);
});

test('candidate reader verifies the already-granted direct policy without touching the sheet',async()=>{
 const h=setup({missing:true});
 await assert.rejects(h.run({reader}),/対象シートが未設定/);
 assert.deepEqual(h.reports.at(-1),{stage:'reader-iam',directTokenCreatorBindingPresent:true});
 assert.equal(h.calls.some(([method])=>method==='runtime-identity'||method==='header'),false);
});
test('missing direct binding reports false and requests no credentials',async()=>{
 const h=setup({binding:false});
 await assert.rejects(h.run(),/直接付与/);
 assert.deepEqual(h.reports.at(-1),{stage:'reader-iam',directTokenCreatorBindingPresent:false});
 assert.equal(h.calls.some(([method])=>method==='runtime-identity'),false);
});
test('candidate sheet and reader can verify permission before deployment without implying active settings',async()=>{
 const h=setup({missing:true});
 await h.run({reader,sheetId:sheet});
 assert.equal(h.reports.at(-1).deployedSettingsVerified,false);
 assert.doesNotMatch(JSON.stringify(h.reports),/private-sheet|runtime-token/);
});
