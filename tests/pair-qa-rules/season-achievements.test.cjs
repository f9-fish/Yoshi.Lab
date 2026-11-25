const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { get, ref, set } = require('firebase/database');
const { merge } = require('../../scripts/merge-season-achievement-rules.cjs');
const baseline = require('../../firebase-rtdb.rules.qa-integrated.json');

const root = 'seasonAchievements/2026-S3';
const token = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-yoshi-achievements',
    database: { host: '127.0.0.1', port: 9009, rules: JSON.stringify(merge(baseline)) },
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, 'studentProfiles'), { first: { name: 'First' }, second: { name: 'Second' } });
    await set(ref(db, root), {
      metadata: { count: 2 },
      students: { first: { seasonXp: 12000 }, second: { seasonXp: 0 } },
      ranking: { badges: { first: { badgeType: 'radiant_top10' } } },
    });
  });
});

after(async () => { await env?.cleanup(); });

test('registered verified users read their own record and the display projection only', async () => {
  const db = env.authenticatedContext('first', token).database();
  await assertSucceeds(get(ref(db, root + '/students/first')));
  await assertSucceeds(get(ref(db, root + '/ranking')));
  for (const suffix of ['', '/students', '/students/second', '/metadata']) {
    await assertFails(get(ref(db, root + suffix)));
  }
  await assertFails(set(ref(db, root + '/students/first'), { seasonXp: 9 }));
  await assertFails(set(ref(db, root + '/ranking'), null));
});

test('guests, unverified accounts and verified accounts without profiles cannot read results', async () => {
  const clients = [env.unauthenticatedContext(),
    env.authenticatedContext('first', { ...token, email_verified: false }),
    env.authenticatedContext('first', { ...token, firebase: { sign_in_provider: 'anonymous' } }),
    env.authenticatedContext('unregistered', token)];
  for (const context of clients) {
    const db = context.database();
    await assertFails(get(ref(db, root + '/ranking')));
    await assertFails(get(ref(db, root + '/students/first')));
  }
});
