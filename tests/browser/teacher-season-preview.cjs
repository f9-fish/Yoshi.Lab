'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const allowedFiles = new Set([
  'teacher-season2-preview.html', 'teacher-season2-preview.js', 'teacher-preview-access.js',
  'season2-opening.js', 'season2-opening.css', 'season-achievements-ui.js', 'season-achievements.css',
  'firebase-web-config.js', 'index.html', 'mountain-mobile-v7.jpg', 'mountain-desktop-v7.jpg',
]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };
const fixture = `
const userListeners = new Set();
const listeners = new Map();
const auth = { currentUser: null };
const google = { uid: 'fixture', emailVerified: true, isAnonymous: false };
window.previewFixture = {
 account(kind) {
  auth.currentUser = kind === 'signed-out' ? null : { ...google, isAnonymous: kind === 'anonymous' };
  for (const receive of userListeners) receive(auth.currentUser);
 },
 emit(path, value) { for (const watch of listeners.get(path) || []) watch.receive({ val: () => value }); },
 fail(path) { for (const watch of listeners.get(path) || []) watch.fail(Error('fixture')); },
 paths: [],
};
export const initializeApp = () => ({});
export const getAuth = () => { window.previewFixture.persistence = 'shared'; return auth; };
export const inMemoryPersistence = {};
export const initializeAuth = (_, options) => {
 window.previewFixture.persistence = options.persistence === inMemoryPersistence ? 'memory' : 'unexpected';
 return auth;
};
export const browserPopupRedirectResolver = {};
export const getIdTokenResult = async () => ({ signInProvider: 'google.com' });
export const onIdTokenChanged = (_, receive) => {
 userListeners.add(receive);
 queueMicrotask(() => receive(auth.currentUser));
 return () => userListeners.delete(receive);
};
export const browserLocalPersistence = {};
export const getRedirectResult = async () => null;
export const GoogleAuthProvider = class {};
export const setPersistence = async () => {};
export const signInWithPopup = async () => {};
export const signInWithRedirect = async () => {};
export const getDatabase = () => ({});
export const ref = (_, path) => path;
export const onValue = (path, receive, fail) => {
 window.previewFixture.paths.push(path);
 const watchers = listeners.get(path) || new Set();
 listeners.set(path, watchers);
 const watch = {receive, fail};
 watchers.add(watch);
 return () => watchers.delete(watch);
};
`;

const importMap = JSON.stringify({ imports: Object.fromEntries(['app', 'auth', 'database'].map(service => [
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-' + service + '.js', '/__firebase-fixture.js',
])) });
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname.slice(1);
  requests.push({ name, method: req.method });
  if (req.method !== 'GET') return res.writeHead(405).end();
  if (name === 'favicon.ico') return res.writeHead(204).end();
  if (name === '__firebase-fixture.js') return res.writeHead(200, { 'Content-Type': mime['.js'] }).end(fixture);
  if (name === '__home-source') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end(await readFile(join(root, 'index.html')));
  if (!allowedFiles.has(name)) return res.writeHead(404).end();
  let body = await readFile(join(root, name));
  if (name === 'teacher-season2-preview.html') {
    const staging = url.searchParams.get('staging') === 'true' ? '<meta name="preview-home-source" content="./__home-source">' : '';
    body = body.toString().replace('<head>', '<head>' + staging + '<script type="importmap">' + importMap + '</script>');
  }
  res.writeHead(200, { 'Content-Type': mime[extname(name)], 'Cache-Control': 'no-store' }).end(body);
});

async function until(check, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(message);
}

async function browser(debugPort) {
  const tab = await until(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
    return targets.find(target => target.type === 'page' && target.url === 'about:blank');
  }, 'Chrome did not provide its blank tab');
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const waiting = new Map();
  const network = [];
  let serial = 0;
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.method === 'Network.requestWillBeSent') network.push(reply.params.request);
    const handler = waiting.get(reply.id);
    if (handler) {
      waiting.delete(reply.id);
      if (reply.error) handler.reject(Error(reply.error.message));
      else handler.resolve(reply.result);
    }
  };
  return {
    call(method, params = {}) {
      const id = ++serial;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    network,
    close() { socket.close(); },
  };
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), 'yoshi-preview-browser-'));
  let chrome, session;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/teacher-season2-preview.html?preview=true&teacher=true';
    let chromeError;
    let chromeLog = '';
    chrome = spawn(process.env.CHROME_BIN || 'chromium', [
      '--headless', '--no-sandbox', '--no-proxy-server', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
      '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
    ], { env: { ...process.env, XDG_CACHE_HOME: join(profile, 'cache'), XDG_CONFIG_HOME: join(profile, 'config') },
      stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.on('data', chunk => { chromeLog = (chromeLog + chunk).slice(-4000); });
    chrome.on('error', error => { chromeError = error; });
    let port;
    try {
      port = await until(async () => {
      if (chromeError) throw chromeError;
      try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      }, 'Chrome did not start');
    } catch (error) {
      throw Error(error.message + '\n' + chromeLog, { cause: error });
    }
    session = await browser(port);
    const call = session.call.bind(session);
    await call('Network.enable');
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = expression => until(() => evaluate(expression), expression);
    const screenshotDir = process.env.PREVIEW_SCREENSHOTS;
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    async function screenshot(filename) {
      if (!screenshotDir) return;
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(screenshotDir, filename), Buffer.from(data, 'base64'));
    }

    for (const width of [320, 390, 768, 1280]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 850 : 980, deviceScaleFactor: 1, mobile: width < 768 });
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const source = width < 768 ? '__home-source' : 'index.html';
      const homeLoads = requests.filter(r => r.name === source).length;
      await call('Page.navigate', { url: url + '&staging=' + (width < 768) + '&width=' + width });
      await wait(`location.search.endsWith('width=${width}') && typeof previewFixture !== 'undefined'`);
      await wait("document.querySelector('#previewAccessStatus').textContent.includes('Google')");
      assert.equal(await evaluate('previewFixture.persistence'), width < 768 ? 'memory' : 'shared');
      assert.equal(await evaluate("document.querySelector('#previewOutlet').hidden && !document.querySelector('dialog')"), true);
      await evaluate("previewFixture.account('anonymous')");
      await wait("document.querySelector('#previewAccessStatus').textContent.includes('教員アカウントでのみ')");
      assert.deepEqual(await evaluate('previewFixture.paths'), []);
      await evaluate("previewFixture.account('student')");
      await wait("previewFixture.paths.includes('.info/connected')");
      await evaluate("previewFixture.emit('.info/connected', true); previewFixture.emit('teacherUids/fixture', false)");
      await wait("document.querySelector('#previewAccessStatus').textContent.includes('教員アカウントでのみ')");
      assert.equal(requests.filter(r => r.name === source).length, homeLoads);
      await evaluate("previewFixture.emit('teacherUids/fixture', true)");
      await wait("document.querySelector('dialog')?.open");
      assert.equal(requests.filter(r => r.name === source).length, homeLoads + 1);
      assert.deepEqual(await evaluate(`[
        document.querySelector('dialog .season-badge-center').textContent,
        document.querySelector('dialog [data-result]').textContent.includes('12,840 XP · 学習 48日'),
        document.activeElement.id, getComputedStyle(document.documentElement).overflow,
        innerWidth, document.documentElement.scrollWidth,
        document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth
      ]`), ['1', true, 'seasonOpeningTitle', 'hidden', width, width, true]);
      const tabKey = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
      for (let i = 0; i < 9; i++) {
        await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...tabKey });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', ...tabKey });
        assert.equal(await evaluate("document.querySelector('dialog').contains(document.activeElement) || document.activeElement === document.body"), true);
      }
      await evaluate("document.querySelector('#seasonOpeningTitle').focus()");
      await evaluate("document.fonts.ready");
      await screenshot('season2-modal-' + width + '.png');
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await wait("!document.querySelector('dialog').open && document.activeElement.hasAttribute('data-challenge')");
      assert.notEqual(await evaluate('getComputedStyle(document.documentElement).overflow'), 'hidden');
      await screenshot('season2-home-' + width + '.png');
      assert.equal(await evaluate("document.querySelectorAll('[data-subjects] a').length"), 5);
      await evaluate("document.querySelector('.preview-controls').open = true");
      for (const [variant, label] of [['top2', '2'], ['top3', '3'], ['top4', '4'], ['Radiant', 'Radiant'], ['Platinum', 'Platinum']]) {
        assert.equal(await evaluate(`{
          const picker = document.querySelector('[data-variant]');
          picker.value = '${variant}'; picker.dispatchEvent(new Event('change'));
          document.querySelector('dialog .season-badge-center').textContent
        }`), label);
      }
      for (const [phase, label, modal] of [
        ['before', '開幕まで 00:00:10', 'シーズン2 まもなく開幕'],
        ['after', 'SEASON 2', 'シーズン2 開幕イベントの記録'],
        ['opening', 'SEASON 2 START', 'シーズン2 開幕！'],
      ]) {
        assert.deepEqual(await evaluate(`{
          const picker = document.querySelector('[data-phase]');
          picker.value = '${phase}'; picker.dispatchEvent(new Event('change'));
          [document.querySelector('#openingHeading').textContent, document.querySelector('#seasonOpeningTitle').textContent]
        }`), [label, modal]);
      }
      for (const [name, value] of [['position', 8], ['xp', 750], ['days', 12]]) {
        await evaluate(`{
          const field = document.querySelector('[data-${name}]');
          field.value = '${value}'; field.dispatchEvent(new Event('input'));
        }`);
      }
      assert.equal(await evaluate(`[...document.querySelectorAll('[data-result]')].every(card => card.textContent.includes('8位 · 750 XP · 学習 12日'))`), true);
      await evaluate("document.querySelector('[data-replay]').click(); document.querySelector('dialog .preview-controls').open = true");
      await evaluate(`{
        const field = document.querySelector('dialog [data-position]');
        field.value = '9'; field.dispatchEvent(new Event('input'));
      }`);
      assert.equal(await evaluate("document.querySelector('dialog [data-result]').textContent.includes('9位')"), true);
      await evaluate("document.querySelector('dialog .preview-control-body [data-dismiss]').click()");
      await wait("!document.querySelector('dialog').open");
      for (const control of ['show', 'replay', 'replay']) {
        await evaluate(`document.querySelector('[data-${control}]').click()`);
        await wait("document.querySelector('dialog').open");
        await evaluate("document.querySelector('dialog [data-dismiss]').click()");
        await wait("!document.querySelector('dialog').open");
      }
      await evaluate("document.querySelector('[data-replay]').click(); document.querySelector('dialog [data-record]').click()");
      await wait("document.activeElement.id === 'previewRecordHeading'");
      await evaluate("document.querySelector('[data-replay]').click(); document.querySelector('dialog [data-challenge]').click()");
      await wait("document.activeElement.id === 'previewSubjects'");
      assert.deepEqual(await evaluate('previewFixture.paths'), ['.info/connected', 'teacherUids/fixture']);
      await evaluate("document.querySelector('[data-replay]').click(); previewFixture.fail('teacherUids/fixture')");
      await wait("document.querySelector('#previewOutlet').hidden && !document.querySelector('dialog')");
      console.log(width + 'px: access, dialog, replay, variants, phase, local edits and revocation passed');
    }
    assert.ok(session.network.every(request => request.method === 'GET' && new URL(request.url).origin === new URL(url).origin));
    for (const request of requests) {
      assert.equal(request.method, 'GET');
      assert.ok(allowedFiles.has(request.name) || ['__firebase-fixture.js', '__home-source', 'favicon.ico'].includes(request.name), request.name);
    }
    console.log('All preview requests were read-only local fixtures.');
  } finally {
    session?.close();
    if (chrome && chrome.exitCode === null && chrome.pid) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill('SIGKILL');
      await exited;
    }
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
}

run().catch(error => {
  if (process.env.GITHUB_ACTIONS) {
    console.error('::error::' + error.message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  }
  console.error(error);
  process.exitCode = 1;
});
