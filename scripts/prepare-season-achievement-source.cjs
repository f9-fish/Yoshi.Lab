'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');
const { parseJson, seal } = require('./season-achievement-source.cjs');
const { captureAtCutoff, RetryableReadError, writePrivateOnce } = require('./season-achievement-cutoff.cjs');
const { sourceHash } = require('./season-achievements.cjs');

function setupRootReader() {
  const adminRequire = createRequire(require.resolve('../studio-functions/package.json'));
  const { applicationDefault } = adminRequire('firebase-admin/app');
  const credential = applicationDefault();
  return async (origin, timeoutMs) => {
    const { access_token: token } = await credential.getAccessToken();
    const response = await fetch(origin + '/.json', {
      headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-store' },
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => { throw new RetryableReadError('Realtime Database の接続または応答待機に失敗しました'); });
    if (!response.ok) {
      const message = 'Realtime Database の読み取りに失敗しました (HTTP ' + response.status + ')';
      if (response.status === 429 || response.status >= 500) throw new RetryableReadError(message);
      throw Error(message);
    }
    const body = await response.text().catch(() => { throw new RetryableReadError('Realtime Database の応答を最後まで読めませんでした'); });
    return { data: parseJson(body), date: response.headers.get('date') };
  };
}

async function main() {
  const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: {
    'database-url': { type: 'string' }, input: { type: 'string' }, evidence: { type: 'string' },
    output: { type: 'string' },
  } });
  if (!values.output) throw Error('--output が必要です');
  if (existsSync(values.output)) throw Error('既存の出力を保護しました。同じ出力先には再取得しません');
  let source;
  if (command === 'capture') {
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw Error('エミュレーターの環境変数を解除してください');
    source = await captureAtCutoff({ databaseURL: values['database-url'], readRoot: setupRootReader() });
  } else if (command === 'seal' && values.input && values.evidence) {
    source = seal(readFileSync(values.input), parseJson(readFileSync(values.evidence)));
  } else {
    throw Error('capture --database-url … または seal --input … --evidence … を指定してください');
  }
  const bytes = JSON.stringify(source) + '\n';
  writePrivateOnce(values.output, bytes);
  console.log(JSON.stringify({ status: command === 'capture' ? 'captured-unverified' : 'prepared',
    sha256: sourceHash(bytes), ...(source.capture || {}) }));
}

main().catch(error => {
  console.error('確定用入力の準備に失敗しました。', error.message);
  process.exitCode = 1;
});
