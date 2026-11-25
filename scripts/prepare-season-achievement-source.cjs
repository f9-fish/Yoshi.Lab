'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');
const { capture, parseJson, seal } = require('./season-achievement-source.cjs');
const { sourceHash } = require('./season-achievements.cjs');

async function readRoot(origin) {
  const adminRequire = createRequire(require.resolve('../studio-functions/package.json'));
  const { applicationDefault } = adminRequire('firebase-admin/app');
  const { access_token: token } = await applicationDefault().getAccessToken();
  const response = await fetch(origin + '/.json', {
    headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-store' },
    redirect: 'error', signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw Error('Realtime Database の読み取りに失敗しました (HTTP ' + response.status + ')');
  return parseJson(await response.text());
}

async function main() {
  const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: {
    'database-url': { type: 'string' }, input: { type: 'string' }, evidence: { type: 'string' },
    output: { type: 'string' },
  } });
  if (!values.output) throw Error('--output が必要です');
  let source;
  if (command === 'capture') {
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw Error('エミュレーターの環境変数を解除してください');
    source = await capture({ databaseURL: values['database-url'], readRoot });
  } else if (command === 'seal' && values.input && values.evidence) {
    source = seal(readFileSync(values.input), parseJson(readFileSync(values.evidence)));
  } else {
    throw Error('capture --database-url … または seal --input … --evidence … を指定してください');
  }
  const bytes = JSON.stringify(source) + '\n';
  writeFileSync(values.output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: command === 'capture' ? 'captured-unverified' : 'prepared',
    sha256: sourceHash(bytes), ...(source.capture || {}) }));
}

main().catch(error => {
  console.error('確定用入力の準備に失敗しました。', error.message);
  process.exitCode = 1;
});
