"""Exercise the real quiz, favorites page and account adapter with a mocked Firebase SDK."""
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EIKEN = json.loads((ROOT / "eiken_2.json").read_text())[0]

SDK = {
    'firebase-app.js': """
      export const getApps=()=>[], getApp=()=>({}), initializeApp=()=>({});
    """,
    'firebase-auth.js': """
      const auth={currentUser:null};
      const makeUser=uid=>({uid,emailVerified:true,getIdTokenResult:async()=>({signInProvider:'google.com'})});
      export const getAuth=()=>auth;
      export class GoogleAuthProvider {setCustomParameters(){}}
      let receive;
      window.mockUser=uid=>{auth.currentUser=uid?makeUser(uid):null;receive(auth.currentUser);};
      export const onAuthStateChanged=(_,fn)=>{receive=fn;window.mockUser('student');};
      export const signInWithPopup=()=>window.mockUser('student'),signInWithRedirect=signInWithPopup;
      export const getRedirectResult=async()=>null,signOut=async()=>window.mockUser(null);
      export const browserLocalPersistence={},setPersistence=async()=>{};
    """,
    'firebase-database.js': r"""
      const subs=new Map();
      const snap=value=>({val:()=>value,exists:()=>value!=null});
      export const getDatabase=()=>({}),ref=(_,path)=>path,push=path=>path+'/new';
      export const get=async()=>snap(null);
      export const remove=async path=>set(path,null);
      export const runTransaction=async()=>{throw Error('Any learning-record write fails this test');};
      const read=path=>JSON.parse(localStorage.getItem(path)||'{}');
      window.addEventListener('storage',e=>{for(const fn of subs.get(e.key)||[])fn(snap(read(e.key)));});
      export function onValue(path,fn){
        if(!subs.has(path))subs.set(path,new Set());
        subs.get(path).add(fn);fn(snap(read(path)));
        return ()=>subs.get(path).delete(fn);
      }
      export async function set(path,value){
        if(!/^questionFavorites\/[^/]+\/[^/]+$/.test(path))throw Error('Unexpected write: '+path);
        const [root,uid,key]=path.split('/'), collection=root+'/'+uid, rows=read(collection);
        if(value===null)delete rows[key];else if(value===true)rows[key]=true;else throw Error('Invalid payload');
        localStorage.setItem(collection,JSON.stringify(rows));
        for(const fn of subs.get(collection)||[])fn(snap(rows));
      }
    """,
}


def route(request):
    url = urlparse(request.request.url)
    if url.hostname == 'www.gstatic.com' and url.path.rsplit('/', 1)[-1] in SDK:
        request.fulfill(body=SDK[url.path.rsplit('/', 1)[-1]], content_type='text/javascript')
        return
    if url.hostname != 'local.test':
        request.abort()
        return
    path = (ROOT / unquote(url.path).lstrip('/')).resolve()
    if path.name == 'eiken_2.json':
        request.fulfill(json=[EIKEN])
        return
    if path.is_relative_to(ROOT) and path.is_file():
        request.fulfill(body=path.read_bytes(), content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
        return
    request.fulfill(status=404)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in [320, 1280]:
        context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block')
        context.route('**/*', route)
        quiz = context.new_page()
        quiz.goto('https://local.test/eiken.html')
        quiz.locator('[data-grade="2"]').click()
        quiz.locator('#start').click()
        star = quiz.locator('.favorite-toggle')
        expect(star).to_have_attribute('aria-pressed', 'false')
        star.click()
        expect(star).to_have_attribute('aria-pressed', 'true')

        library = context.new_page()
        library.goto('https://local.test/favorites.html')
        expect(library.locator('#favoriteList li')).to_have_count(1)
        first_text = json.loads((ROOT / 'lessons.json').read_text())[0]['cards'][0]
        text_key = library.evaluate("""async ([en,ja])=>{
          const Q=YoshiFavoriteQuestions;
          return Q.key(Q.text('英C','textTyping',en,ja));
        }""", first_text)
        library.evaluate("key=>YoshiAccount.setQuestionFavorite(key,true)", text_key)
        expect(library.locator('#favoriteList li')).to_have_count(2)

        library.locator('#filterSubject').select_option('英検')
        expect(library.locator('#favoriteList li')).to_have_count(1)
        library.get_by_role('button', name='この問題を復習').click()
        expect(library.locator('#reviewPrompt')).to_have_text(EIKEN['sentence'])
        library.locator('#reviewChoices button').filter(has_text=EIKEN['correctWord']).click()
        expect(library.locator('#reviewJudgment')).to_have_text('✓ 正解！')
        library.locator('#nextFavorite').click()
        expect(library.locator('#favoriteReview')).to_be_hidden()

        library.locator('#filterSubject').select_option('')
        library.locator('#filterFormat').select_option('textTyping')
        expect(library.locator('#favoriteList li')).to_have_count(1)
        expect(library.locator('#favoriteList h2')).not_to_contain_text('( transferred )')
        library.locator('#filterFormat').select_option('')
        library.locator('#reviewAll').click()
        expect(library.locator('#reviewProgress')).to_have_text('1 / 2問')
        expect(library.locator('#reviewProgress')).to_be_visible()
        if library.locator('#reviewChoices button').count():
            library.locator('#reviewChoices button').first.click()
        else:
            for field in library.locator('#reviewFields input').all():
                field.fill('answer')
            library.locator('#checkFavorite').click()
        library.locator('#nextFavorite').click()
        expect(library.locator('#reviewProgress')).to_have_text('2 / 2問')
        library.locator('#backToFavorites').click()

        library.locator('#favoriteList li').filter(has_text=EIKEN['sentence']).get_by_role('button', name='登録解除').click()
        expect(star).to_have_attribute('aria-pressed', 'false')
        expect(library.locator('#favoriteList li')).to_have_count(1)
        library.evaluate("window.mockUser('other')")
        expect(library.locator('#favoriteStatus')).to_contain_text('まだありません')
        library.evaluate("window.mockUser('student')")
        expect(library.locator('#favoriteList li')).to_have_count(1)
        library.get_by_role('button', name='登録解除').click()
        expect(library.locator('#favoriteStatus')).to_contain_text('まだありません')
        assert library.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert library.evaluate("Object.keys(localStorage).every(key=>key.startsWith('questionFavorites/'))")
        context.close()
        print(f'PASS {width}px favorites, filters, reviews, account switch and synchronization')
    browser.close()
