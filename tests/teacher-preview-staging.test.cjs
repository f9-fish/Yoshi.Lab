const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { request } = require('node:https');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('Firebase project check is read-only and matches exact or approved parent domains', async () => {
  const { checkDomain } = await import('../scripts/check-teacher-preview-domain.mjs');
  const project = async (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://identitytoolkit.googleapis.com/v1/projects');
    assert.equal(options.method, undefined); // Default GET.
    return { ok: true, json: async () => ({ authorizedDomains: ['localhost', 'school.example', '127.0.0.1'] }) };
  };
  assert.equal(await checkDomain('https://localhost:8443', project), true);
  assert.equal(await checkDomain('https://preview.school.example', project), true);
  assert.equal(await checkDomain('https://notschool.example', project), false);
  assert.equal(await checkDomain('https://school.example.test', project), false);
  await assert.rejects(checkDomain('http://localhost:8443', project), /HTTPS origin/);
  await assert.rejects(checkDomain('https://localhost:8443', async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(checkDomain('https://localhost:8443', async () => ({
    ok: true, json: async () => ({}),
  })), /domain list/);
});

test('private HTTPS staging protects HTML, scripts, source and images before Firebase sign-in', async t => {
  const { createPreviewServer } = await import('../scripts/serve-teacher-preview.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'yoshi-preview-tls-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const certPath = join(folder, 'cert.pem');
  const keyPath = join(folder, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', keyPath,
    '-out', certPath], { stdio: 'ignore' });
  const cert = readFileSync(certPath);
  const secret = 'a'.repeat(43);
  const auth = 'Basic ' + Buffer.from('preview:' + secret).toString('base64');
  const port = 8443;
  const server = createPreviewServer({
    origin: 'https://localhost:' + port,
    passwordHash: createHash('sha256').update(secret).digest('hex'),
    tls: { cert, key: readFileSync(keyPath) },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  function read(path, { authorization, method = 'GET', host = 'localhost:' + port } = {}) {
    return new Promise((resolve, reject) => {
      const headers = { host, ...(authorization ? { authorization } : {}) };
      const req = request({ hostname: '127.0.0.1', servername: 'localhost', ca: cert,
        port: server.address().port, path, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  for (const path of ['/', '/teacher-season2-preview.html?teacher=true', '/__home-source',
    '/teacher-season2-preview.js', '/firebase-web-config.js', '/mountain-mobile-v7.jpg', '/index.html']) {
    const res = await read(path);
    assert.equal(res.status, 401, path);
    assert.equal(res.body, '');
    assert.match(res.headers['www-authenticate'], /^Basic /);
    assert.match(res.headers['cache-control'], /private, no-store/);
  }
  assert.equal((await read('/teacher-season2-preview.html', { authorization: 'Basic bad' })).status, 401);
  assert.equal((await read('/', { authorization: auth, host: 'unrelated.example' })).status, 421);
  assert.equal((await read('/', { authorization: auth, method: 'POST' })).status, 405);
  assert.equal((await read('/account.js', { authorization: auth })).status, 404);
  const preview = await read('/teacher-season2-preview.html', { authorization: auth });
  assert.equal(preview.status, 200);
  assert.match(preview.body, /preview-home-source.*__home-source/);
  assert.match(preview.body, /id="previewOutlet" hidden/);
  assert.match(preview.headers['content-security-policy'], /frame-ancestors 'none'/);
  const source = await read('/__home-source', { authorization: auth });
  assert.equal(source.status, 200);
  assert.match(source.headers['content-type'], /^text\/plain/);
  assert.match(source.body, /id="subjects"/);
  const returnToNormal = await read('/index.html?view=subjects', { authorization: auth });
  assert.equal(returnToNormal.status, 302);
  assert.equal(returnToNormal.headers.location, 'https://f9-fish.github.io/Yoshi.Lab/index.html?view=subjects');
});
