"""Local static routes only; no Google/Firebase/Apps Script or other external traffic."""
import json,mimetypes,re,sys
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
data=json.loads((Path(sys.argv[1]) if len(sys.argv)>1 else root/'wordbook.json').read_text())
examples={e['japanese']:e for w in data['words'] if w['stage']=='STAGE1' and w['unit']=='Unit1' for e in w['examples']}
words={w['practiceMeaning']:w for w in data['words'] if w['stage']=='STAGE1' and w['unit']=='Unit1'}
def routes(payload=None,fail=False,auth=False,lose_ack=False):
 def route(r):
  u=urlparse(r.request.url)
  if u.hostname!='local.test':r.abort();return
  if u.path=='/account.js':
   mock="""const state=window.__wbMock={calls:0};const listeners=[];const a={authReady:true,user:AUTH?{uid:'mock-student'}:null,subscribe(fn){listeners.push(fn);fn(this.user);},async login(){this.user={uid:'mock-student'};listeners.forEach(fn=>fn(this.user));},async saveWordbookResult(p){state.calls++;const records=JSON.parse(localStorage.getItem('wbMockRecords')||'{}');const row=records[p.sessionId]||{...p,subject:'単語帳',lesson:p.stage,xpMode:'wordbook',xpPolicyV3:true};records[p.sessionId]=row;localStorage.setItem('wbMockRecords',JSON.stringify(records));if(LOSE&&!localStorage.getItem('wbMockAckLost')){localStorage.setItem('wbMockAckLost','true');throw Error('mock acknowledgement loss');}return row;},async syncXP(){if(window.__wbFailSync)throw Error('mock sync failure');const records=JSON.parse(localStorage.getItem('wbMockRecords')||'{}');return {totalXP:Object.values(records).reduce((n,r)=>n+YoshiPracticeXP.recordXP(r),0)};}};window.YoshiAccount=a;document.dispatchEvent(new Event('yoshi-auth-ready'));""".replace('AUTH','true' if auth else 'false').replace('LOSE','true' if lose_ack else 'false')
   r.fulfill(body=mock,content_type='text/javascript');return
  if u.path=='/wordbook.json':
   if fail:r.abort();return
   r.fulfill(body=json.dumps(payload if payload is not None else data,ensure_ascii=False),content_type='application/json');return
  path=(root/unquote(u.path).lstrip('/')).resolve()
  if not path.is_relative_to(root) or not path.is_file():r.fulfill(status=404,body='missing');return
  body=path.read_bytes()
  if path.name=='index.html':body=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',body.decode(),flags=re.I).encode()
  r.fulfill(body=body,content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
 return route
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [320,390,1280]:
  ctx=browser.new_context(viewport={'width':width,'height':1100 if width>760 else 950});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',routes(auth=True));page.goto('https://local.test/wordbook.html');page.wait_for_function('document.getElementById("wbStatus").getAttribute("aria-busy")==="false"')
  assert page.locator('#wbUnitNav').is_disabled() and page.locator('#wbMethodNav').is_disabled()
  assert page.locator('#wbStageList .quest-node').count()==4
  if width in [390,1280]:page.screenshot(path=f'/tmp/quest-stage-{width}.png',full_page=False)
  for stage in ['STAGE0','STAGE1','STAGE2','STAGE3']:
   all_units=sorted(set(w['unit'] for w in data['words'] if w['stage']==stage),key=lambda s:int(re.search(r'\d+',s).group()))
   page.locator(f'[data-stage="{stage}"]').click();assert page.locator('#wbRangeStart').is_disabled()
   assert page.locator('#wbSegments button').count()==(len(all_units)+9)//10
   assert page.locator('#wbUnitList button').count()==10
   first=all_units[0];page.locator(f'#wbUnitList button[data-unit="{first}"]').click()
   page.locator('#wbSegments button').nth(1).click();second=all_units[10];page.locator(f'#wbUnitList button[data-unit="{second}"]').click()
   assert '2範囲' in page.locator('#wbSelectedUnits').inner_text()
   page.locator('#wbListView').click();assert page.locator('#wbUnitList input:checked').count()==1
   page.locator('#wbUnitList input').nth(1).check();assert '3範囲' in page.locator('#wbSelectedUnits').inner_text()
   page.locator('#wbMapView').click();assert page.locator('#wbUnitList button[aria-pressed=true]').count()==2
   page.locator('#wbViewSelection').click();assert page.locator('#wbSelectionItems button').count()==3
   page.locator('#wbSelectionItems button').last.click();assert page.locator('#wbSelectionItems button').count()==2;page.keyboard.press('Escape')
   page.locator('#wbRangeStart').click();page.locator('#wbChangeUnits').click()
   assert page.locator('#wbSegments button').nth(1).get_attribute('aria-pressed')=='true'
   assert '2範囲' in page.locator('#wbSelectedUnits').inner_text()
   page.locator('#wbSelectAll').click();assert str(len(all_units))+'範囲' in page.locator('#wbSelectedUnits').inner_text()
   page.locator('#wbSegments button').last.click();assert page.locator('#wbUnitList button').count()==len(all_units)%10 or page.locator('#wbUnitList button').count()==10
   assert page.locator('#wbUnitList button[aria-pressed=true]').count()==page.locator('#wbUnitList button').count()
   page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
   page.wait_for_function("document.querySelector('#wbUnitList button:last-child').getBoundingClientRect().bottom<document.getElementById('wbRangeDock').getBoundingClientRect().top")
   page.locator('#wbClearUnits').click();assert page.locator('#wbRangeStart').is_disabled();assert page.locator('#wbMethodNav').is_disabled()
   # Return to stage and choose the same one: selection and segment remain intact.
   page.locator('#wbSegments button').first.click();page.locator(f'#wbUnitList button[data-unit="{first}"]').click();page.locator('#wbStageNav').click();page.locator(f'[data-stage="{stage}"]').click();assert '1範囲' in page.locator('#wbSelectedUnits').inner_text()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if stage=='STAGE0' and width in [390,1280]:
    page.locator('#wbUnitList button').nth(1).click();page.locator('#wbUnitList button').nth(3).click();page.evaluate('window.scrollTo(0,0)');page.screenshot(path=f'/tmp/quest-range-{width}.png',full_page=False)
    page.locator('#wbRangeStart').click();page.evaluate('window.scrollTo(0,0)');page.screenshot(path=f'/tmp/quest-method-{width}.png',full_page=False);page.locator('#wbChangeUnits').click()
   page.locator('#wbStageNav').click()
  # Stage switching clears the prior stage's ranges, and keyboard selection works.
  page.locator('[data-stage=STAGE0]').click();assert page.locator('#wbRangeStart').is_disabled()
  node=page.locator('#wbUnitList button').first;node.focus();page.keyboard.press('Space');assert node.get_attribute('aria-pressed')=='true';page.locator('#wbRangeStart').click()
  assert page.locator('#wbModeList .quest-method').count()==3;assert page.locator('#wbMethodNav').get_attribute('aria-current')=='step'
  page.locator('#wbChangeUnits').click();page.set_viewport_size({'width':width+30,'height':950})
  page.wait_for_function("Math.abs(document.querySelector('#wbRangeScene .quest-route').viewBox.baseVal.width-document.getElementById('wbRangeScene').clientWidth)<1")
  assert page.locator('#wbUnitList button[aria-pressed=true]').count()==1
  assert not errors,errors;ctx.close();print('PASS',width,'all stages, pagination, shared map/list selection, dock, dialog, backtracking, keyboard, screenshots',flush=True)
 browser.close()
