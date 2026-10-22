import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, anchor, changePairs, gaps, ignoreWhitespace, importFolds, movedLines, ownRoot, parsePatch, removedRuns, wordChange } from '../src/diff.ts';
import { awaitsMe, threadTiers } from '../src/github.ts';
import { adfToMarkdown, jiraKeys } from '../src/jira.ts';
import { reviewOrder } from '../src/files.ts';
import { isGenerated, parseGeneratedRules } from '../src/gitattributes.ts';
import { highlightCode, highlightHunks, languageFor, splitLines } from '../src/highlight.ts';
import { setEmojiMap } from '../src/emoji.ts';
import { isMarkdown, md, renderChunks } from '../src/markdown.ts';
import { findStacks } from '../src/stacks.ts';

const patch = [
  '@@ -1,4 +1,5 @@',
  ' # Title',
  '-old line',
  '+new line',
  '+another',
  ' ',
  ' tail',
  '@@ -20,3 +21,2 @@',
  ' ctx',
  '-gone',
  ' end',
  '\\ No newline at end of file',
].join('\n');

test('parsePatch numbers lines', () => {
  const h = parsePatch(patch);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0].lines[1], { kind: '-', text: 'old line', old: 2 });
  assert.deepEqual(h[0].lines[2], { kind: '+', text: 'new line', new: 2 });
  assert.deepEqual(h[1].lines[2], { kind: ' ', text: 'end', old: 22, new: 22 });
  assert.deepEqual([...addedLines(h)], [2, 3]);
});

test('anchor clamps to the most-overlapping hunk', () => {
  const h = parsePatch(patch);
  assert.deepEqual(anchor(h, 2, 3), { startLine: 2, line: 3 });
  assert.deepEqual(anchor(h, 4, 10), { startLine: 4, line: 5 });
  assert.deepEqual(anchor(h, 5, 22), { startLine: 21, line: 22 }); // spans both; second overlap is larger
  assert.equal(anchor(h, 8, 15), null);
  assert.deepEqual(anchor(h, 22, 22), { line: 22 });
});

test('removedRuns positions removals in head', () => {
  assert.deepEqual(removedRuns(parsePatch(patch)), [
    { at: 2, oldStart: 2, lines: ['old line'] },
    { at: 22, oldStart: 21, lines: ['gone'] },
  ]);
  assert.deepEqual(removedRuns(parsePatch('@@ -5,2 +4,0 @@\n-a\n-b')), [{ at: 4, oldStart: 5, lines: ['a', 'b'] }]);
});

test('gitattributes: spec scenarios', () => {
  const rules = parseGeneratedRules(
    ['# comment', '*.pb.go linguist-generated', 'gen/** linguist-generated=true', 'dist/** linguist-generated', 'dist/keep.js -linguist-generated', '*.txt text'].join('\n'),
  );
  assert.equal(isGenerated(rules, 'api/v1/user.pb.go'), true);
  assert.equal(isGenerated(rules, 'gen/a/b.ts'), true);
  assert.equal(isGenerated(rules, 'src/gen/b.ts'), false);
  assert.equal(isGenerated(rules, 'dist/app.js'), true);
  assert.equal(isGenerated(rules, 'dist/keep.js'), false);
  assert.equal(isGenerated(rules, 'notes.txt'), false);
  assert.equal(isGenerated(parseGeneratedRules(''), 'x.pb.go'), false);
  assert.equal(isGenerated(parseGeneratedRules('**/vendor/** linguist-generated'), 'a/vendor/b.js'), true);
  assert.equal(isGenerated(parseGeneratedRules('**/vendor/** linguist-generated'), 'vendor/b.js'), true);
});

test('renderChunks maps blocks to lines, marks changes, escapes HTML', () => {
  const src = '# Title\n\nPara one\nstill one\n\n- a\n- b\n\n<script>alert(1)</script>\n';
  const chunks = renderChunks(src, new Set([7]));
  assert.deepEqual(chunks.map((c) => [c.start, c.end]), [[1, 1], [3, 4], [6, 8], [9, 9]]);
  assert.match(chunks[0].html, /<h1 data-src="1-1">/);
  assert.match(chunks[2].html, /<li data-src="7-8" data-chg="">/);
  assert.doesNotMatch(chunks[2].html, /<li data-src="6-6" data-chg/);
  assert.match(chunks[3].html, /&lt;script&gt;/);
  const fm = renderChunks('---\na: 1\n---\n# H\n', new Set([2]));
  assert.deepEqual(fm.map((c) => [c.start, c.end]), [[1, 3], [4, 4]]);
  assert.match(fm[0].html, /^<pre data-src="1-3" data-chg=""><code>---\na: 1\n---<\/code><\/pre>$/);
  assert.match(fm[1].html, /<h1 data-src="4-4">/);
  const cm = renderChunks('<!-- hidden -->\nText <!-- inline --> here <b>x</b>\n\n```html\n<!-- kept in code -->\n```\n', new Set());
  const html = cm.map((c) => c.html).join('');
  assert.doesNotMatch(html, /hidden|inline/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /&lt;!-- kept in code --&gt;/);
  assert.ok(isMarkdown('docs/A.MD') && isMarkdown('x.mdx') && !isMarkdown('x.mdc'));
});

test('highlight: language lookup and line splitting', () => {
  assert.equal(languageFor('src/a.ts'), 'ts');
  assert.equal(languageFor('Dockerfile'), 'dockerfile');
  assert.equal(languageFor('x/Makefile'), 'makefile');
  assert.equal(languageFor('weird.zzz'), undefined);
  assert.deepEqual(splitLines('<span class="c">/* a\nb */</span> x'), ['<span class="c">/* a</span>', '<span class="c">b */</span> x']);
  const h = highlightHunks(parsePatch('@@ -1,2 +1,2 @@\n const a = `x\n-y`;\n+z`;'), 'a.js')!;
  assert.equal(h[0].length, 3);
  assert.match(h[0][1], /hljs-string/); // removed line still inside the template string
  assert.match(h[0][2], /hljs-string/);
  assert.equal(highlightHunks(parsePatch('@@ -1 +1 @@\n+x'), 'a.zzz'), null);
  const table = renderChunks('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n', new Set([4]))[0].html;
  assert.match(table, /<tr data-src="4-4" data-chg="">/); // rows are commentable
  assert.doesNotMatch(table, /<td data-src/);
  const fenced = renderChunks('```js\nconst a = 1;\n```\n', new Set([2])).map((c) => c.html).join('');
  assert.match(fenced, /hljs-keyword/);
  assert.match(fenced, /^<pre data-src="1-3" data-chg=""><code class="language-js"><span class="cl" data-src="2-2" data-chg="">/); // block and each line commentable
  // Only diff lines are commentable: blocks and code lines outside the hunks are marked data-nd.
  const nd = renderChunks('# A\n\n- one\n- two\n\n```\nx\ny\n```\n\nPara\n', new Set([4]), new Set([3, 4, 5, 6, 7]));
  assert.deepEqual(nd.map((c) => c.inDiff), [false, true, true, false]);
  assert.match(nd[0].html, /<h1 data-src="1-1" data-nd="">/);
  assert.match(nd[1].html, /<li data-src="3-3">one<\/li>/);
  assert.match(nd[2].html, /data-src="7-7">x<\/span><span class="cl" data-src="8-8" data-nd="">y/);
  const plain = renderChunks('```\nval x = listOf(1)\n```\n', new Set())[0].html;
  assert.match(plain, /<span class="hljs-keyword">val<\/span>/); // unmarked fence → Kotlin
  assert.match(md.render('```\nfun f() = 1\n```\n'), /<span class="hljs-keyword">fun<\/span>/);
  assert.match(md.render('```suggestion\nval a = 2\n```\n'), /^<div class="suggestion"><div class="badge">Suggested change<\/div><pre>/);
  const mmd = renderChunks('```mermaid\ngraph TD\n  A-->B\n```\n', new Set([3]))[0].html;
  assert.match(mmd, /^<div class="mermaid-block" data-src="1-4" data-chg=""><div class="mermaid-svg" data-code="graph TD\n  A--&gt;B\n"><\/div>/);
  assert.match(mmd, /<span class="cl" data-src="3-3" data-chg="">  A--&gt;B<\/span>/); // source lines still commentable
  assert.equal(md.render('```mermaid\ngraph TD\n```\n'), '<div class="mermaid-svg" data-code="graph TD\n"></div>'); // comments/drafts
  const twoLines = renderChunks('- item\n\n  ```\n  a <b>\n\n  c\n  ```\n', new Set()).map((c) => c.html).join('');
  assert.match(twoLines, /<span class="cl" data-src="4-4">a &lt;b&gt;<\/span><span class="cl" data-src="5-5"> <\/span><span class="cl" data-src="6-6">c<\/span>/);
});

test('findStacks links base → head chains within a repo', () => {
  const pr = (id: string, base: string, head: string, repo = 'o/r', headRepo = repo) => ({ id, repo, headRepo, base, head });
  const items = [
    pr('3', 'feat-b', 'feat-c'),
    pr('1', 'main', 'feat-a'),
    pr('x', 'main', 'solo'),
    pr('2', 'feat-a', 'feat-b'),
    pr('other', 'feat-a', 'z', 'o/other'), // same branch name, different repo
    pr('fork', 'main', 'feat-a', 'o/r', 'someone/r'), // a fork's feat-a is not o/r's feat-a
  ];
  assert.deepEqual(findStacks(items).map((s) => s.map((i) => i.id)), [['1', '2', '3']]);
  assert.deepEqual(findStacks([pr('a', 'main', 'x')]), []);
});

test('gaps: unchanged stretches between hunks, with old-line offsets', () => {
  // the shared patch: hunk 1 covers new 1-5 (old 1-4), hunk 2 new 21-22 (old 20-22)
  assert.deepEqual(gaps(parsePatch(patch)), [
    { before: 1, from: 6, to: 20, offset: -1 },
    { before: 2, from: 23, to: null, offset: 0 },
  ]);
  // pure deletion: "+4,0" means the hunk sits after new line 4
  assert.deepEqual(gaps(parsePatch('@@ -5,2 +4,0 @@\n-a\n-b')), [
    { before: 0, from: 1, to: 4, offset: 0 },
    { before: 1, from: 5, to: null, offset: 2 },
  ]);
  // pure addition at the top
  assert.deepEqual(gaps(parsePatch('@@ -0,0 +1,2 @@\n+a\n+b')), [{ before: 1, from: 3, to: null, offset: -2 }]);
});

test('emoji shortcodes render as GitHub emoji images, not inside code', () => {
  setEmojiMap({ tada: 'https://e/tada.png', '+1': 'https://e/plus.png' });
  const html = md.render('Nice :tada: and :+1: but :nope: and `:tada:`');
  assert.match(html, /Nice <img class="emoji" alt=":tada:" title=":tada:" src="https:\/\/e\/tada.png"> and <img class="emoji" alt=":\+1:"/);
  assert.match(html, /but :nope: and <code>:tada:<\/code>/);
});

test('ignoreWhitespace turns re-indented lines into context, keeps real changes', () => {
  const h = parsePatch(['@@ -1,3 +1,4 @@', '-a()', '-b()', '+if (x) {', '+  a()', '+  b2()', '+}', ' tail'].join('\n'));
  const lines = ignoreWhitespace(h)[0].lines.map((l) => l.kind + l.text + (l.old ?? '') + '/' + (l.new ?? ''));
  assert.deepEqual(lines, ['+if (x) {/1', '   a()1/2', '-b()2/', '+  b2()/3', '+}/4', ' tail3/5']);
});

test('wordChange finds the edited span, or nothing when lines differ wholesale', () => {
  assert.deepEqual(wordChange('foo(a, b)', 'foo(xy, b)'), { del: [4, 5], add: [4, 6] });
  assert.equal(wordChange('completely', 'different!'), null);
  assert.deepEqual(changePairs(parsePatch('@@ -1,2 +1,2 @@\n-a\n-b\n+c\n ctx')[0]), [[0, 2]]);
});

test('movedLines marks a 3-line block moved between files, not a lone line', () => {
  const block = ['val first = compute()', '', 'val second = other()', 'return first + second'];
  const files = [
    { filename: 'A.kt', hunks: parsePatch(['@@ -1,5 +1,1 @@', ...block.map((l) => '-' + l), '-lonelyLineHere', ' x'].join('\n')) },
    { filename: 'B.kt', hunks: parsePatch(['@@ -1,1 +1,5 @@', ' y', ...block.map((l) => '+    ' + l)].join('\n')) },
  ];
  const m = movedLines(files);
  assert.deepEqual([...m.get('A.kt')!.old], [[1, 'B.kt:2'], [2, ''], [3, ''], [4, '']]);
  assert.deepEqual([...m.get('B.kt')!.new].map(([n, s]) => [n, s]), [[2, 'A.kt:1'], [3, ''], [4, ''], [5, '']]);
});

test('awaitsMe: open thread where someone else spoke last, on my PR or with me in it; bots never', () => {
  const t = (resolved: boolean, ...who: [string, string?][]) => ({ isResolved: resolved, isOutdated: false, comments: { nodes: who.map(([login, __typename]) => ({ author: { login, __typename } })) } });
  assert.equal(awaitsMe(t(false, ['me'], ['bob']), 'me', false), true);
  assert.equal(awaitsMe(t(false, ['bob'], ['me']), 'me', true), false);
  assert.equal(awaitsMe(t(false, ['bob']), 'me', false), false);
  assert.equal(awaitsMe(t(false, ['bob']), 'me', true), true);
  assert.equal(awaitsMe(t(false, ['cubic', 'Bot']), 'me', true), false);
  assert.equal(awaitsMe(t(true, ['me'], ['bob']), 'me', false), false);
  assert.equal(awaitsMe({ ...t(false, ['me'], ['bob']), isOutdated: true }, 'me', false), false);
});

test('jira keys from the title, ADF to markdown', () => {
  assert.deepEqual(jiraKeys('feat(BUKU-1, BUKU-22): x', 'BUKU-9'), ['BUKU-1', 'BUKU-22']);
  assert.deepEqual(jiraKeys('no key', 'feature/ABC-7-thing'), ['ABC-7']);
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }] }] }] },
  ] };
  assert.equal(adfToMarkdown(doc), '## Goal\n\n- `code`');
});

test('reviewOrder: markdown first, then each source file followed by its test', () => {
  const order = reviewOrder(['app/src/test/java/a/FooTest.kt', 'app/src/main/java/a/Zed.kt', 'README.md', 'app/src/main/java/a/Foo.kt', 'app/src/androidTest/java/a/ZedTest.kt']);
  assert.deepEqual(order, ['README.md', 'app/src/main/java/a/Foo.kt', 'app/src/test/java/a/FooTest.kt', 'app/src/main/java/a/Zed.kt', 'app/src/androidTest/java/a/ZedTest.kt']);
});

test('importFolds folds a changed import block and names packages new to the file', () => {
  const h = parsePatch([
    '@@ -1,6 +1,7 @@', ' package a', ' ', ' import dagger.Module', '-import old.thing.Gone', '+import retrofit2.Retrofit', '+import dagger.Provides',
    '+import kotlinx.coroutines.flow.map', ' ', ' class A',
  ].join('\n'));
  assert.deepEqual(importFolds(h), [{ hunk: 0, start: 2, end: 6, added: 3, removed: 1, newPackages: ['retrofit2', 'kotlinx.coroutines.flow'] }]);
  assert.deepEqual(importFolds(parsePatch('@@ -1,2 +1,2 @@\n import a.B\n-val x = 1\n+val x = 2')), []);
});

test('ownRoot reads the project package from a source path', () => {
  assert.equal(ownRoot('app/src/main/java/com/bukuwarung/edc/Foo.kt'), 'com.bukuwarung');
  assert.equal(ownRoot('build.gradle.kts'), null);
});

test('Kotlin highlighting marks properties, named args, it, constants; types and annotations get Kotlin-only classes', () => {
  const html = highlightHunks(parsePatch('@@ -0,0 +1,2 @@\n+@Inject val n: Int = repo.items.size + MAX_SIZE\n+f(id = 1).let { it }'), 'A.kt')![0].join('\n');
  assert.match(highlightCode('fun run(block: suspend () -> Unit) {}', 'kotlin'), /hljs-keyword">suspend</);
  for (const cls of ['kt-ann', 'kt-type', 'kt-prop', 'kt-const', 'kt-arg', 'kt-it']) assert.match(html, new RegExp(`hljs-${cls}`), cls);
});

test('threadTiers: mine first, then people, then bots; resolved without me set aside', () => {
  const t = (id: string, resolved: boolean, ...who: [string, string?][]) => ({ id, isResolved: resolved, comments: { nodes: who.map(([login, __typename]) => ({ author: { login, __typename } })) } });
  const tiers = threadTiers([t('bot', false, ['cubic', 'Bot']), t('done', true, ['bob']), t('bob', false, ['bob']), t('me', true, ['bob'], ['me']), t('me2', false, ['me'])], 'me');
  assert.deepEqual(Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.map((x) => x.id)])), { mine: ['me2', 'me'], human: ['bob'], bot: ['bot'], resolved: ['done'] });
});
