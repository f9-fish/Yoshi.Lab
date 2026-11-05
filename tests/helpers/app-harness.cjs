const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const NOW = Date.parse('2026-11-05T12:00:00+09:00');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const clone = value => value == null ? value : structuredClone(value);

// Deliberately has no network primitives, real Firebase SDK, or credentials.
function context(extra = {}) {
  return vm.createContext({ Date: FixedDate, Intl, console, ...extra }, {
    codeGeneration: { strings: false, wasm: false },
  });
}

function accountHarness({ records = {}, teacher = false, loggedIn = true } = {}) {
  const uid = 'student_test_001';
  const data = {
    studentProfiles: { [uid]: { classNumber: 1, studentNumber: 1, name: '架空の生徒' } },
    learningRecords: { [uid]: clone(records) },
    teacherUids: { [uid]: teacher },
  };
  const writes = [];
  const lookup = key => key.split('/').reduce((v, k) => v?.[k], data) ?? null;
  const snapshot = value => ({ val: () => clone(value), exists: () => value != null });
  const write = (key, value) => {
    const parts = key.split('/');
    let parent = data;
    for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
    parent[parts.at(-1)] = clone(value);
    writes.push(key);
  };
  const user = { uid, emailVerified: true, getIdTokenResult: async () => ({ signInProvider: 'google.com' }) };
  const sandbox = context({
    window: {}, document: { dispatchEvent() {} }, Event: class {},
    initializeApp: () => ({}), getApps: () => [], getApp: () => ({}),
    getAuth: () => ({ currentUser: loggedIn ? user : null }), getDatabase: () => ({}),
    GoogleAuthProvider: class { setCustomParameters() {} },
    browserLocalPersistence: 'local', setPersistence: async () => {},
    signInWithPopup: async () => {}, signInWithRedirect: async () => {},
    getRedirectResult: async () => null, signOut: async () => {},
    onAuthStateChanged: (_auth, callback) => callback(loggedIn ? user : null),
    ref: (_db, key) => key,
    get: async key => snapshot(lookup(key)),
    set: async (key, value) => write(key, value),
    push: () => { throw Error('Unexpected push in this test'); },
    remove: async key => {
      const parts = key.split('/');
      const parent = parts.slice(0, -1).reduce((v, k) => v?.[k], data);
      if (parent) delete parent[parts.at(-1)];
    },
    runTransaction: async (key, update) => {
      const value = update(clone(lookup(key)));
      if (value === undefined) return { committed: false, snapshot: snapshot(lookup(key)) };
      write(key, value);
      return { committed: true, snapshot: snapshot(value) };
    },
  });
  const source = read('account.js');
  const imports = source.match(/^import .*;\r?$/gm) || [];
  assert.equal(imports.length, 3, 'Review harness if Firebase imports change');
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ''), sandbox, { filename: 'account.js', timeout: 1000 });
  return { api: sandbox.window.YoshiAccount, sandbox, uid, data, writes,
    evaluate: code => vm.runInContext(code, sandbox, { timeout: 1000 }) };
}

// Minimal DOM double: tests exercise application control flow, not browser layout.
function element() {
  const classes = new Set();
  return {
    textContent: '', innerHTML: '', disabled: false, hidden: false, value: '',
    style: {}, dataset: {}, children: [],
    classList: {
      add: (...xs) => xs.forEach(x => classes.add(x)),
      remove: (...xs) => xs.forEach(x => classes.delete(x)),
      contains: x => classes.has(x),
      toggle(x, force) { const on = force ?? !classes.has(x); on ? classes.add(x) : classes.delete(x); return on; },
    },
    append(...xs) { this.children.push(...xs); },
    replaceChildren(...xs) { this.children = xs; },
    before() {}, after() {}, remove() {}, focus() {}, scrollIntoView() {},
    setAttribute() {}, addEventListener() {}, querySelectorAll() { return []; },
  };
}

function dailyHarness(options) {
  const account = accountHarness(options);
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const listeners = new Map();
  const pendingFetches = [];
  const sandbox = context({
    window: { YoshiAccount: account.api, location: {}, confirm: () => false,
      addEventListener: (name, callback) => listeners.set(name, callback) },
    document: { getElementById: getElement, createElement: element,
      createTextNode: text => ({ textContent: text }), querySelectorAll: () => [] },
    history: { pushState() {}, go() {}, length: 1 },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: url => {
      // Only allow the four local fixtures requested by the actual Daily script.
      assert.match(url, /^\.\/(vocabulary|ronpyo_vocab|lessons|ronpyo_text)\.json$/);
      const response = Promise.resolve({ ok: true, json: async () => JSON.parse(read(url.slice(2))) });
      pendingFetches.push(response);
      return response;
    },
  });
  const scripts = [...read('daily.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const matches = scripts.filter(([, , code]) => code.includes('const dailyXP='));
  assert.equal(matches.length, 1, 'Daily application script must be identified unambiguously');
  vm.runInContext(matches[0][2], sandbox, { filename: 'daily.html:inline', timeout: 1000 });
  return { ...account, sandbox, elements, listeners,
    evaluate: code => vm.runInContext(code, sandbox, { timeout: 1000 }),
    async ready() {
      await Promise.all(pendingFetches);
      await this.evaluate('load()');
      await this.evaluate('refreshDaily()');
      this.evaluate("chooseSubject('ec')");
    },
  };
}

function functionFromLine(file, name) {
  const lines = read(file).split(/\r?\n/).filter(line => line.startsWith(`function ${name}(`));
  assert.equal(lines.length, 1, `Review extraction of ${name}`);
  return vm.runInContext(`(${lines[0]})`, context(), { filename: file, timeout: 1000 });
}

module.exports = { accountHarness, dailyHarness, functionFromLine, context, read, NOW };
