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
  if u.path=='/extension_questions.json' and resynced:r.fulfill(body='[]',content_type='application/json');return
  f=(root/unquote(u.path).lstrip('/')).resolve()
  if f.is_relative_to(root) and f.is_file():
   body=f.read_bytes()
   if f.name=='index.html':body=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',body.decode(),flags=re.I).encode()
   r.fulfill(body=body,content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
  else:r.fulfill(status=404,body='missing')
 return route
questions=[q for q in json.loads((root/'extension_questions.json').read_text()) if q['status']=='公開' and q['subject']=='英C' and q['type']=='True / False']
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,rotation in [(320,'half'),(390,'one'),(1280,'two')]:
  server({'op':'reset'});resynced=False;contexts=[];pages=[];errors=[]
  for uid in ['A','B']:
   ctx=browser.new_context(viewport={'width':width,'height':950});page=ctx.new_page();page.route('**/*',routes(uid));page.on('pageerror',lambda e:errors.append(str(e)));page.goto('https://local.test/pair.html');page.locator('#lobby').wait_for(state='visible');contexts.append(ctx);pages.append(page)
  A,B=pages
  A.locator('#stepChoices button').filter(has_text='英C').click();A.wait_for_function("!document.querySelector('[data-kind=tf]').disabled")
  assert A.locator('#stepChoices button').count()==4
  assert 'linear-gradient' in A.locator('[data-kind=tf]').evaluate('el=>getComputedStyle(el).backgroundImage')
  assert A.evaluate('document.documentElement.scrollWidth<=innerWidth');A.screenshot(path=f'/tmp/pair-menu-{width}.png',full_page=True)
  A.locator('[data-kind=tf]').click();A.locator('#stepChoices button').filter(has_text='Lesson 8').click();A.locator('#stepChoices button').filter(has_text='Part 1').click();A.locator('#stepChoices button').filter(has_text='無制限').click();A.locator('#waiting').wait_for(state='visible');code=A.locator('#roomCode').inner_text();assert re.fullmatch(r'[1-9]\d{5}',code)
  # Guest sees a later empty catalog, yet joins the host's frozen question set.
  resynced=True;B.reload();B.locator('#lobby').wait_for(state='visible');B.locator('#stepChoices button').filter(has_text='英C').click();B.wait_for_function("document.querySelector('[data-kind=tf]').disabled")
  B.locator('#joinCode').fill(code);B.locator('#join').click();A.locator('#rotationSetup').wait_for(state='visible')
  A.locator('#rotationOptions button').filter(has_text={'half':'半分で交代する','one':'1問ずつ交代する','two':'2問ずつ交代する'}[rotation]).click();A.locator('#briefing').wait_for(state='visible');assert '本文正誤問題' in A.locator('#briefingSummary').inner_text();A.locator('#startPair').click()
  for i,q in enumerate(questions):
   is_a=(i//(1 if rotation=='one' else 2 if rotation=='two' else (len(questions)+1)//2))%2==0
   asker=A if is_a else B;answerer=B if is_a else A
   for page in pages:page.locator('#game').wait_for(state='visible');page.wait_for_function(f'document.getElementById("counter").textContent.startsWith("{i+1} /")')
   assert asker.locator('#english').inner_text()==answerer.locator('#english').inner_text()==q['question']
   assert answerer.locator('#japanese').is_hidden();assert q['modelAnswer'] in asker.locator('#japanese').inner_text()
   assert answerer.locator('#grading').is_hidden();asker.locator('#wrong' if i==2 else '#correct').click();answerer.locator('#feedback').wait_for(state='visible')
   for page in pages:assert q['modelAnswer'] in page.locator('#japanese').inner_text();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if i==0:answerer.screenshot(path=f'/tmp/pair-tf-answer-{width}.png',full_page=True)
   assert answerer.locator('#next').is_hidden();asker.locator('#next').click()
  for page in pages:page.locator('#done').wait_for(state='visible');assert page.locator('#result').inner_text()==f'{len(questions)-1} / {len(questions)} 問正解'
  assert not errors,errors
  for ctx in contexts:ctx.close()
  print('PASS',width,rotation,'menu, TF snapshot, A/B display, grading, rotation, result',flush=True)
 # Optional TF load failures must leave the established modes available.
 for payload in ['[]','{"bad":true}']:
  ctx=browser.new_context(viewport={'width':390,'height':950});page=ctx.new_page();base=routes('fallback');resynced=False
  def failing(r):
   if urlparse(r.request.url).path=='/extension_questions.json':r.fulfill(body=payload,content_type='application/json');return
   base(r)
  page.route('**/*',failing);page.goto('https://local.test/pair.html');page.locator('#lobby').wait_for(state='visible');page.locator('#stepChoices button').filter(has_text='英C').click();assert page.locator('[data-kind=cloze]').is_enabled();assert page.locator('[data-kind=vocab]').is_enabled();assert page.locator('[data-kind=tf]').is_disabled();page.locator('#stepBack').click();page.locator('#stepChoices button').filter(has_text='論表').click();assert page.locator('[data-kind=tf]').count()==0;ctx.close()
 print('PASS empty/invalid TF data preserves cloze, vocabulary and Logic navigation',flush=True)
 browser.close()
