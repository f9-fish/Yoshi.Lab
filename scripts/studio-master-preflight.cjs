'use strict';

const { spawnSync } = require('node:child_process');
const { checkTextbookMasterHeader } = require('../studio-functions/textbook-master.cjs');

const project = 'yoshi-lab-db3eb';
const region = 'asia-northeast1';
const credentialsApi = 'iamcredentials.googleapis.com';
const sheetsApi = 'sheets.googleapis.com';
const sheetSetting = 'STUDIO_MASTER_SPREADSHEET_ID';
const readerSetting = 'STUDIO_MASTER_READER_SERVICE_ACCOUNT';

function gcloud(args, error) {
 const result = spawnSync('gcloud', [...args, '--quiet'], {
  encoding:'utf8', timeout:30000, maxBuffer:2 * 1024 * 1024,
 });
 if (result.error || result.status !== 0) throw Error(error);
 return result.stdout;
}

function gcloudJson(args, error) {
 try { return JSON.parse(gcloud([...args,'--format=json'], error)); }
 catch { throw Error(error); }
}

function selectRevision(service) {
 const traffic = (service.status?.traffic || []).filter(entry => Number(entry.percent) > 0);
 const name = traffic.length === 1 && Number(traffic[0].percent) === 100 ? traffic[0].revisionName : '';
 if (!/^studioapi-[a-z0-9-]+$/.test(name || '')) {
  throw Error('100%のトラフィックを受ける単一のstudioApiリビジョンを確認できません');
 }
 return name;
}

function inspectRevision(revision, name) {
 const { spec } = revision;
 const runtime = spec?.serviceAccountName || '';
 if (revision.metadata?.name !== name || spec?.containers?.length !== 1 ||
     !/^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(runtime)) {
  throw Error('選択したリビジョンの実行サービスアカウントを確認できません');
 }
 const vars = Object.fromEntries((spec.containers[0].env || []).map(entry => [entry.name, entry.value]));
 const reader = vars[readerSetting] || '';
 const sheet = vars[sheetSetting] || '';
 return { runtime, config:{[readerSetting]:reader,[sheetSetting]:sheet},
  readerProject:/^[a-z0-9-]+@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/.exec(reader)?.[1] || '',
  sheetConfigured:/^[A-Za-z0-9_-]{20,100}$/.test(sheet) };
}

function productionOperations() {
 const common = ['--region', region, '--project', project];
 return {
  service: () => gcloudJson(['run','services','describe','studioapi',...common],'studioApi設定の参照に失敗しました'),
  revision: name => gcloudJson(['run','revisions','describe',name,...common],'稼働リビジョンの参照に失敗しました'),
  async apiEnabled(target, name) {
   const services = gcloudJson(['services','list','--enabled','--project',target,'--filter=config.name='+name],
    'APIの有効状態が参照できません。既存権限を確認してください');
   return services.some(service => service.config?.name === name);
  },
  runtimeToken: runtime => gcloud(
   ['auth','print-access-token','--project',project,'--impersonate-service-account',runtime],
   '操作者が実行サービスアカウントを代理できないため、実効権限は未確認です。追加権限の自動付与は行いません',
  ).trim(),
  checkHeader: checkTextbookMasterHeader,
 };
}

async function preflight(ops, report) {
 const revisionName = selectRevision(await ops.service());
 const { runtime, readerProject, sheetConfigured, config } = inspectRevision(await ops.revision(revisionName), revisionName);
 report({ stage:'configuration', revision:revisionName, runtimeServiceAccount:runtime,
  readerConfigured:Boolean(readerProject), sheetConfigured });
 const iamEnabled = await ops.apiEnabled(project, credentialsApi);
 const sheetsProject = readerProject || project;
 const sheetsEnabled = await ops.apiEnabled(sheetsProject, sheetsApi);
 report({ stage:'apis', iamCredentialsEnabled:iamEnabled, sheetsApiEnabled:sheetsEnabled, sheetsApiProject:sheetsProject });
 if (!readerProject || !sheetConfigured) throw Error('閲覧用サービスアカウントまたは対象シートの設定が不足しています。認証・シート確認は未実行です');
 if (!iamEnabled || !sheetsEnabled) throw Error('必要APIの少なくとも一方が無効です。有効化せずに停止しました');
 // Obtain the runtime identity only when already permitted. No keys, role changes or writes.
 const token = await ops.runtimeToken(runtime);
 try {
  await ops.checkHeader({ config, getRuntimeToken:async()=>token });
 } catch (error) {
  if (error.status === 502 || error.status === 422) throw Error(error.message, {cause:error});
  throw Error('実行主体によるシートの読み取り権限を確認できません');
 }
 report({ stage:'ready', readOnlyHeaderVerified:true, dataRowsRead:false });
}

if (require.main === module) {
 preflight(productionOperations(), entry => console.log(JSON.stringify(entry))).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
 });
}
module.exports = { preflight, inspectRevision, selectRevision };
