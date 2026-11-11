"""Static HOME layout: scripts removed and external traffic blocked."""
import mimetypes,re
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
def route(r):
 u=urlparse(r.request.url)
 if u.hostname!='local.test':r.abort();return
 f=(root/unquote(u.path).lstrip('/')).resolve()
 if not f.is_relative_to(root) or not f.is_file():r.fulfill(status=404,body='missing');return
 body=f.read_bytes()
 if f.name=='index.html':body=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',body.decode(),flags=re.I).encode()
 r.fulfill(body=body,content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [320,390,700,768,1024,1101,1280,1600]:
  ctx=browser.new_context(viewport={'width':width,'height':950});page=ctx.new_page();page.route('**/*',route);page.goto('https://local.test/index.html?view=subjects');page.evaluate("document.getElementById('welcomeCover')?.remove();document.body.classList.add('home-dashboard');")
  cards=page.locator('#subjects .subject-grid>.choice');assert cards.count()==5
  title=page.locator('.writing-home-link .growth-subject-name');assert title.inner_text()=='英作文対策'
  assert title.evaluate("el=>{const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length===1;}")
  assert title.evaluate('el=>el.scrollWidth<=el.closest(".choice").clientWidth')
  eiken=page.locator('.eiken-subject-link');assert eiken.get_attribute('href')=='./eiken.html';assert eiken.locator('.growth-subject-name').inner_text()=='英検対策';assert '7 XP/問' in eiken.inner_text()
  assert 'home-training-triptych.png' in eiken.evaluate("el=>getComputedStyle(el,'::before').backgroundImage")
  assert eiken.evaluate("el=>getComputedStyle(el,'::before').backgroundPosition").endswith('100% 30%' if width<=700 else '100% 0%')
  first=cards.first;assert eiken.evaluate('el=>getComputedStyle(el).borderRadius')==first.evaluate('el=>getComputedStyle(el).borderRadius')
  assert abs(eiken.bounding_box()['height']-first.bounding_box()['height'])<2
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width in [390,1280]:page.locator('#subjects .subject-grid').screenshot(path=f'/tmp/home-training-cards-{width}.png')
  ctx.close();print('PASS',width,'single-line writing title, shared EIKEN card and original artwork',flush=True)
 browser.close()
