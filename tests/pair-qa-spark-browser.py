"""Run local helper server first. Requires Python Playwright + Chromium. Blocks all production hosts."""
import json,mimetypes,http.client,re
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
port=int(Path('/tmp/yoshi-spark-test-port').read_text())
resynced=False
def server(data):
 c=http.client.HTTPConnection('127.0.0.1',port,timeout=20);c.request('POST','/',json.dumps(data),{'Content-Type':'application/json'});r=c.getresponse();body=r.read();status=r.status;c.close();return status,body

def routes(uid):
 def route(r):
  u=urlparse(r.request.url)
  if u.hostname=='www.gstatic.com':
   name=u.path.rsplit('/',1)[-1]
   db='''const send=async(op,p,value,old)=>{const r=await fetch('/__db',{method:'POST',body:JSON.stringify({op,p,value,old})});const d=await r.json();if(d.error)throw Object.assign(Error(d.error),{code:d.error});return d;};
export const serverTimestamp=()=>Date.now(),getDatabase=()=>({}),ref=(_,p)=>({p}),get=async r=>{const d=await send('get',r.p);return {val:()=>d.value};},set=async(r,v)=>send('set',r.p,v),update=async(r,v)=>send('update',r.p,v),runTransaction=async(r,fn)=>{for(let i=0;i<10;i++){const old=(await send('get',r.p)).value,value=fn(old);if(value===undefined)return {committed:false};const d=await send('tx',r.p,value,old);if(!d.retry)return {committed:true,snapshot:{val:()=>d.value}};}throw Error('retry limit');},onValue=(r,fn,error)=>{if(r.p==='.info/serverTimeOffset'){fn({val:()=>0});return ()=>{};}let stopped=false,busy=false,last;const poll=async()=>{if(stopped||busy)return;busy=true;try{const d=await send('get',r.p),s=JSON.stringify(d.value);if(s!==last&&!stopped){last=s;fn({val:()=>d.value});}}catch(e){if(!stopped)error?.(e);}finally{busy=false;}};void poll();const timer=setInterval(poll,120);return ()=>{stopped=true;clearInterval(timer);};};'''
   scripts={'firebase-app.js':'export const initializeApp=(config,name)=>({name});','firebase-auth.js':f'const auth={{currentUser:{{uid:{json.dumps(uid)},isAnonymous:true}},authStateReady:async()=>{{}}}};export const getAuth=()=>auth,signInAnonymously=async()=>auth,onAuthStateChanged=()=>{{}},inMemoryPersistence="memory",browserSessionPersistence="session",setPersistence=async()=>{{}};','firebase-database.js':db}
   if name in scripts:r.fulfill(body=scripts[name],content_type='text/javascript');return
  if u.hostname!='local.test':r.abort();return
  if u.path=='/__db':
   data=json.loads(r.request.post_data);data['uid']=uid;status,body=server(data);r.fulfill(status=status,body=body,content_type='application/json');return
  if u.path=='/pair_text_qa.json' and resynced:r.fulfill(body='[]',content_type='application/json');return
  f=(root/unquote(u.path).lstrip('/')).resolve()
  if f.is_relative_to(root) and f.is_file():r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
  else:r.fulfill(status=404,body='missing')
 return route
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,rotation in [(320,'half'),(390,'one'),(1280,'two')]:
  resynced=False
  server({'op':'reset'});contexts=[];pages=[];errors=[]
  for uid in ['A','B']:
   context=browser.new_context(viewport={'width':width,'height':950});page=context.new_page();page.route('**/*',routes(uid));page.on('pageerror',lambda e:errors.append(str(e)));page.goto('https://local.test/pair.html');page.locator('#lobby').wait_for(state='visible');contexts.append(context);pages.append(page)
  A,B=pages
  B.locator('#stepChoices button').filter(has_text='論表').click();assert B.locator('#stepChoices button').filter(has_text='本文Q&A').count()==0;B.locator('#stepBack').click()
  A.locator('#stepChoices button').filter(has_text='英C').click();A.locator('#stepChoices button').filter(has_text='本文Q&A').click();A.locator('#stepChoices button').filter(has_text='Lesson 7').click();A.locator('#stepChoices button').filter(has_text='Part 1').click();A.locator('#stepChoices button').filter(has_text='無制限').click();A.locator('#waiting').wait_for(state='visible')
  code=A.locator('#roomCode').inner_text();assert re.fullmatch(r'0\d{5}',code)
  B.locator('#joinCode').fill(code);B.locator('#join').click();A.locator('#rotationSetup').wait_for(state='visible');B.locator('#rotationSetup').wait_for(state='visible');assert B.locator('#rotationOptions button').count()==0
  A.locator('#rotationOptions button').filter(has_text={'half':'半分で交代する','one':'1問ずつ交代する','two':'2問ずつ交代する'}[rotation]).click();A.locator('#briefing').wait_for(state='visible');A.locator('#startPair').click();B.locator('#game').wait_for(state='visible')
  A.locator('#qaAnswerOpen').wait_for(state='visible');assert not B.locator('#qaModel').is_visible();assert not B.locator('#qaAnswerOpen').is_visible()
  B.locator('#qaHintRequest').click();A.wait_for_function('document.getElementById("pairHintText").textContent.includes("お願い")');A.locator('#pairHintButton').click();B.wait_for_function('document.getElementById("pairHintText").textContent.length>10')
  for index in range(5):
   asker=A if (index//(1 if rotation=='one' else 2 if rotation=='two' else 3))%2==0 else B
   other=B if asker==A else A
   asker.locator('#qaAnswerOpen').click();asker.locator('#qaModel').wait_for(state='visible');assert not other.locator('#qaModel').is_visible()
   asker.locator('#wrong' if index==2 else '#correct').click();other.locator('#qaModel').wait_for(state='visible');assert other.locator('#next').is_hidden()
   for side,page in zip(['A','B'],pages):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');
    if index==0:page.screenshot(path=f'/tmp/spark-{side}-{width}.png',full_page=True)
   asker.locator('#next').click()
   if index<4:
    for page in pages:page.wait_for_function(f'document.getElementById("counter").textContent.startsWith("{index+2} /")')
   if index==1:
    resynced=True;A.reload();A.locator('#game').wait_for(state='visible')
  for page in pages:
   page.locator('#done').wait_for(state='visible');assert page.locator('#result').inner_text()=='4 / 5 問正解'
  assert not errors,errors
  for context in contexts:context.close()
  print('PASS',width,rotation,'A/B, hints, reveal, rotation, reconnect, 5 answers, layout')
 for width in [320,390,1280]:
  context=browser.new_context(viewport={'width':width,'height':950});page=context.new_page();base=routes('legacy');held=[]
  def stalled(r):
   path=urlparse(r.request.url).path
   if path=='/pair_text_qa_catalog.json':held.append(r);return
   if path=='/pair-qa-config.js':r.fulfill(body='window.YoshiPairQAConfig={enabled:false,backend:"spark"};',content_type='text/javascript');return
   base(r)
  page.route('**/*',stalled);page.goto('https://local.test/pair.html');page.locator('#lobby').wait_for(state='visible',timeout=3000)
  page.locator('#stepChoices button').filter(has_text='英C').click();assert page.locator('#stepChoices button').filter(has_text='本文Q&A').is_disabled()
  for label in ['本文穴埋め','単語チェック']:
   page.locator('#stepChoices button').filter(has_text=label).click();page.locator('#stepChoices button').first.click();page.locator('#stepChoices button:enabled').first.click();assert page.locator('#stepTitle').inner_text()=='制限時間を選ぼう'
   for _ in range(3):page.locator('#stepBack').click()
  page.locator('#stepBack').click();page.locator('#stepChoices button').filter(has_text='論表').click();assert page.locator('#stepChoices button').filter(has_text='本文Q&A').count()==0
  page.locator('#stepChoices button').filter(has_text='本文穴埋め').click();page.locator('#stepChoices button').first.click();assert page.locator('#stepTitle').inner_text()=='制限時間を選ぼう'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  for request in held:
   try:request.abort()
   except Exception:pass
  page.wait_for_timeout(50);context.close();print('PASS',width,'legacy cloze/vocabulary/Logic navigation with stalled QA catalog')
 browser.close()
