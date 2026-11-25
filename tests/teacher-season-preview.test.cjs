const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers/app-harness.cjs');

const teacher = { uid: 'teacher', emailVerified: true, isAnonymous: false };
const turn = () => new Promise(resolve => setImmediate(resolve));

async function access() {
  const { watchTeacherAccess } = await import('../teacher-preview-access.js');
  const harness = { states: [], roles: [], connections: [] };
  harness.getTokenInfo = async () => ({ signInProvider: 'google.com' });
  harness.stop = watchTeacherAccess({
    observeAccount(receive) { harness.account = receive; return () => {}; },
    getTokenInfo: user => harness.getTokenInfo(user),
    observeConnection(receive, fail) {
      const watch = { receive, fail, stopped: false };
      harness.connections.push(watch);
      return () => { watch.stopped = true; };
    },
    observeRole(uid, receive, fail) {
      const watch = { uid, receive, fail, stopped: false };
      harness.roles.push(watch);
      return () => { watch.stopped = true; };
    },
  }, state => harness.states.push(state));
  return harness;
}

test('only a verified Google identity with a live strict-true teacher UID is allowed', async () => {
  const h = await access();
  await h.account(teacher);
  assert.deepEqual(h.states, ['checking']);
  assert.equal(h.roles.length, 0);
  h.connections[0].receive(true);
  assert.equal(h.roles[0].uid, 'teacher');
  assert.equal(h.states.at(-1), 'checking');
  for (const value of [false, null, 'true', 1]) {
    h.roles[0].receive(value);
    assert.equal(h.states.at(-1), 'denied');
  }
  h.roles[0].receive(true);
  assert.equal(h.states.at(-1), 'allowed');
  h.roles[0].fail(Error('permissions changed'));
  assert.equal(h.states.at(-1), 'error');
  h.stop();
  assert.equal(h.connections[0].stopped, true);
  assert.equal(h.roles[0].stopped, true);
});

test('signed-out, anonymous, unverified and non-Google accounts never read teacher roles', async () => {
  const h = await access();
  await h.account(null);
  await h.account({ ...teacher, isAnonymous: true });
  await h.account({ ...teacher, emailVerified: false });
  h.getTokenInfo = async () => ({ signInProvider: 'password' });
  await h.account(teacher);
  assert.deepEqual(h.states, ['signed-out', 'denied', 'denied', 'checking', 'denied']);
  assert.equal(h.connections.length, 0);
  assert.equal(h.roles.length, 0);
});

test('connection loss and account changes hide preview and discard old responses', async () => {
  const h = await access();
  await h.account(teacher);
  h.connections[0].receive(true);
  h.roles[0].receive(true);
  h.connections[0].receive(false);
  assert.equal(h.states.at(-1), 'offline');
  h.roles[0].receive(true);
  assert.equal(h.states.at(-1), 'offline');
  h.connections[0].receive(true);
  assert.equal(h.states.at(-1), 'checking');
  await h.account(null);
  h.roles[1].receive(true);
  assert.equal(h.states.at(-1), 'signed-out');
  let resolve;
  h.getTokenInfo = () => new Promise(done => { resolve = done; });
  const previous = h.account(teacher);
  await turn();
  await h.account(null);
  resolve({ signInProvider: 'google.com' });
  await previous;
  assert.equal(h.connections.length, 1);
});

test('preview entry and modules use no write-capable app code and read only teacher access', () => {
  const html = read('teacher-season2-preview.html');
  assert.match(html, /id="previewOutlet" hidden/);
  assert.doesNotMatch(html, /account\.js|serviceWorker|maintenance-gate/);
  const entry = read('teacher-season2-preview.js');
  const database = entry.match(/import \{([^}]+)\} from '[^']+firebase-database\.js'/);
  assert.ok(database);
  assert.deepEqual(database[1].split(',').map(name => name.trim()), ['getDatabase', 'onValue', 'ref']);
  assert.match(entry, /ref\(db, 'teacherUids\/' \+ uid\)/);
  assert.match(entry, /ref\(db, '\.info\/connected'\)/);
  for (const name of ['teacher-season2-preview.js', 'teacher-preview-access.js', 'season2-opening.js']) {
    assert.doesNotMatch(read(name), /URLSearchParams|location\.search|syncXP|localStorage|sessionStorage|sendBeacon/);
  }
});
