"""Test home announcements on a Pages-style subpath without external services."""
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/Yoshi.Lab/'
HOME = 'https://local.test' + PREFIX + 'index.html?view=subjects'
INITIAL = json.loads((ROOT / 'home-updates.json').read_text())


def route_updates(payload):
    def route(request):
        url = urlparse(request.request.url)
        if url.hostname != 'local.test' or not url.path.startswith(PREFIX):
            request.abort()
            return
        if url.path == PREFIX + 'home-updates.json':
            request.fulfill(json=payload[0])
            return
        path = (ROOT / unquote(url.path.removeprefix(PREFIX))).resolve()
        if path.is_relative_to(ROOT) and path.is_file():
            request.fulfill(body=path.read_bytes(), content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
        else:
            request.fulfill(status=404)
    return route


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (320, 1280):
        payload = [INITIAL]
        context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block')
        context.route('**/*', route_updates(payload))
        page = context.new_page()
        page.goto(HOME)
        trigger = page.locator('#homeUpdatesButton')
        panel = page.locator('#homeUpdatesPanel')
        badge = page.locator('#homeUpdatesNew')
        expect(trigger).to_be_visible()
        expect(badge).to_be_visible()
        assert trigger.evaluate("""button => {
          const logo = button.previousElementSibling.getBoundingClientRect();
          const bounds = button.getBoundingClientRect();
          const nav = document.querySelector('.home-header-actions').getBoundingClientRect();
          return bounds.left >= logo.right && bounds.right <= nav.left &&
            bounds.top < logo.bottom && bounds.bottom > logo.top;
        }""")
        trigger.click()
        expect(panel).to_be_visible()
        expect(trigger).to_have_attribute('aria-expanded', 'true')
        expect(panel.locator('time')).to_have_text('2026年11月18日')
        expect(panel.locator('h3')).to_have_text('⭐ お気に入り機能を追加')
        expect(panel.locator('li p')).to_have_text(INITIAL['entries'][0]['description'])
        expect(badge).to_be_hidden()
        box = panel.bounding_box()
        assert box['x'] >= 0 and box['x'] + box['width'] <= width

        page.keyboard.press('Escape')
        expect(panel).to_be_hidden()
        expect(trigger).to_have_attribute('aria-expanded', 'false')
        trigger.click()
        page.locator('.brand').click()
        expect(panel).to_be_hidden()
        page.reload()
        expect(panel.locator('li')).to_have_count(1)
        expect(badge).to_be_hidden()

        payload[0] = {
            'version': 'test-next',
            'entries': [
                dict(date=f'2026-11-{day:02}', title=f'更新 {day}', description='説明')
                for day in range(19, 26)
            ],
        }
        page.reload()
        expect(badge).to_be_visible()
        trigger.click()
        expect(panel.locator('li')).to_have_count(5)
        expect(panel.locator('h3').first).to_have_text('更新 25')
        expect(badge).to_be_hidden()
        context.close()
        print(f'PASS {width}px home updates, dismiss, read persistence, new version and five-entry limit')
    browser.close()
