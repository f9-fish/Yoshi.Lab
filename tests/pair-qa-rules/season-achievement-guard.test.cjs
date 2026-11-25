const { test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { get, ref, remove, set, update } = require('firebase/database');
const { prepareGuard } = require('../../scripts/prepare-season-achievement-guard.cjs');
const baseline = require('../../firebase-rtdb.rules.qa-integrated.json');

const token = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const profile = { classNumber: 1, studentNumber: 1, name: 'Sample', createdAt: 100 };
const practice = { subject: '英C', lesson: '1', part: '1', mode: 'vocab', right: 1, total: 1, createdAt: 100 };
const dailyPath = 'learningRecords/student/daily_20261127_ec_1';
const daily = { ...practice, dailyV1: true };

async function exercise(t, phase, expect) {
  const now = Date.now();
  const boundary = now + { before: 180_000, inside: 0, after: -180_000 }[phase];
  const rules = prepareGuard(baseline, { boundary, start: boundary - 120_000, end: boundary + 120_000 });
  const env = await initializeTestEnvironment({
    projectId: 'demo-yoshi-achievements',
    database: { host: '127.0.0.1', port: 9009, rules: JSON.stringify(rules) },
  });
  t.after(() => env.cleanup());
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, 'studentProfiles/student'), profile);
    await set(ref(db, 'teacherUids/teacher'), true);
    await set(ref(db, dailyPath), daily);
  });
  const student = env.authenticatedContext('student', token).database();
  const otherDevice = env.authenticatedContext('student', token).database();
  const teacher = env.authenticatedContext('teacher', token).database();
  await assertSucceeds(get(ref(student, dailyPath)));
  await expect(set(ref(student, 'learningRecords/student/practice'), practice));
  await expect(update(ref(otherDevice, 'learningRecords/student'), { second: practice, 'daily_20261127_ec_1/right': 0 }));
  await expect(remove(ref(teacher, dailyPath)));
  await expect(update(ref(teacher, 'studentProfiles/student'), { name: 'Edited' }));
  await assertSucceeds(set(ref(student, 'lastAccess/student'), { at: now }));
}

test('server-side time gate denies new, delayed and multi-device writes during the guard', async t => {
  await exercise(t, 'inside', assertFails);
});

for (const phase of ['before', 'after']) {
  test('the original write permissions still work ' + phase + ' the guard', async t => {
    await exercise(t, phase, assertSucceeds);
  });
}
