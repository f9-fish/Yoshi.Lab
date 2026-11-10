"""Ranking class labels: local fixtures, all external requests blocked."""
import json,mimetypes
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
board={f's{i}':{'name':f'架空生徒{i:02}','classNumber':i%5+1,'seasonId':'current','seasonXP':13000-i,'weeklyXP':1000-i,'totalXP':20000-i} for i in range(12)}
def route(r):
 u=urlparse(r.request.url)
 if u.hostname!='local.test':r.abort();return
 if u.path=='/account.js':
  r.fulfill(content_type='text/javascript',body='const board='+json.dumps(board,ensure_ascii=False)+";window.YoshiAccount={user:{uid:'s0'},subscribe(fn){fn(this.user);},getSeason(){return {id:'current',label:'SEASON 1',start:'2026-10-01',end:'2026-11-27'};},getSeasons(){return [];},async profile(){return {classNumber:1};},async syncXP(){},async records(){return [];},async leaderboard(){return board;}};document.dispatchEvent(new Event('yoshi-auth-ready'));");return
 f=(root/unquote(u.path).lstrip('/')).resolve()
 if f.is_relative_to(root) and f.is_file():r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
 else:r.fulfill(status=404,body='missing')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [320,390,1280]:
  ctx=browser.new_context(viewport={'width':width,'height':950});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',route);page.goto('https://local.test/ranking.html')
  page.locator('#radiantRows .student-class').first.wait_for()
  def check():
   for selector in ['#radiantRows .student-name','#podium .name','#rankList .student-name']:
    for name in page.locator(selector).all():
     text=name.inner_text();i=int(text.split('架空生徒')[1][:2]);assert name.locator('.student-class').inner_text()==str(i%5+1)+'組'
     assert name.locator('.student-class').evaluate('el=>parseFloat(getComputedStyle(el).fontSize)')<=11
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.locator('#rankAll').click();check();assert page.locator('#radiantRows .student-class').count()==10;assert page.locator('#podium .student-class').count()==3;assert page.locator('#rankList .student-class').count()==7
  page.screenshot(path=f'/tmp/ranking-class-{width}.png',full_page=True)
  page.locator('#rankAll').click()
  for period in ['rankWeek','rankTotal','rankSeason']:page.locator('#'+period).click() if page.locator('#'+period).is_visible() else None;check()
  page.locator('#rankClass').click();check();assert all(t=='1組' for t in page.locator('#podium .student-class').all_text_contents())
  assert not errors,errors;ctx.close();print('PASS',width,'radiant, podium, lists, class/all scopes and XP periods')
 browser.close()
