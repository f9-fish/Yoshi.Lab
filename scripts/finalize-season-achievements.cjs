'use strict';

const { readFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const { buildSnapshot, path, publishOnce, sourceHash } = require('./season-achievements.cjs');

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' },
    'expected-sha256': { type: 'string' },
    'database-url': { type: 'string' },
    'project-id': { type: 'string' },
    publish: { type: 'boolean' },
  } });
  if (!values.source) throw Error('--source が必要です');
  const bytes = readFileSync(values.source);
  const hash = sourceHash(bytes);
  const snapshot = buildSnapshot(JSON.parse(bytes), { sourceHash: hash });
  if (!values.publish) {
    const radiant = Object.values(snapshot.students).filter(row => row.badgeType === 'radiant_top10').length;
    console.log(JSON.stringify({ status: 'dry-run', ...snapshot.metadata, radiant }));
    return;
  }
  const databaseURL = values['database-url'];
  const projectId = values['project-id'];
  if (values['expected-sha256'] !== hash || !projectId ||
      !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)\/?$/.test(databaseURL || '') ||
      process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    throw Error('公開には確認済みSHA-256、明示したプロジェクトIDとRTDB URL、および本番管理者認証が必要です');
  }
  const adminRequire = require('node:module').createRequire(require.resolve('../studio-functions/package.json'));
  const { applicationDefault, deleteApp, initializeApp } = adminRequire('firebase-admin/app');
  const { getDatabase } = adminRequire('firebase-admin/database');
  const app = initializeApp({ credential: applicationDefault(), databaseURL, projectId });
  try {
    const result = await publishOnce(getDatabase(app).ref(path), snapshot);
    console.log(JSON.stringify({ ...result, projectId, path }));
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error('確定処理に失敗しました。必要に応じて同じ入力で再実行してください。', error.message);
  process.exitCode = 1;
});
