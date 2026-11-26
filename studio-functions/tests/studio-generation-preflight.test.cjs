const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { TYPES, checkInput } = require('../studio-core.cjs');
const { fixture, inspectRevision } = require('../../scripts/studio-generation-preflight.cjs');

const url = 'https://studioapi-bfaa4wjjga-an.a.run.app';
const revisionName = 'studioapi-example-001';
const service = { status: { url, traffic: [{ revisionName, percent: 100 }] } };
const revision = { metadata: { name: revisionName }, spec: { containers: [{ env: [
  { name: 'STUDIO_GEMINI_MODEL', value: 'gemini-test-model' },
  { name: 'STUDIO_GEMINI_API_KEY', valueFrom: { secretKeyRef: { name: 'private-reference', key: '1' } } },
  { name: 'STUDIO_ALLOWED_ORIGINS', value: 'https://f9-fish.github.io/' },
  { name: 'UNRELATED', value: 'unrelated-secret-value' },
] }] } };

test('checks the actual traffic revision, exact endpoint, model, secret presence and CORS without emitting secret metadata', () => {
  const report = inspectRevision(service, revision);
  assert.equal(report.configurationMatches, true);
  assert.equal(report.model, 'gemini-test-model');
  assert.doesNotMatch(JSON.stringify(report), /private-reference|unrelated-secret-value/);
  const split = structuredClone(service);
  split.status.traffic = [{ revisionName, percent: 90 }, { revisionName: 'studioapi-other', percent: 10 }];
  assert.equal(inspectRevision(split, revision).configurationMatches, false);
  const stale = structuredClone(revision);
  stale.metadata.name = 'studioapi-old';
  assert.equal(inspectRevision(service, stale).configurationMatches, false);
  const different = structuredClone(service);
  different.status.url = 'https://other.example';
  assert.equal(inspectRevision(different, revision).configurationMatches, false);
});

test('does not accept a plaintext key, an assumed model or a mismatched CORS origin', () => {
  const changed = structuredClone(revision);
  changed.spec.containers[0].env = [
    { name: 'STUDIO_GEMINI_MODEL', value: ' ' },
    { name: 'STUDIO_GEMINI_API_KEY', value: 'example-secret' },
    { name: 'STUDIO_ALLOWED_ORIGINS', value: 'https://f9-fish.github.io.example' },
  ];
  const report = inspectRevision(service, changed);
  assert.equal(report.configurationMatches, false);
  assert.equal(report.keyBound, false);
  assert.equal(report.model, null);
  assert.equal(report.originAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /example-secret/);
});

test('synthetic fixture is accepted by the studio validator and requests a maximum of ten questions offline', () => {
  const example = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/studio-generation-preflight.cjs'), '--fixture']));
  assert.deepEqual(example, fixture);
  assert.equal(checkInput(example).count * TYPES.length, 10);
});
