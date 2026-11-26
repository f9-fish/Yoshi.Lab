'use strict';

const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const project = 'yoshi-lab-db3eb';
const region = 'asia-northeast1';
const endpoint = 'https://studioapi-bfaa4wjjga-an.a.run.app';

const fixture = Object.freeze({
  subject: '英C', lesson: 'AI-SMOKE', part: '1', count: 2,
  source: [
    'Mia and Leo planned a book swap at their school.',
    'When heavy rain flooded the playground, they moved the event to the library.',
    'They put up signs and asked their classmates to spread the word.',
    'By noon, 30 students had brought books.',
    'The organizers donated the remaining books to a local shelter and decided to hold another swap in spring.',
  ].join(' '),
});

function inspectRevision(service, revision) {
  const traffic = (service?.status?.traffic || []).filter(entry => Number(entry.percent) > 0);
  const active = traffic.length === 1 && Number(traffic[0].percent) === 100 ? traffic[0].revisionName : null;
  const containers = revision?.spec?.containers;
  const env = Array.isArray(containers) && containers.length === 1 ? containers[0].env || [] : [];
  const setting = env.find(entry => entry.name === 'STUDIO_GEMINI_MODEL');
  const binding = env.find(entry => entry.name === 'STUDIO_GEMINI_API_KEY');
  const model = typeof setting?.value === 'string' && /^gemini-[a-z0-9][a-z0-9.-]{0,95}$/.test(setting.value) ?
    setting.value : null;
  const keyBound = Boolean(binding?.valueFrom?.secretKeyRef?.name && binding?.valueFrom?.secretKeyRef?.key);
  const originAllowed = env.find(entry => entry.name === 'STUDIO_ALLOWED_ORIGINS')?.value
    ?.split(',').some(value => value.trim().replace(/\/$/, '') === 'https://f9-fish.github.io') || false;
  const endpointMatches = service?.status?.url === endpoint || service?.status?.address?.url === endpoint;
  const revisionMatches = Boolean(active && active === revision?.metadata?.name);
  return { endpoint, endpointMatches, activeRevision: active, revisionMatches, model, keyBound, originAllowed,
    configurationMatches: endpointMatches && revisionMatches && Boolean(model) && keyBound && originAllowed };
}

function gcloudJson(args, label) {
  const result = spawnSync('gcloud', [...args, '--format=json', '--quiet'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw Error(label + ' を取得できません。Cloud Shellのログインと参照権限を確認してください');
  try { return JSON.parse(result.stdout); }
  catch { throw Error(label + ' の応答を解析できません'); }
}

function main() {
  const { values } = parseArgs({ options: {
    fixture: { type: 'boolean' }, 'confirmed-key-project': { type: 'string' },
  } });
  if (values.fixture) {
    console.log(JSON.stringify(fixture, null, 2));
    return;
  }
  const keyProject = values['confirmed-key-project'];
  if (keyProject !== undefined && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(keyProject)) {
    throw Error('キーの所属は確認済みのGoogle CloudプロジェクトIDを指定してください');
  }
  const common = ['--project', project, '--region', region];
  const service = gcloudJson(['run', 'services', 'describe', 'studioapi', ...common], 'studioApiのサービス設定');
  const traffic = (service.status?.traffic || []).filter(entry => Number(entry.percent) > 0);
  const revisionName = traffic.length === 1 && Number(traffic[0].percent) === 100 ? traffic[0].revisionName : '';
  const revision = /^studioapi-[a-z0-9-]+$/.test(revisionName) ? gcloudJson(
    ['run', 'revisions', 'describe', revisionName, ...common], '稼働リビジョン',
  ) : null;
  const report = inspectRevision(service, revision);
  let billingEnabled = null, geminiApiEnabled = null;
  if (keyProject) {
    const billing = gcloudJson(['billing', 'projects', 'describe', keyProject], '確認済みキープロジェクトの請求設定');
    billingEnabled = billing.billingEnabled === true;
    const services = gcloudJson(['services', 'list', '--enabled', '--project', keyProject,
      '--filter', 'config.name:generativelanguage.googleapis.com'], '確認済みキープロジェクトのAPI設定');
    geminiApiEnabled = services.some(service => service.config?.name === 'generativelanguage.googleapis.com');
  }
  console.log(JSON.stringify({ ...report, keyProject: keyProject || null, billingEnabled, geminiApiEnabled,
    liveGenerationAttempted: false }, null, 2));
  if (!report.configurationMatches || geminiApiEnabled === false) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { inspectRevision, fixture };
