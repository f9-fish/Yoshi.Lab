const test = require('node:test');
const assert = require('node:assert/strict');
const { functionFromLine } = require('./helpers/app-harness.cjs');

function render(english) {
  const element = () => ({
    className: '', children: [], dataset: {}, classList: { add() {} },
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    setAttribute() {},
  });
  const root = element();
  functionFromLine('index.html', 'renderClozeQuestion', {
    $: () => root, selectedStudyMode: 'text', renderHighlightedParentheses() {},
    document: { createElement: element, createTextNode: textContent => ({ textContent }) },
  })(english, '');
  return root.children[0].children.map(node => node.className === 'cloze-gap' ?
    { blank: true, initial: node.dataset.initial } : node.textContent);
}

const blank = initial => ({ blank: true, initial });

test('normal cloze counts all six words and supplies breakable spaces between them', () => {
  assert.deepEqual(render('It was for a (Japanese horror movie that Dick supervised).'),
    ['It was for a ', blank('J'), ' ', blank(), ' ', blank(), ' ', blank(), ' ', blank(), ' ', blank(), '.']);
});

test('multiple groups are counted independently, with one hint per group', () => {
  assert.deepEqual(render('It (was) a film and it (was\t highly   evaluated).'),
    ['It ', blank('w'), ' a film and it ', blank('w'), ' ', blank(), ' ', blank(), '.']);
});

test('alternate sentences display only the primary sentence and hyphenated words count once', () => {
  assert.deepEqual(render('An (award-winning film).<br>An (award winning movie).'),
    ['An ', blank('a'), ' ', blank(), '.']);
});
