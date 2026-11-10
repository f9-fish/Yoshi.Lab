"""Local static routes only; no Google/Firebase/Apps Script or other external traffic."""
import json,mimetypes,re,sys
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
data=json.loads((Path(sys.argv[1]) if len(sys.argv)>1 else root/'wordbook.json').read_text())
examples={e['japanese']:e for w in data['words'] if w['stage']=='STAGE1' and w['unit']=='Unit1' for e in w['examples']}
words={w['practiceMeaning']:w for w in data['words'] if w['stage']=='STAGE1' and w['unit']=='Unit1'}
def routes(payload=None,fail=False):
 def route(r):
  u=urlparse(r.request.url)
  if u.hostname!='local.test':r.abort();return
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
  context=browser.new_context(viewport={'width':width,'height':950});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',routes())
  page.goto('https://local.test/index.html?view=subjects');page.evaluate("document.getElementById('welcomeCover')?.remove();document.body.classList.add('home-dashboard');")
  assert page.locator('#subjects .subject-grid>.choice,#subjects .subject-grid>.eiken-home-link').count()==5
  home=page.locator('#subjects .subject-grid>.wordbook-home-link');home.scroll_into_view_if_needed();assert home.is_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');home.screenshot(path=f'/tmp/wordbook-home-{width}.png');page.locator('#subjects .subject-grid').screenshot(path=f'/tmp/wordbook-home-grid-{width}.png');
  if width>1100:
   boxes=page.locator('#subjects .subject-grid>.choice,#subjects .subject-grid>.eiken-home-link').evaluate_all('(nodes)=>nodes.map(n=>({top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height}))');assert max(b['top'] for b in boxes)-min(b['top'] for b in boxes)<2;assert max(b['height'] for b in boxes)-min(b['height'] for b in boxes)<2
  assert 'wordbook-card.svg' in home.evaluate('el=>getComputedStyle(el).backgroundImage')
  if width<=700:assert 'wordbook-card.svg' in home.evaluate("el=>getComputedStyle(el,'::before').backgroundImage")
  home.click()
  page.locator('#wbStageList button').filter(has_text='STAGE1').wait_for();assert page.locator('#wbStageList button:disabled').count()==sum(not any(w['stage']==s for w in data['words']) for s in ['STAGE0','STAGE1','STAGE2','STAGE3'])
  assert page.locator('#wbReload,#wbBack').count()==0
  assert page.locator('#wbStages').evaluate('el=>getComputedStyle(el).borderTopStyle')=='solid'
  page.locator('#wbStages').screenshot(path=f'/tmp/wordbook-stages-{width}.png')
  for stage in ['STAGE0','STAGE1','STAGE2','STAGE3']:
   if not any(w['stage']==stage for w in data['words']):continue
   page.locator('#wbStageList button').filter(has_text=stage).click()
   assert page.locator('#wbRangeStart').is_disabled()
   assert ''.join(page.locator('#wbRangeStart').inner_text().split())=='次へ→'
   assert page.locator('#wbUnits').evaluate('el=>getComputedStyle(el).borderTopStyle')=='solid'
   buttons=page.locator('#wbUnitList button');n=buttons.count()
   assert re.match(r'^(Part|Unit) \d+',buttons.first.locator('strong').inner_text())
   for i in range(min(3,n)):buttons.nth(i).click()
   assert page.locator('#wbUnitList button[aria-pressed="true"]').count()==min(3,n)
   if stage=='STAGE0':page.locator('#wbUnits').screenshot(path=f'/tmp/wordbook-range-{width}.png')
   page.locator('#wbRangeStart').click();page.locator('#wbUnitNav').click()
   assert page.locator('#wbUnitList button[aria-pressed="true"]').count()==min(3,n)
   page.locator('#wbSelectAll').click();assert page.locator('#wbUnitList button[aria-pressed="true"]').count()==n
   page.locator('#wbRangeStart').click();page.locator('#wbModeList button').filter(has_text='スペリング').click()
   assert page.locator('#wbCount').inner_text()=='1 / 10問'
   page.locator('#wbFinish').click();page.locator('#wbChoose').click();page.locator('#wbUnitNav').click()
   page.locator('#wbClearUnits').click();assert page.locator('#wbRangeStart').is_disabled()
   page.locator('#wbStageNav').click()
  page.locator('#wbStageList button').filter(has_text='STAGE1').click();page.locator('#wbUnitList').get_by_role('button',name=re.compile(r'^Unit 1\s')).click();page.locator('#wbRangeStart').click()
  page.locator('#wbModeList').screenshot(path=f'/tmp/wordbook-mode-grid-{width}.png')
  for mode,label in [('choice','単語4択'),('spelling','スペリング'),('reorder','文章並び替え')]:
   page.locator('#wbModeList button').filter(has_text=label).click();page.locator('#wbQuiz').wait_for(state='visible')
   for index in range(2):
    prompt=page.locator('#wbPrompt').inner_text()
    if mode=='choice':
     correct=words[prompt]['word'];buttons=page.locator('#wbChoices button');assert buttons.count()==4;assert page.locator('#wbChoices .choice-meaning:visible').count()==0
     if index==0:button=page.locator('#wbChoices').get_by_role('button',name=correct,exact=True)
     else:button=next(buttons.nth(i) for i in range(4) if buttons.nth(i).locator('span').first.inner_text()!=correct)
     button.click();assert page.locator('#wbChoices .choice-meaning:visible').count()==4
    elif mode=='spelling':
     assert page.locator('#wbSubmit').is_disabled();page.locator('#wbInput').fill(words[prompt]['word'].upper() if index==0 else 'wrong-fixture-answer');page.locator('#wbSubmit').click()
    else:
     reset=page.locator('#wbUndo').bounding_box();submit=page.locator('#wbSubmit').bounding_box()
     assert abs(reset['y']-submit['y'])<2 and submit['x']-(reset['x']+reset['width'])>=12
     sentence=examples[prompt]['english'];tokens=sentence.split();assert page.locator('#wbSubmit').is_disabled()
     if index==0:
      page.locator('#wbTokens button').first.click();page.locator('#wbSelected button').first.click();assert page.locator('#wbSelected button').count()==0
      page.locator('#wbTokens button').first.click();page.locator('#wbUndo').click();assert page.locator('#wbSelected button').count()==0
     else:tokens[0],tokens[1]=tokens[1],tokens[0]
     for token in tokens:page.locator('#wbTokens button:enabled').filter(has_text=re.compile('^'+re.escape(token)+'$')).first.click()
     page.locator('#wbSubmit').click()
    page.locator('#wbFeedback').wait_for(state='visible');assert page.locator('#wbJudgment').inner_text()==('正解！' if index==0 else '不正解');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    if index==0:page.screenshot(path=f'/tmp/wordbook-{mode}-{width}.png',full_page=True);page.locator('#wbNext').click()
   page.locator('#wbFinish').click();page.locator('#wbResult').wait_for(state='visible');assert '2問解答 / 正解 1問' in page.locator('#wbSummary').inner_text();assert page.locator('#wbReview article').count()==2;page.locator('#wbChoose').click()
  assert not errors,errors;context.close();print('PASS',width,'HOME, three modes, correct/wrong, duplicate-safe reorder, undo, partial results, no overflow',flush=True)
 for payload in [{'schemaVersion':1,'words':[]},{'bad':'format'}]:
  context=browser.new_context(viewport={'width':390,'height':850});page=context.new_page();page.route('**/*',routes(payload));page.goto('https://local.test/wordbook.html');page.wait_for_function('document.getElementById("wbStatus").getAttribute("aria-busy")==="false"');text=page.locator('#wbStatus').inner_text();assert ('公開中の単語がありません' in text if 'words' in payload else '読み込めません' in text);context.close()
 context=browser.new_context();page=context.new_page();page.route('**/*',routes(fail=True));page.goto('https://local.test/wordbook.html');page.wait_for_function('document.getElementById("wbStatus").getAttribute("aria-busy")==="false"');assert '読み込めません' in page.locator('#wbStatus').inner_text();page.unroute('**/*');page.route('**/*',routes());page.reload();page.locator('#wbStageList button:enabled').first.wait_for();context.close();print('PASS empty, malformed data, network failure and retry',flush=True)
 browser.close()
