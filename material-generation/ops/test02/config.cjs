'use strict';
const {TEST_ID}=require('../../phase4/test01.cjs');
const PROJECT='yoshi-lab-db3eb',SERVICE='yoshilab-material-test02',SA=SERVICE+'@'+PROJECT+'.iam.gserviceaccount.com',BUCKET=PROJECT+'-material-test02-jobs',SECRET='yoshilab-material-test01-gemini';
const PERMISSIONS=['firebaseauth.users.get','firebasedatabase.instances.get'];
function config(audience){if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(audience||''))throw Error('TEST02のaudienceが必要です');return {MG_MODE:'TEST',MG_ENABLED:'true',MG_PREFLIGHT_ENABLED:'false',MG_AUTH_VERIFIED:'true',MG_STORAGE_VERIFIED:'true',MG_PHASE4_SINGLE_JOB:'true',MG_PHASE4_ENVIRONMENT:'TEST02',MG_GENERATION_APPROVED:'false',MG_TEST_APPEND_ENABLED:'false',MG_MODEL_VERIFIED:'true',MG_COST_CONFIRMED:'true',MG_TEST_SPREADSHEET_ID:TEST_ID,MG_GOOGLE_AUDIENCE:audience,MG_STORE_BACKEND:'gcs',MG_GCS_BUCKET:BUCKET,MG_GEMINI_MODEL:'gemini-3.8-flash',MG_DAILY_LIMIT:'1',MG_BIND_HOST:'0.0.0.0'};}
function verify(kind,data,args=[]){
 if(kind==='bucket'){if(data.name!==BUCKET||data.labels?.purpose!=='material-test02'||data.public_access_prevention!=='enforced'||data.uniform_bucket_level_access!==true||data.retention_policy||data.lifecycle_config?.rule?.length||data.lifecycle?.rule?.length)throw Error('TEST02のバケット用途・非公開保護・保持設定が不一致です');}
 else if(kind==='project-iam'){if((data.bindings||[]).some(b=>b.members?.includes('serviceAccount:'+SA)&&b.role!=='projects/'+PROJECT+'/roles/yoshiLabMaterialTest02Reader'))throw Error('TEST02実行IDに想定外のプロジェクト権限があります');}
 else if(kind==='role'){if(data.deleted||data.stage==='DISABLED'||JSON.stringify([...data.includedPermissions||[]].sort())!==JSON.stringify([...PERMISSIONS].sort()))throw Error('TEST02専用読取ロールの権限が不一致です');}
 else if(kind==='sa'){if(data.email!==SA||data.disabled)throw Error('TEST02の実行アカウントが不一致です');}
 else if(kind==='run'){
  const [audience,version,approval='false']=args,spec=data.spec?.template?.spec,c=spec?.containers?.[0],env=c?.env||[],expected={...config(audience),MG_GENERATION_APPROVED:approval};
  if(data.metadata?.name!==SERVICE||spec?.serviceAccountName!==SA||Object.entries(expected).some(([k,v])=>env.find(e=>e.name===k)?.value!==v))throw Error('TEST02の実行設定が不一致です');
  const key=env.find(e=>e.name==='MG_GEMINI_API_KEY');if(key?.value!==undefined||key?.valueFrom?.secretKeyRef?.name!==SECRET||key?.valueFrom?.secretKeyRef?.key!==version)throw Error('Secret参照が不一致です');
  if(data.status?.latestReadyRevisionName!==data.status?.latestCreatedRevisionName||!data.status?.traffic?.some(t=>t.percent===100&&t.revisionName===data.status.latestReadyRevisionName))throw Error('最新revisionへの100%配置を確認してください');
  if(!/^https:\/\/yoshilab-material-test02-[A-Za-z0-9.-]+\.run\.app$/.test(data.status?.url||''))throw Error('TEST02 URLが不一致です');
  return {environment:'TEST02',generationApproved:approval==='true',appendEnabled:false,publishEnabled:false,url:data.status.url};
 }else throw Error('未対応の検査です');
 return {check:kind,ok:true};
}
if(require.main===module){try{const fs=require('node:fs'),[kind,...args]=process.argv.slice(2);console.log(JSON.stringify(kind==='config'?config(args[0]):verify(kind,JSON.parse(fs.readFileSync(0,'utf8')),args)));}catch{console.error('TEST02の設定検査に失敗しました。秘密値や入力全文は表示しません。');process.exitCode=1;}}
module.exports={config,verify,PERMISSIONS,SA,BUCKET,SECRET};
