"""Exercise additive AI material in the existing interfaces without external requests."""
import mimetypes
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
group = {'subject':'英C','id':'8','name':'1','publishedAt':'2026-11-27T00:00:00Z','questions':{
    'vocabulary':[{'question':'coast','answer':'海岸','translation':'名詞'}],
    'idiom':[{'question':'due to','answer':'〜のために','translation':'熟語'}],
    'cloze':[{'question':'It was (cold).','answer':'寒かった。','translation':'過去形'}],
    'qa':[{'question':'Was it cold?','answer':'Yes, it was.','translation':'寒かったですか。'}],
    'discussion':[{'question':'How do you feel?','answer':'I feel cold.','translation':'理由を伝えましょう。'}],
}}
def route(request):
    url = urlparse(request.request.url)
    if url.hostname != 'local.test':
        request.abort()
        return
    if url.path == '/studio-content.json':
        request.fulfill(json=[group])
        return
    if url.path == '/writing_questions.json':
        request.fulfill(json=[])
        return
    if url.path == '/account.js':
        request.fulfill(content_type='text/javascript',body='''
         window.savedPractice=[];
         window.YoshiAccount={user:{uid:'mock'},records:async()=>[],save:async row=>window.savedPractice.push(row)};
        ''')
        return
    path = (root/unquote(url.path).lstrip('/')).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        request.fulfill(status=404,body='missing')
        return
    request.fulfill(body=path.read_bytes(),content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width in (390,1366):
        page=browser.new_page(viewport={'width':width,'height':900})
        page.route('**/*',route)
        page.goto('https://local.test/index.html?view=subjects')
        page.evaluate("document.getElementById('welcomeCover')?.remove()")
        page.locator('#subjects [data-subject="英C"]').click()
        page.locator('#pickStudioVocab').click()
        page.locator('#unitList button').get_by_text('Lesson 8',exact=True).click()
        page.locator('#partList button').get_by_text('Part 1',exact=True).click()
        page.locator('#vocabStart').click()
        meaning=page.locator('#vocabWord').inner_text()
        page.locator('#vocabInput').fill({'海岸':'coast','〜のために':'due to'}[meaning])
        page.locator('#vocabSubmit').click()
        page.locator('#vocabStart').click()
        assert page.locator('#vocabFeedback').inner_text()=='1 / 1 問正解！'
        assert page.evaluate('window.savedPractice.length')==0
        page.close()
        page=browser.new_page(viewport={'width':width,'height':900})
        page.route('**/*',route)
        page.goto('https://local.test/index.html?view=subjects')
        page.evaluate("document.getElementById('welcomeCover')?.remove()")
        page.locator('#subjects [data-subject="英C"]').click()
        page.locator('#pickStudioGrammar').click()
        page.locator('#unitList button').get_by_text('Lesson 8',exact=True).click()
        page.locator('#partList button').get_by_text('Part 1',exact=True).click()
        page.locator('#question .cloze-inline-input').fill('cold')
        page.locator('#soloTypingSubmit').click()
        page.locator('#finishSession').click()
        assert page.evaluate('window.savedPractice.length')==0
        page.goto('https://local.test/writing.html')
        page.locator('[data-writing-subject="英C"]').click()
        page.locator('#lessonList button').get_by_text('Lesson 8',exact=True).click()
        assert page.locator('#prompt').inner_text()=='Was it cold?'
        page.locator('#answer').fill('Yes, it was.')
        page.locator('#submitAnswer').click()
        assert page.locator('#judgment').inner_text()=='正解！'
        page.locator('#next').click()
        assert page.locator('#prompt').inner_text()=='How do you feel?'
        page.locator('#answer').fill('I feel warm.')
        page.locator('#submitAnswer').click()
        assert page.locator('#judgment').inner_text()=='解答例で自己確認'
        assert page.evaluate('window.savedPractice.length')==0
        page.close()
        print('PASS',width,'existing vocab practice and writing Q&A, no XP writes',flush=True)
    browser.close()
