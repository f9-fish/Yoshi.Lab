/* Home presentation for the existing 2026-S4 season. No XP or history writes. */
(() => {
 const get = id => document.getElementById(id);
 const banner = get('season2Opening'), dialog = get('season2Dialog'), subjects = get('subjects');
 const replay = get('season2Replay'), result = get('season2Achievement'), history = get('season2HistoryLink');
 const xpOverlay = get('xpCelebrationOverlay');
 const seenKey = 'yoshilab:opening:2026-S4';
 let opened = false, request = 0, returnFocus;

 function seen() {
  try { return opened || localStorage.getItem(seenKey) === '1'; }
  catch { return opened; }
 }

 function showResult() {
  const serial = ++request;
  result.replaceChildren();
  history.href = './ranking.html#seasonHistory';
  if (!dialog.open) return;
  const account = window.YoshiAccount;
  const uid = account?.user?.uid;
  if (!uid || !account.seasonAchievement) return;
  account.seasonAchievement().then(record => {
   if (serial !== request || !dialog.open || account.user?.uid !== uid || record?.seasonId !== '2026-S3') return;
   if (!Number.isFinite(record.seasonXp) || !window.YoshiSeasonAchievements) return;
   window.YoshiSeasonAchievements.renderProfile(result, record);
   if (result.firstElementChild) history.href = './mypage.html#mySeasonAchievements';
  }).catch(() => {
   // The opening remains available when the achievement is unpublished or unreadable.
  });
 }

 function openMessage(trigger) {
  if (banner.hidden || dialog.open || !dialog.showModal) return;
  returnFocus = trigger;
  dialog.showModal();
  get('season2DialogTitle').focus({ preventScroll: true });
  opened = true;
  try { localStorage.setItem(seenKey, '1'); } catch { /* This page still opens it only once. */ }
  showResult();
 }

 function closeMessage() {
  if (!dialog.open) return;
  dialog.close();
  showResult();
  if (!banner.hidden) returnFocus?.focus({ preventScroll: true });
 }

 function goToSubjects() {
  closeMessage();
  subjects.querySelector('.choice')?.focus({ preventScroll: true });
  subjects.scrollIntoView({ block: 'start' });
 }

 function refresh() {
  const active = window.YoshiAccount?.getSeason?.()?.id === '2026-S4';
  banner.hidden = !active || subjects.classList.contains('hidden');
  if (banner.hidden) { closeMessage(); return; }
  if (!seen() && !document.hidden && !document.body.classList.contains('welcome-active') &&
      !xpOverlay.classList.contains('open')) openMessage(replay);
 }

 get('season2Challenge').addEventListener('click', goToSubjects);
 get('season2Start').addEventListener('click', goToSubjects);
 replay.addEventListener('click', () => openMessage(replay));
 get('season2Close').addEventListener('click', closeMessage);
 dialog.addEventListener('cancel', event => { event.preventDefault(); closeMessage(); });
 document.addEventListener('yoshi-season-change', refresh);
 document.addEventListener('yoshi-auth-ready', () => {
  const wasOpen = dialog.open;
  refresh();
  if (wasOpen && dialog.open) showResult();
 });
 document.addEventListener('visibilitychange', refresh);
 window.addEventListener('pageshow', refresh);
 get('homeAccountModule').addEventListener('load', refresh);
 const observer = new MutationObserver(refresh);
 for (const element of [document.body, subjects, xpOverlay]) {
  observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
 }
 refresh();
})();
