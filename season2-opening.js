const phases = {
 before: {
  title: '開幕まで 00:00:10', dateTime: '2026-11-27T23:59:50+09:00', time: '2026年11月27日 23:59:50 JST',
  notice: '開幕前カウントダウン', subtitle: '新シーズン、まもなく開幕。', dialogTitle: 'シーズン2 まもなく開幕',
 },
 opening: {
  title: 'SEASON 2 START', dateTime: '2026-11-28T00:00:00+09:00', time: '2026年11月28日 00:00 JST',
  notice: 'SEASON 2開幕直後', subtitle: '新シーズン、開幕。', dialogTitle: 'シーズン2 開幕！',
 },
 after: {
  title: 'SEASON 2', dateTime: '2026-12-05T00:00:00+09:00', time: '2026年12月5日 00:00 JST',
  notice: '開幕イベント終了後の表示例', subtitle: 'SEASON 2の学習へ', dialogTitle: 'シーズン2 開幕イベントの記録',
 },
};
const names = ['Radiant', 'Master', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze'];
const destinations = [
 ['button[data-subject="英C"]', './index.html?view=subjects#subjects'],
 ['button[data-subject="論表"]', './index.html?view=subjects#subjects'],
 ['a.writing-home-link', './writing.html'],
 ['a.eiken-subject-link', './eiken.html'],
 ['a.wordbook-home-link', './wordbook.html'],
];

const layout = `
 <aside class="preview-strip">
  <div><strong>TEACHER PREVIEW</strong><p>この画面は教員専用のデモです。実際の成績・ランキングは変更されません。</p></div>
  <a href="./index.html?view=subjects">通常画面に戻る</a>
 </aside>
 <main class="preview-home">
  <header class="preview-brand"><div data-home-brand></div><small>LEARN × LEVEL UP</small></header>
  <section class="opening-banner" aria-labelledby="openingHeading">
   <time data-clock datetime="2026-11-28T00:00:00+09:00"></time>
   <h1 id="openingHeading"></h1>
   <h2 data-banner-subtitle>新シーズン、開幕。</h2>
   <p data-banner-copy>シーズン1で積み上げた努力は、記録として残る。<br>そして今、新たな挑戦が始まる。</p>
   <div class="opening-actions"><button class="opening-primary" data-challenge>シーズン2に挑戦する</button><button data-record>シーズン1の記録を見る</button></div>
   <div class="opening-preview-result" data-result data-compact></div>
  </section>

  <section class="opening-panel" aria-labelledby="previewSubjects" id="previewSubjectsSection">
   <h2 id="previewSubjects" tabindex="-1"></h2>
   <p>科目・ペアワーク・ランキングのリンクを選ぶと、プレビューを終了して通常画面に移動します。</p>
   <div class="preview-subjects" data-subjects></div>
   <nav class="opening-actions" aria-label="通常ページ">
    <a href="./pair.html">ペアワーク <small>通常画面</small></a>
    <a href="./ranking.html">ランキング <small>通常画面</small></a>
   </nav>
  </section>

  <section class="opening-panel" aria-labelledby="previewRecordHeading">
   <h2 id="previewRecordHeading" tabindex="-1">シーズン1の記録</h2>
   <small data-record-phase></small>
   <div class="opening-result opening-result-card" data-result></div>
  </section>
  <aside class="opening-panel preview-announcement" aria-labelledby="openingNews">
   <h2 id="openingNews">お知らせ</h2><p data-announcement role="status"></p>
  </aside>
 </main>

 <div data-home-controls><details class="preview-controls">
  <summary>教員用プレビュー操作</summary>
  <div class="preview-control-body">
   <label>シーズン表示
    <select data-phase>
     <option value="before">開幕前カウントダウン</option>
     <option value="opening" selected>SEASON 2開幕直後</option>
     <option value="after">開幕イベント終了後</option>
    </select>
   </label>
   <fieldset><legend>モーダル</legend>
    <div class="opening-actions"><button data-show>表示</button><button data-dismiss>閉じる</button><button data-replay>もう一度再生</button></div>
   </fieldset>
   <label>バッジ
    <select data-variant>
     <option value="top1">Radiant 1位</option><option value="top2">Radiant 2位</option>
     <option value="top3">Radiant 3位</option><option value="top4">Radiant 4〜10位</option>
     <option value="Radiant">通常Radiant</option><option>Master</option><option>Diamond</option>
     <option>Platinum</option><option>Gold</option><option>Silver</option><option>Bronze</option>
    </select>
   </label>
   <div class="preview-numbers">
    <label>最終順位<input type="number" min="1" max="99999" step="1" data-position></label>
    <label>XP<input type="number" min="0" max="99999999" step="1" data-xp></label>
    <label>学習日数<input type="number" min="0" max="58" step="1" data-days></label>
   </div>
  </div>
 </details></div>

 <dialog id="seasonOpeningDialog" aria-labelledby="seasonOpeningTitle" aria-describedby="seasonOpeningIntro">
  <div class="opening-dialog-inner">
   <button class="opening-close" data-dismiss aria-label="開幕モーダルを閉じる">×</button>
   <p class="opening-eyebrow">SEASON 2 — A NEW CHALLENGE BEGINS</p>
   <h2 id="seasonOpeningTitle" tabindex="-1">シーズン2 開幕！</h2>
   <p id="seasonOpeningIntro">シーズン1、おつかれさまでした！<br>君が積み上げた努力は、記録として残ります。<br>新たなシーズンでも、さらなる高みを目指そう！</p>
   <div class="opening-result" data-result></div>
   <div class="opening-actions"><button data-record>記録バッジを見る</button><button class="opening-primary" data-challenge>シーズン2を始める</button></div>
   <p class="opening-return"><a href="./index.html?view=subjects">通常画面に戻る</a></p>
   <div data-dialog-controls></div>
  </div>
 </dialog>
`;

function appendSubjectIcon(link, source) {
 const icon = source.querySelector('svg');
 if (!icon) return;
 // Rebuild the decorative SVG with geometry attributes only. Home scripts and handlers stay inert.
 const namespace = 'http://www.w3.org/2000/svg';
 const svg = document.createElementNS(namespace, 'svg');
 svg.setAttribute('viewBox', icon.getAttribute('viewBox') || '0 0 64 64');
 svg.setAttribute('aria-hidden', 'true');
 svg.setAttribute('focusable', 'false');
 for (const part of icon.children) {
  if (!['path', 'circle'].includes(part.localName)) continue;
  const shape = document.createElementNS(namespace, part.localName);
  for (const attribute of ['d', 'cx', 'cy', 'r']) {
   if (part.hasAttribute(attribute)) shape.setAttribute(attribute, part.getAttribute(attribute));
  }
  svg.append(shape);
 }
 link.append(svg);
}

function populateHome(outlet, home) {
 const brand = home.querySelector('.home-brand-row .brand');
 const subjects = home.querySelector('#subjects');
 if (!brand || !subjects) throw Error('Home layout unavailable');
 const accent = document.createElement('span');
 accent.textContent = brand.querySelector('.brand-accent').textContent;
 outlet.querySelector('[data-home-brand]').append(brand.firstChild.textContent, accent);
 outlet.querySelector('#previewSubjects').textContent = subjects.querySelector('h2').textContent;
 const grid = outlet.querySelector('[data-subjects]');
 for (const [selector, href] of destinations) {
  const source = subjects.querySelector(selector);
  const label = source?.querySelector('.growth-subject-name')?.textContent;
  if (!label) continue;
  const link = document.createElement('a');
  link.href = href;
  const title = document.createElement('strong');
  title.textContent = label;
  const hint = document.createElement('small');
  hint.textContent = '通常画面で開く →';
  appendSubjectIcon(link, source);
  link.append(title, hint);
  grid.append(link);
 }
}

function renderResult(container, record) {
 const compact = container.hasAttribute('data-compact');
 const emblem = window.YoshiSeasonAchievements.badge(record, compact);
 const tier = record.finalRankTier.toUpperCase();
 const metric = record.finalPosition + '位 · ' + record.xp.toLocaleString('ja-JP') + ' XP · 学習 ' + record.days + '日';
 if (compact) {
  container.replaceChildren(emblem, tier + ' · ' + metric);
  return;
 }
 const frame = document.createElement('div');
 frame.className = 'opening-emblem' + (record.badgeType === 'radiant_top10' && record.finalPosition === 1 ? ' opening-champion' : '');
 frame.append(emblem);
 const stats = document.createElement('div');
 const season = document.createElement('span');
 season.className = 'opening-eyebrow';
 season.textContent = '2026 SEASON 1';
 const rank = document.createElement('strong');
 rank.className = 'opening-rank';
 rank.textContent = tier;
 const summary = document.createElement('p');
 const values = ['最終順位 ' + record.finalPosition + '位', record.xp.toLocaleString('ja-JP') + ' XP', '学習 ' + record.days + '日'];
 values.forEach((value, index) => {
  if (index) summary.append(' · ');
  const item = document.createElement('span');
  item.textContent = value;
  summary.append(item);
 });
 stats.append(season, rank, summary);
 container.replaceChildren(frame, stats);
}

export function mountSeasonOpening(outlet, home) {
 const view = document.createElement('template');
 view.innerHTML = layout;
 populateHome(view.content, home);
 outlet.replaceChildren(view.content);
 const find = selector => outlet.querySelector(selector);
 const dialog = find('dialog');
 const heading = find('#seasonOpeningTitle');
 const controls = find('.preview-controls');
 const homeControls = find('[data-home-controls]');
 const dialogControls = find('[data-dialog-controls]');
 const phase = find('[data-phase]');
 const variant = find('[data-variant]');
 const fields = {
  position: find('[data-position]'), xp: find('[data-xp]'), days: find('[data-days]'),
 };
 const state = { phase: 'opening', variant: 'top1', position: 1, xp: 12840, days: 48 };
 let returnFocus;
 let controlsWereOpen;

 function render() {
  const display = phases[state.phase];
  const clock = find('[data-clock]');
  clock.textContent = display.time;
  clock.dateTime = display.dateTime;
  find('.opening-banner').dataset.openingPhase = state.phase;
  find('#openingHeading').textContent = display.title;
  find('[data-banner-subtitle]').textContent = display.subtitle;
  find('[data-banner-copy]').hidden = state.phase === 'after';
  find('[data-announcement]').textContent = display.notice + 'をプレビューしています。';
  find('[data-record-phase]').textContent = '表示時点 ' + display.time;
  heading.textContent = display.dialogTitle;
  const special = state.variant.startsWith('top');
  const record = { finalRankTier: special ? 'Radiant' : state.variant, finalPosition: state.position,
   badgeType: special ? 'radiant_top10' : 'season_record', xp: state.xp, days: state.days };
  for (const container of outlet.querySelectorAll('[data-result]')) renderResult(container, record);
 }

 function open() {
  if (dialog.open) return;
  returnFocus = outlet.contains(document.activeElement) ? document.activeElement : find('[data-challenge]');
  controlsWereOpen = controls.open;
  controls.open = false;
  dialogControls.append(controls);
  dialog.showModal();
  heading.focus();
 }
 function close() {
  if (!dialog.open) return;
  dialog.close();
  homeControls.append(controls);
  controls.open = controlsWereOpen;
  returnFocus?.focus({ preventScroll: true });
 }
 dialog.addEventListener('cancel', event => {
  event.preventDefault();
  close();
 });
 function moveTo(target) {
  close();
  const element = find(target);
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'start' });
 }
 for (const button of outlet.querySelectorAll('[data-dismiss]')) button.onclick = close;
 for (const button of outlet.querySelectorAll('[data-challenge]')) button.onclick = () => moveTo('#previewSubjects');
 for (const button of outlet.querySelectorAll('[data-record]')) button.onclick = () => moveTo('#previewRecordHeading');
 find('[data-show]').onclick = open;
 find('[data-replay]').onclick = () => {
  if (!dialog.open) { open(); return; }
  controls.open = false;
  dialog.scrollTop = 0;
  heading.focus();
 };
 phase.onchange = () => { if (Object.hasOwn(phases, phase.value)) { state.phase = phase.value; render(); } };
 variant.onchange = () => {
  const value = variant.value;
  if (!names.includes(value) && !/^top[1-4]$/.test(value)) return;
  state.variant = value;
  if (value.startsWith('top')) {
   state.position = Number(value.slice(3));
   fields.position.value = state.position;
  }
  render();
 };
 for (const [key, input] of Object.entries(fields)) {
  input.value = state[key];
  input.oninput = () => {
   if (!Number.isInteger(input.valueAsNumber) || !input.validity.valid) return;
   state[key] = input.valueAsNumber;
   if (key === 'position' && state.variant.startsWith('top')) {
    state.variant = state.position > 10 ? 'Radiant' : 'top' + Math.min(state.position, 4);
    variant.value = state.variant;
   }
   render();
  };
  input.onchange = () => { input.value = state[key]; };
 }

 render();
 outlet.hidden = false;
 open();
 return () => {
  if (dialog.open) dialog.close();
  outlet.hidden = true;
  outlet.replaceChildren();
 };
}
