/* Render saved achievements independently of the active standings. */
window.YoshiSeasonAchievements = (() => {
 const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Radiant'];

 function badge(record, compact = false) {
  const tier = record?.finalRankTier;
  if (!tiers.includes(tier)) return null;
  const position = record.finalPosition;
  const special = tier === 'Radiant' && record.badgeType === 'radiant_top10' &&
   Number.isInteger(position) && position >= 1 && position <= 10;
  const element = document.createElement('span');
  const label = special ? 'TOP 10 RADIANT #' + position : 'SEASON 1 ' + tier;
  element.className = 'season-badge tone-' + tier.toLowerCase();
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  element.title = label;
  if (compact) element.classList.add('season-badge-compact');
  if (special) element.classList.add('season-badge-special', 'finish-' + Math.min(position, 4));

  const icon = document.createElement('span');
  icon.className = 'season-badge-icon';
  icon.textContent = special ? (position === 1 ? '♛' : '★') : '◆';
  const center = document.createElement('strong');
  center.className = 'season-badge-center';
  center.textContent = special ? String(position) : (compact ? tier[0] : tier);
  const ribbon = document.createElement('span');
  ribbon.className = 'season-badge-ribbon';
  ribbon.textContent = 'SEASON 1';
  element.append(icon, center, ribbon);
  return element;
 }

 function renderProfile(container, record) {
  container.replaceChildren();
  const emblem = badge(record);
  if (!emblem) return;
  const card = document.createElement('article');
  card.className = 'season-achievement-card';
  const details = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = '2026年後期 SEASON 1';
  const stats = document.createElement('p');
  stats.textContent = record.finalRankTier + '・最終 ' + record.finalPosition + ' 位・' +
   record.seasonXp.toLocaleString('ja-JP') + ' XP・学習 ' + record.studyDays + ' 日';
  const date = document.createElement('small');
  date.textContent = '確定日時 ' + new Date(record.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' JST';
  details.append(title, stats, date);
  card.append(emblem, details);
  container.append(card);
 }

 function renderTop(container, records) {
  container.replaceChildren();
  if (!records) return;
  const list = document.createElement('ol');
  list.className = 'season-achievement-top';
  for (const record of Object.values(records).filter(Boolean).sort((a, b) => a.finalPosition - b.finalPosition)) {
   const emblem = badge(record);
   if (!emblem) continue;
   const item = document.createElement('li');
   const name = document.createElement('span');
   name.textContent = record.name;
   item.value = record.finalPosition;
   item.append(emblem, name);
   list.append(item);
  }
  container.append(list);
 }

 return { badge, renderProfile, renderTop };
})();
