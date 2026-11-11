"""Offline production-studio integration checks; all external requests mocked/blocked."""
from pathlib import Path
from urllib.parse import urlparse,unquote
import json,mimetypes,re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
questions={'vocabulary':[{'question':'ocean','answer':'海','translation':'海の意味'}],'cloze':[{'question':'We (protect) the ocean.','answer':'私たちは海を守る。','translation':'protectは守る'}],'qa':[{'question':'What do we protect?','answer':'The ocean.','translation':'何を守りますか'}],'trueFalse':[{'question':'We protect the ocean.','answer':'True','translation':'本文の内容と一致'}],'discussion':[{'question':'How can you help?','answer':'I collect rubbish.','translation':'どう協力できますか'}]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [390,1366]:
  context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();calls=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   u=urlparse(r.request.url)
   if u.hostname=='studioapi-bfaa4wjjga-an.a.run.app':
    calls.append(u.path)
    if u.path=='/generate':r.fulfill(json={'questions':questions})
    elif u.path=='/preview':r.fulfill(json={'slot':'英C / TEST / 1','newCount':5,'previousCount':0,'replacing':False,'sha':'mock-sha'})
    elif u.path=='/publish':
     assert r.request.post_data_json['expectedSha']=='mock-sha'
     r.fulfill(json={'url':'mock-commit'})
    else:raise AssertionError(u.path)
    return
   if u.hostname=='www.gstatic.com':
    assert u.path.endswith('/firebase-auth.js');r.fulfill(content_type='text/javascript',body='export const getAuth=()=>({currentUser:window.YoshiAccount.user});');return
   if u.hostname!='local.test':r.abort();return
   if u.path=='/account.js':
    r.fulfill(content_type='text/javascript',body="""const fns=[];window.YoshiAccount={user:null,teacher:true,subscribe(fn){fns.push(fn);fn(this.user)},async login(){this.user={uid:'mock-teacher',getIdToken:async()=>'mock-token'};for(const fn of fns)await fn(this.user)},async logout(){this.user=null;for(const fn of fns)await fn(null)},async isTeacher(){return !!this.user&&this.teacher}};""");return
   if u.path=='/studio-content.json':
    r.fulfill(json=[{'subject':'英C','id':'TEST','name':'1','questions':questions}]);return
   path=(root/unquote(u.path).lstrip('/')).resolve()
   if not path.is_relative_to(root) or not path.is_file():r.fulfill(status=404,body='missing');return
   r.fulfill(body=path.read_bytes(),content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
  page.route('**/*',route)
  page.goto('https://local.test/teacher-studio.html');page.wait_for_function('!!window.YoshiAccount')
  assert page.locator('#editor').is_hidden()
  page.evaluate('window.YoshiAccount.login()');page.locator('#editor').wait_for(state='visible')
  page.locator('#lesson').fill('TEST');page.locator('#source').fill('We protect the ocean.');page.locator('#count').fill('1')
  page.evaluate("document.getElementById('generate').click();document.getElementById('generate').click()")
  page.locator('.question').first.wait_for();assert calls==['/generate'];assert page.locator('.category').count()==5
  page.locator('.question textarea').first.fill('Edited ocean');page.locator('#save').click();page.reload();page.wait_for_function('!!window.YoshiAccount');page.evaluate('window.YoshiAccount.login()');page.locator('#restore').click()
  page.locator('.question').first.wait_for();assert page.locator('.question textarea').first.input_value()=='Edited ocean'
  def cancel(dialog):dialog.dismiss()
  page.on('dialog',cancel);page.locator('#publish').click();page.wait_for_function("document.getElementById('publishStatus').textContent==='公開を取り消しました'");assert calls==['/generate','/preview']
  page.remove_listener('dialog',cancel);page.once('dialog',lambda d:d.accept());page.locator('#publish').click();page.wait_for_function("document.getElementById('publishStatus').textContent.includes('mock-commit')");assert calls[-2:]==['/preview','/publish']
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=f'/tmp/studio-production-teacher-{width}.png',full_page=True)
  page.evaluate('window.YoshiAccount.logout()');assert page.locator('#review').is_hidden();assert page.locator('#publishPanel').is_hidden()
  page.evaluate('window.YoshiAccount.teacher=false;window.YoshiAccount.login()');assert page.locator('#editor').is_hidden()
  page.goto('https://local.test/studio-study.html');page.wait_for_function("document.getElementById('unit').options.length===1")
  for kind in questions:
   page.locator('#type').select_option(kind);page.locator('#start').click();page.locator('#practice').wait_for(state='visible')
   if kind=='cloze':assert '(protect)' not in page.locator('#prompt').inner_text()
   if kind=='trueFalse':page.locator('#inputArea button').first.click();assert '正解' in page.locator('#feedback').inner_text()
   else:page.locator('#reveal').click()
   assert page.locator('#answer').is_visible();page.locator('#next').click();assert page.locator('#practice').is_hidden()
  page.locator('#subject').select_option('論表');assert page.locator('#start').is_disabled();assert page.locator('#unit option').count()==0
  page.locator('#subject').select_option('英C');page.locator('#start').click();page.locator('#type').select_option('qa');assert page.locator('#practice').is_hidden()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.locator('#start').click();page.screenshot(path=f'/tmp/studio-production-study-{width}.png',full_page=True)
  # No student-side API/record writes: only the four mocked teacher requests above.
  assert calls==['/generate','/preview','/preview','/publish'];assert not errors,errors
  context.close();print('PASS',width,'teacher auth, generation, edit, draft, publish cancel/confirm (mock), logout; student five types, subjects, filters, no XP writes',flush=True)
 browser.close()
