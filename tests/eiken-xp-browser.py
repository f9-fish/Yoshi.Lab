"""EIKEN V3 XP browser checks; all Firebase calls are replaced, all external traffic blocked."""
import json,mimetypes,re
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
def route(r):
 u=urlparse(r.request.url)
 if u.hostname!='local.test':r.abort();return
 if u.path=='/account.js':
  r.fulfill(content_type='text/javascript',body="""import './practice-xp.js';const rows={};window.YoshiAccount={user:{uid:'test-student'},authReady:true,subscribe(fn){fn(this.user);},async saveEikenResult(p){return rows[p.sessionId]??=( {...p,subject:'英検',lesson:p.grade,xpMode:'eikenChoice'});},async syncXP(){return {totalXP:Object.values(rows).reduce((n,r)=>n+YoshiPracticeXP.recordXP(r),0)};}};document.dispatchEvent(new Event('yoshi-auth-ready'));""");return
 f=(root/unquote(u.path).lstrip('/')).resolve()
 if not f.is_relative_to(root) or not f.is_file():r.fulfill(status=404,body='missing');return
 r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [320,390,1280]:
  for grade,file in [('pre2','eiken_pre2.json'),('2','eiken_2.json')]:
   ctx=browser.new_context(viewport={'width':width,'height':950});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',route)
   data=json.loads((root/file).read_text());by_sentence={q['sentence']:q for q in data}
   page.goto('https://local.test/eiken.html');page.wait_for_function('window.YoshiAccount?.authReady');page.locator(f'[data-grade="{grade}"]').click();page.locator('#start').wait_for(state='visible');page.wait_for_function('!document.getElementById("start").disabled');page.locator('#start').click()
   for i in range(10):
    q=by_sentence[page.locator('#sentence').inner_text()];page.locator('#choices button').nth(q['answer']-1).click();page.locator('#next').click()
   page.wait_for_function("document.getElementById('resultXP').textContent==='獲得 +70 XP'")
   page.locator('#xpCelebrationOverlay.open').wait_for();assert page.locator('#xpCelebrationEarned').inner_text()=='+70 XP';assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=f'/tmp/eiken-xp-{grade}-{width}.png',full_page=True);assert not errors,errors;ctx.close();print('PASS',width,grade,'7 XP / 70 XP completion and popup',flush=True)
 browser.close()
