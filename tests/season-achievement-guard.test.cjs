const assert = require('node:assert/strict');
const test = require('node:test');
const baseline = require('../firebase-rtdb.rules.qa-integrated.json');
const { prepareGuard, guardStart, guardEnd } = require('../scripts/prepare-season-achievement-guard.cjs');
const { cutoff } = require('../scripts/season-achievements.cjs');

test('guard proposal preserves validation, reads and every unrelated namespace', () => {
  const original = structuredClone(baseline);
  const actual = prepareGuard(baseline);
  const expected = structuredClone(original);
  for (const node of [expected.rules.learningRecords.$uid, expected.rules.learningRecords.$uid.$record,
    expected.rules.studentProfiles.$uid]) {
    node['.write'] = '(now < ' + guardStart + ' || now >= ' + guardEnd + ') && (' + node['.write'] + ')';
  }
  assert.deepEqual(actual, expected);
  assert.deepEqual(baseline, original);
  assert.equal(guardStart, Date.parse('2026-11-27T23:59:00+09:00'));
  assert.equal(guardEnd, Date.parse('2026-11-28T00:02:00+09:00'));
});

test('a potentially permissive ancestor or an unrecognized source aborts', () => {
  for (const rootWrite of [true, 'auth != null', 'false || true']) {
    assert.throws(() => prepareGuard({ rules: { ...baseline.rules, '.write': rootWrite } }), /ルート/);
  }
  assert.throws(() => prepareGuard({ rules: { ...baseline.rules, '$other': { '.write': true } } }), /ルート/);
  assert.throws(() => prepareGuard({ rules: { ...baseline.rules, learningRecords: {} } }), /保護対象/);
  assert.throws(() => prepareGuard(baseline, { start: cutoff, end: cutoff + 10 }), /締切/);
});

test('existing denied writes stay denied, and deeper grants are constrained', () => {
  const input = { rules: {
    '.write': ' false ', learningRecords: { '.write': false, '$uid': { '$record': { title: { '.write': true } } } },
    studentProfiles: { '.write': 'auth != null', '$uid': { '.write': 'false' } },
  } };
  const { rules } = prepareGuard(input);
  assert.equal(rules.learningRecords['.write'], false);
  assert.equal(rules.studentProfiles.$uid['.write'], 'false');
  assert.equal(rules.learningRecords.$uid.$record.title['.write'],
    '(now < ' + guardStart + ' || now >= ' + guardEnd + ') && (true)');
});
