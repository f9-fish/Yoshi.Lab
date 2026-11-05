const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness, dailyHarness, context, functionFromLine, read } = require('./helpers/app-harness.cjs');
const vm = require('node:vm');
const sunday = Date.parse('2026-11-08T23:00:00+09:00');
const completed = (date, overrides = {}) => ({ dailyV1: true, dailyCompleted: true,
  dailyAttemptStarted: true, dailySubject: 'ec', dailyDate: date, total: 10, right: 0,
  dailyDeltaXP: 0, createdAt: Date.parse(date+'T12:00:00+09:00'), ...overrides });
const rowsFor = count => Array.from({length: count}, (_, i) => completed('2026-11-'+String(i+2).padStart(2,'0')));
const store = rows => Object.fromEntries(rows.map((r,i)=>['fixture'+i,r]));
const helper = vm.runInContext('YoshiWeeklyDaily', context());

test('all account pages load the shared weekly calculator before application scripts', () => {
  for(const file of ['index.html','daily.html','mypage.html','teacher.html','ranking.html']){
    const html=read(file),shared=html.indexOf('<script src="./weekly-daily.js?v=1"></script>');
    assert.ok(shared>=0,file);
    assert.ok(shared<html.indexOf('<script type="module" src="./account.js'),file);
    assert.equal(html.split('<script src="./weekly-daily.js?v=1"></script>').length,2,file);
  }
});

for (const [count, bonus] of [[1,0],[2,0],[3,100],[4,100],[5,300],[6,300],[7,800]]) {
  test(`weekly Daily ${count}/7 days -> ${bonus} bonus XP, consistent across views`, async () => {
    const rows=rowsFor(count),before=structuredClone(rows);
    const h=accountHarness({now:sunday,records:store(rows)});
    const result=await h.api.syncXP();
    assert.equal(result.totalXP,bonus);assert.equal(result.weeklyXP,bonus);assert.equal(result.seasonXP,bonus);
    assert.deepEqual(await h.api.syncXP(),result,'Repeated sync must not grant another bonus');
    const weekly=h.evaluate('YoshiWeeklyDaily');
    const teacher=functionFromLine('teacher.html','xpFromRecords',{YoshiWeeklyDaily:weekly});
    const history=functionFromLine('ranking.html','historicalSeasonXP',{
      YoshiWeeklyDaily:weekly,recordXP:functionFromLine('ranking.html','recordXP'),
    });
    assert.equal(teacher(rows),bonus);assert.equal(history(rows,h.api.getSeason()),bonus);
    assert.deepEqual(rows,before);
    assert.ok(h.writes.every(path=>path.startsWith('leaderboard/')||path.startsWith('lastAccess/')),
      'No reward records or new database paths should be written');
  });
}

test('multiple attempts/subjects on one day count once and rewards stay deterministic', () => {
  const rows=rowsFor(7).flatMap(r=>[r,{...r,dailySubject:'rp'},{...r}]);
  assert.equal(helper.progress(rows,sunday).count,7);
  assert.equal(helper.bonuses(rows,sunday).reduce((n,b)=>n+b.xp,0),800);
  assert.deepEqual(helper.bonuses([...rows].reverse(),sunday),helper.bonuses(rows,sunday));
});

test('future, malformed, invalid, incomplete and non-Daily rows earn no progress', () => {
  const rows=[completed('2026-11-09'),completed('2026-11-31'),completed('bad'),
    completed('2026-11-02',{dailyCompleted:false}),completed('2026-11-03',{total:0}),
    completed('2026-11-04',{dailyV1:false}),completed('2026-11-05',{dailySubject:'invalid'}),
    completed('2026-11-06',{right:11})];
  assert.equal(helper.progress(rows,sunday).count,0);
  assert.equal(helper.bonuses(rows,sunday).length,0);
});

test('Monday JST resets display/weekly XP, retains earned total and season XP', async () => {
  const rows=rowsFor(7),now=Date.parse('2026-11-09T00:00:00+09:00');
  assert.equal(helper.progress(rows,now).count,0);
  assert.equal(helper.progress(rows,now-1).count,7);
  const result=await accountHarness({now,records:store(rows)}).api.syncXP();
  assert.equal(result.totalXP,800);assert.equal(result.weeklyXP,0);assert.equal(result.seasonXP,800);
});

test('year boundary stays in the same Monday-Sunday week', async () => {
  const rows=['2026-12-28','2026-12-30','2027-01-01'].map(d=>completed(d));
  const now=Date.parse('2027-01-01T01:00:00+09:00');
  assert.equal(helper.progress(rows,now).week,'2026-12-28');
  assert.equal(helper.progress(rows,now).count,3);
  const result=await accountHarness({now,records:store(rows)}).api.syncXP();
  assert.equal(result.weeklyXP,100);assert.equal(result.weekKey,'2026-W53');
});

test('each separate week earns its own milestones without retroactive pre-launch rewards', () => {
  const rows=[...rowsFor(7),...['09','10','11'].map(d=>completed('2026-11-'+d)),
    ...['26','27','28','29','30','31'].map(d=>completed('2026-10-'+d))];
  const rewards=helper.bonuses(rows,Date.parse('2026-11-11T23:00:00+09:00'));
  assert.equal(rewards.reduce((n,b)=>n+b.xp,0),900);
});

test('bonuses belong to the season of their milestone date, even when a week crosses seasons', async () => {
  const rows=Array.from({length:7},(_,i)=>completed('2026-11-'+(23+i)));
  const now=Date.parse('2026-11-29T23:00:00+09:00'),h=accountHarness({now,records:store(rows)});
  const result=await h.api.syncXP();
  assert.equal(result.totalXP,800);assert.equal(result.weeklyXP,800);assert.equal(result.seasonXP,500);
  const history=functionFromLine('ranking.html','historicalSeasonXP',{
    YoshiWeeklyDaily:h.evaluate('YoshiWeeklyDaily'),recordXP:functionFromLine('ranking.html','recordXP'),
  });
  assert.equal(history(rows,h.api.getSeasons().find(s=>s.id==='2026-S3')),300);
});

test('third completed day refreshes UI and shows the extra 100 XP separately', async () => {
  const h=dailyHarness({records:store([completed('2026-11-02'),completed('2026-11-03')])});
  await h.ready();assert.equal(h.elements.get('dailyStreak').children[1].textContent,'🔥 2日 / 7日達成');
  await h.evaluate('start()');
  h.evaluate("index=9;answers=Array.from({length:10},()=>({ok:true,type:'word',prompt:'fixture',selected:'x',correct:'x'}));");
  await h.evaluate('next()');
  assert.equal(h.elements.get('dailyStreak').children[1].textContent,'🔥 3日 / 7日達成');
  assert.match(h.elements.get('dailyResultXP').textContent,/週間ボーナス \+100 XP/);
  assert.equal((await h.api.syncXP()).totalXP,600);
});
