const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, read } = require('./helpers/app-harness.cjs');

const midnight = Date.parse('2026-11-28T00:00:00+09:00');
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(now, { loggedIn = false, store = new Map(), welcome = false } = {}) {
  const h = accountHarness({ now, loggedIn });
  const nodes = new Map();
  let observerCallback;
  let active;
  function node(tag) {
    const children = [];
    const classes = new Set();
    const el = Object.assign(new EventTarget(), {
      tag, hidden: false, open: false, children, textContent: '',
      classList: { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)),
        remove: name => classes.delete(name) },
      setAttribute() {}, append(...entries) { children.push(...entries); },
      replaceChildren(...entries) { children.splice(0, children.length, ...entries); },
      focus() { active = this; }, scrollIntoView() { this.scrolled = true; },
      querySelector: () => get('firstChoice'),
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    Object.defineProperty(el, 'firstElementChild', { get: () => children[0] });
    return el;
  }
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, node(id));
    return nodes.get(id);
  }
  const body = get('body');
  if (welcome) body.classList.add('welcome-active');
  Object.assign(h.sandbox.document, { body, getElementById: get, createElement: node });
  h.sandbox.localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  h.sandbox.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  };
  h.evaluate(read('season-achievements-ui.js'));
  h.evaluate(read('season2-opening.js'));
  const click = id => get(id).dispatchEvent(new Event('click'));
  return { h, get, click, body, notify: () => observerCallback(), active: () => active };
}

test('uses the existing clock at 23:59:59, midnight and 00:00:01 JST, including a tab left open', () => {
  const t = setup(midnight - 1000);
  assert.equal(t.get('season2Opening').hidden, true);
  assert.equal(t.get('season2Dialog').open, false);
  t.h.advanceTo(midnight);
  assert.equal(t.get('season2Opening').hidden, false);
  assert.equal(t.get('season2Dialog').open, true);
  assert.equal(t.active(), t.get('season2DialogTitle'));
  t.h.advanceTo(midnight + 1000);
  assert.equal(t.get('season2Dialog').open, true);
  t.click('season2Start');
  assert.equal(t.get('season2Dialog').open, false);
  assert.equal(t.active(), t.get('firstChoice'));
  assert.equal(t.get('subjects').scrolled, true);
  assert.deepEqual(t.h.writes, []);
});

test('first modal waits for normal home, closes with Escape, and can be replayed', () => {
  const store = new Map();
  const t = setup(midnight + 1000, { store, welcome: true });
  assert.equal(t.get('season2Dialog').open, false);
  t.get('subjects').classList.add('hidden');
  t.body.classList.remove('welcome-active');
  t.notify();
  assert.equal(t.get('season2Opening').hidden, true);
  t.get('xpCelebrationOverlay').classList.add('open');
  t.get('subjects').classList.remove('hidden');
  t.notify();
  assert.equal(t.get('season2Dialog').open, false);
  t.get('xpCelebrationOverlay').classList.remove('open');
  t.notify();
  assert.equal(t.get('season2Dialog').open, true);
  const escape = new Event('cancel', { cancelable: true });
  t.get('season2Dialog').dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(t.get('season2Dialog').open, false);
  assert.equal(t.active(), t.get('season2Replay'));
  const reload = setup(midnight + 1000, { store });
  assert.equal(reload.get('season2Dialog').open, false);
  reload.click('season2Replay');
  assert.equal(reload.get('season2Dialog').open, true);
  assert.equal(reload.get('season2Achievement').children.length, 0);
  assert.equal(reload.get('season2HistoryLink').href, './ranking.html#seasonHistory');
});

test('unpublished or inaccessible achievements never block opening, and saved badges keep their real rank', async () => {
  const t = setup(midnight + 1000, { loggedIn: true });
  await turn();
  assert.equal(t.get('season2Dialog').open, true);
  assert.equal(t.get('season2Achievement').children.length, 0);
  const original = t.h.api.seasonAchievement.bind(t.h.api);
  t.h.api.seasonAchievement = async () => { throw Error('permission denied'); };
  t.click('season2Close');
  t.click('season2Replay');
  await turn();
  assert.equal(t.get('season2Dialog').open, true);
  assert.equal(t.get('season2Achievement').children.length, 0);

  t.h.api.seasonAchievement = original;
  t.h.data.seasonAchievements = { '2026-S3': { students: { [t.h.uid]: {
    seasonId: '2026-S3', finalRankTier: 'Radiant', badgeType: 'radiant_top10',
    finalPosition: 3, seasonXp: 12123, studyDays: 19, createdAt: midnight + 1000,
  } } } };
  t.click('season2Close');
  t.click('season2Replay');
  await turn();
  const [card] = t.get('season2Achievement').children;
  const [emblem, details] = card.children;
  assert.equal(emblem.classList.contains('season-badge-special'), true);
  assert.equal(emblem.classList.contains('finish-3'), true);
  assert.equal(emblem.children[1].textContent, '3');
  assert.match(details.children[1].textContent, /12,123 XP/);
});

test('no launch presentation in earlier seasons or after SEASON 2 ends', () => {
  for (const at of [Date.parse('2026-08-01T00:00:00+09:00'), Date.parse('2027-02-26T00:00:00+09:00')]) {
    const t = setup(at);
    t.click('season2Replay');
    assert.equal(t.get('season2Opening').hidden, true);
    assert.equal(t.get('season2Dialog').open, false);
  }
});
