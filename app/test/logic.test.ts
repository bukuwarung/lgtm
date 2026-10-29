import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enclosing, addedLines, anchor, markText, rangeChange, changePairs, gaps, ignoreWhitespace, importFolds, movedLines, ownRoot, parsePatch, removedRuns, wordChange } from '../src/diff.ts';
import { applySuggestions, awaitsMe, queueNews, withAnswered, markBots, repoPath, suggestionOf, threadTiers } from '../src/github.ts';
import { adfToMarkdown, jiraKeys } from '../src/jira.ts';
import { addsLogic, codeWithoutTests, estimate, inTests, estimateLabel, gradleModules, moduleName, reviewOrder, untested } from '../src/files.ts';
import { isGenerated, parseGeneratedRules } from '../src/gitattributes.ts';
import { highlightCode, highlightHunks, rainbow, languageFor, majorityLanguage, splitLines } from '../src/highlight.ts';
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
  const both = parseGeneratedRules(['*.bin linguist-binary', 'keep.bin -linguist-binary', 'gen/* linguist-generated', 'gen/x.bin -linguist-binary'].join('\n'));
  assert.equal(isGenerated(both, 'a/data.bin'), true);
  assert.equal(isGenerated(both, 'keep.bin'), false);
  assert.equal(isGenerated(both, 'gen/x.bin'), true); // unsetting binary leaves generated
  assert.equal(isGenerated(parseGeneratedRules('*.bin linguist-binary=false'), 'a.bin'), false);
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
  const plain = renderChunks('```\nval x = listOf(1)\n```\n', new Set(), undefined, 'kt')[0].html;
  assert.match(plain, /<span class="hljs-keyword">val<\/span>/); // unmarked fence → the PR's main language
  assert.doesNotMatch(renderChunks('```\nval x = 1\n```\n', new Set())[0].html, /hljs/); // no guess given: plain
  assert.match(md.render('```kotlin\nfun f() = 1\n```\n'), /<span class="hljs-keyword">fun<\/span>/);
  assert.doesNotMatch(md.render('```\nfun f() = 1\n```\n'), /hljs/); // comments: highlightBlocks picks the language later
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
  assert.deepEqual(importFolds(h), [{ hunk: 0, start: 0, end: 7, added: 3, removed: 1, newPackages: ['retrofit2', 'kotlinx.coroutines.flow'], packageMoved: false }]);
  assert.equal(importFolds(parsePatch('@@ -1,2 +1,2 @@\n-package a.b\n+package a.c\n class X'))[0].packageMoved, true);
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

test('vectorToSvg converts an Android vector: viewBox, colours, clip-path order, gradients', async () => {
  const { vectorToSvg } = await import('../src/vector.ts');
  const out = vectorToSvg(`<?xml version="1.0"?><vector xmlns:android="x" xmlns:aapt="y" android:width="24dp" android:height="12dp" android:viewportWidth="48" android:viewportHeight="24">
    <path android:pathData="M0,0h1" android:fillColor="#80FF0000"/>
    <group android:translateX="2"><clip-path android:pathData="M0,0h10v10z"/><path android:pathData="M1,1h2" android:strokeColor="@color/brand" android:strokeWidth="2"/></group>
    <path android:pathData="M5,5h1"><aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="0" android:startY="0" android:endX="1" android:endY="0" android:startColor="#000" android:endColor="#fff"/></aapt:attr></path>
  </vector>`)!;
  assert.equal(out.width, 24);
  assert.equal(out.approx, true); // @color/brand
  assert.match(out.svg, /viewBox="0 0 48 24"/);
  assert.match(out.svg, /fill="rgba\(255,0,0,0.502\)"/);
  assert.match(out.svg, /<g transform="translate\(2 0\)[^"]*"><g clip-path="url\(#c\d\)"><path d="M1,1h2" fill="none" stroke="#9e9e9e"/);
  assert.match(out.svg, /<linearGradient id="g\d"[^>]*><stop offset="0" stop-color="#000000"\/>/);
  assert.equal(vectorToSvg('<selector><item/></selector>'), null);
});

test('importFolds for TypeScript: multi-line imports, one count per statement, only outside packages named', () => {
  const h = parsePatch([
    '@@ -1,4 +1,9 @@', ' import { a } from "./a";', '+import type { B } from "@scope/lib/sub";', '+import {', '+  c,', '+  d,', "+} from 'react';",
    "-import x from 'node:fs';", '+import "./side-effect.css";', ' ', ' export const y = 1;',
  ].join('\n'));
  assert.deepEqual(importFolds(h, 'ts'), [{ hunk: 0, start: 0, end: 8, added: 3, removed: 1, newPackages: ['@scope/lib', 'react'], packageMoved: false }]);
  // `import x = require(...)` must not swallow the rest of the file
  assert.equal(importFolds(parsePatch("@@ -0,0 +1,3 @@\n+import x = require('y');\n+const z = 1;\n+z;"), 'ts')[0]?.end ?? -1, -1);
});

test('majorityLanguage: the most common code language, markdown and plain text aside', () => {
  assert.equal(majorityLanguage(['a/A.kt', 'a/B.kt', 'build.gradle.kts', 'x.yaml', 'README.md', 'docs/a.md', 'docs/b.md', 'n.txt']), 'kt');
  assert.equal(majorityLanguage(['a.ts', 'b.tsx', 'c.yaml']), 'ts');
  assert.equal(majorityLanguage(['README.md']), undefined);
});

test('markBots: comments by accounts marked as bots count as bot comments', () => {
  const t = { isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'me' } }, { author: { login: 'vorflux', __typename: 'User' } }] } };
  const [marked] = markBots([t], new Set(['vorflux']));
  assert.equal(marked.comments.nodes[1].author!.__typename, 'Bot');
  assert.equal(awaitsMe(t, 'me', false), true); // a person replied…
  assert.equal(awaitsMe(marked, 'me', false), false); // …but it's a bot now
});

test('docBlocks finds whole doc comments of one kind; parseDoc renders KDoc and Javadoc', async () => {
  const { docBlocks, parseDoc } = await import('../src/docs.ts');
  const h = parsePatch([
    '@@ -1,3 +1,9 @@', '+    /**', '+     * Sums the [Item] prices.', '+     *', '+     * @param items the cart', '+     * @return total in cents', '+     */', ' fun total() = 0',
    ' /** Short. */', '-/** old', '+/** new', ' */',
  ].join('\n'));
  const blocks = docBlocks(h);
  assert.deepEqual(blocks.map((b) => [b.start, b.end, b.kind, b.indent]), [[0, 5, '+', 4], [7, 7, ' ', 0]]); // the mixed one stays source
  const d = parseDoc(blocks[0].text, 'kdoc');
  assert.equal(d.body, 'Sums the `Item` prices.');
  assert.deepEqual(d.tags, [['Params', [['items', 'the cart']]], ['Returns', [['', 'total in cents']]]]);
  const j = parseDoc('/**\n * Returns the {@code Order} for <b>id</b>.\n * @throws IllegalStateException if missing\n */', 'java');
  assert.equal(j.body, 'Returns the `Order` for **id**.');
  assert.deepEqual(j.tags, [['Throws', [['IllegalStateException', 'if missing']]]]);
});

test('claude links: a new session carries the prompt (capped) and the folder', async () => {
  const { claudeNewLink, commentPrompt, prPrompt } = await import('../src/claude.ts');
  const u = new URL(claudeNewLink('Fix this & that', '/Users/me/app'));
  assert.equal(u.protocol + '//' + u.host + u.pathname, 'claude://code/new');
  assert.equal(u.searchParams.get('q'), 'Fix this & that');
  assert.equal(u.searchParams.get('folder'), '/Users/me/app');
  assert.equal(new URL(claudeNewLink('x'.repeat(5000))).searchParams.get('q')!.length, 2592);
  const pr = { html_url: 'https://github.com/o/r/pull/7', number: 7, title: 'Add X', base: { ref: 'main' }, head: { ref: 'feat' } };
  assert.match(prPrompt(pr, 'o/r'), /gh pr diff 7 --repo o\/r/);
  assert.match(commentPrompt({ author: 'bob', text: 'Use a fake\nhere', url: 'u' }, { repo: 'o/r', number: 7, prUrl: pr.html_url, path: 'A.kt', line: 3 }), /from @bob on `A.kt:3`[\s\S]*> Use a fake\n> here/);
});

test('newer compares versions numerically', async () => {
  const { newer } = await import('../src/platform.ts');
  assert.ok(newer('v0.10.0', '0.9.1'));
  assert.ok(newer('0.1.1', '0.1.0'));
  assert.ok(!newer('v0.1.0', '0.1.0'));
  assert.ok(!newer('0.1.0', '0.2.0'));
});

test('rebinding a key moves it off the action that had it', async () => {
  const { bind, readBindings } = await import('../src/keys.ts');
  const b = readBindings('{}');
  assert.deepEqual(bind(b, 'nextFile', 'n'), { nextFile: 'n', nextThread: '' });
  assert.deepEqual(bind(b, 'nextFile', 'j'), {});
  assert.equal(readBindings('{"help":"h"}').help, 'h');
});

test('untested: code changed without a matching test change', () => {
  const f = (filename: string, status = 'modified', additions = 3) => ({ filename, status, additions });
  assert.deepEqual(
    untested([
      f('app/src/main/java/a/Foo.kt'), f('app/src/test/java/a/FooTest.kt'), // tested
      f('app/src/main/java/a/Bar.kt'), // not
      f('src/cart.ts'), f('src/__tests__/cart.test.ts'), // tested
      f('lib/pay.py'), f('tests/test_pay.py'), // tested
      f('src/gone.ts', 'removed', 0), f('app/src/debug/java/a/DevTool.kt'), f('README.md'), f('build.gradle.kts'), f('src/only-deletions.ts', 'modified', 0),
    ]),
    ['app/src/main/java/a/Bar.kt'],
  );
});

test('markText marks text only, closing around tags and counting entities as one', () => {
  assert.equal(markText('val fee', 4, 7, 'm'), 'val <mark class="m">fee</mark>');
  assert.equal(markText('<span class="k">val</span> a &amp; b', 2, 7, 'm'), '<span class="k">va<mark class="m">l</mark></span><mark class="m"> a &amp;</mark> b');
  assert.equal(markText('x', 1, 1, 'm'), 'x');
});

test('rangeChange: what became of commented lines', () => {
  const patch = '@@ -1,5 +1,5 @@\n a\n b\n-c\n+C\n d\n e';
  assert.equal(rangeChange(patch, 1, 2), null); // a, b untouched
  assert.deepEqual(rangeChange(patch, 2, 4)!.map((l) => l.kind + l.text), ['-c', '+C']);
  assert.equal(rangeChange('@@ -1,2 +1,3 @@\n a\n+x\n b', 2, 2), null); // inserted before the range
  assert.deepEqual(rangeChange('@@ -1,3 +1,4 @@\n a\n b\n+x\n c', 2, 3)!.map((l) => l.kind + l.text), ['+x']); // inside it
});

test('estimate: description, code, tests and docs at their own pace; generated files skipped', () => {
  const e = estimate(
    [
      { path: 'src/Pay.kt', additions: 50, deletions: 30 }, // 60 code lines
      { path: 'src/PayTest.kt', additions: 40, deletions: 0 }, // 40 test lines
      { path: 'README.md', additions: 30, deletions: 0 }, // 30 doc lines
      { path: 'package-lock.json', additions: 5000, deletions: 4000 }, // skipped
    ],
    'word '.repeat(400),
  );
  assert.deepEqual([e.code, e.tests, e.docs, e.words], [60, 40, 30, 400]);
  assert.equal(e.minutes, 2 + 12 + 4 + 1);
  assert.deepEqual([estimateLabel(3), estimateLabel(19), estimateLabel(64), estimateLabel(90)], ['<5 min', '~20 min', '~1 h', '~1 h 30']);
});

test('editedDocBlocks: an edited doc comment, from its new version, with the changed parts', async () => {
  const { editedDocBlocks, docParts } = await import('../src/docs.ts');
  const h = parsePatch([
    '@@ -1,6 +1,7 @@', ' /**', '-  * Sums the prices.', '+  * Sums the prices, in cents.', '   *', '   * @param items the cart', '+  * @return the total', '   */', ' fun total() = 0',
  ].join('\n'));
  const [b] = editedDocBlocks(h);
  assert.deepEqual([b.start, b.end, b.kind], [0, 6, '~']);
  const d = docParts(b.lines!, 'kdoc');
  assert.deepEqual(d.paras, [{ md: 'Sums the prices, in cents.', changed: true }]);
  assert.deepEqual(d.tags, [['Params', [['items', 'the cart', false]]], ['Returns', [['', 'the total', true]]]]);
});

test('docParts: paragraphs at blank lines and at sentence ends', async () => {
  const { docParts } = await import('../src/docs.ts');
  const lines = ['/**', ' * Transparent host for the gate.', ' * Launched over the homepage. Reuses the', ' * login gate, e.g. the', ' * prompt.', ' *', ' * The window is translucent.', ' */'].map((text) => ({ text, changed: false }));
  assert.deepEqual(docParts(lines, 'kdoc').paras.map((p) => p.md), ['Transparent host for the gate.', 'Launched over the homepage. Reuses the\nlogin gate, e.g. the\nprompt.', 'The window is translucent.']);
});

test('lineCommentBlocks: // runs as prose, not single lines or commented-out code', async () => {
  const { lineCommentBlocks, docParts } = await import('../src/docs.ts');
  const h = parsePatch([
    '@@ -1,4 +1,9 @@', ' // one line stays inline', ' val a = 1', '+    // Retries the charge with backoff.', '+    // Network errors only: a declined card', '+    // is final.', ' val b = 2',
    '-// val c = foo();', '-// if (x) {', '+// return bar()',
  ].join('\n'));
  const blocks = lineCommentBlocks(h, true);
  assert.deepEqual(blocks.map((b) => [b.start, b.end, b.kind, b.indent]), [[2, 4, '+', 4]]);
  assert.deepEqual(docParts(blocks[0].lines!, 'kdoc', 'line').paras.map((p) => p.md), ['Retries the charge with backoff.', 'Network errors only: a declined card\nis final.']);
});

test('reviewDonePrompt: the review, as a message back to the Claude session', async () => {
  const { reviewDonePrompt } = await import('../src/claude.ts');
  const p = reviewDonePrompt({ html_url: 'https://github.com/o/r/pull/7', number: 7, title: 'Retry payments' }, 'REQUEST_CHANGES', 'Close.', [{ path: 'Pay.kt', line: 12, body: 'Stop retrying\non declines.' }]);
  assert.match(p, /^I reviewed https:\/\/github\.com\/o\/r\/pull\/7 \(#7 Retry payments\) in lgtm and requested changes\./);
  assert.match(p, /- `Pay\.kt:12`: Stop retrying on declines\./);
  assert.match(p, /Please address them/);
});

test('gradleModules: the folder before src/, build files, the rest by folder', () => {
  const m = gradleModules([
    'core/network/src/main/kotlin/Api.kt',
    'core/network/proguard-rules.pro',
    'app/build.gradle.kts',
    'app/lint.xml',
    'src/main/java/Root.java',
    'build.gradle',
    'docs/readme.md',
    'feature/pay/src/test/PayTest.kt',
  ]);
  assert.equal(m.get('core/network/src/main/kotlin/Api.kt'), 'core/network');
  assert.equal(m.get('core/network/proguard-rules.pro'), 'core/network');
  assert.equal(m.get('app/build.gradle.kts'), 'app');
  assert.equal(m.get('app/lint.xml'), 'app');
  assert.equal(m.get('src/main/java/Root.java'), '.');
  assert.equal(m.get('build.gradle'), '.');
  assert.equal(m.get('docs/readme.md'), '');
  assert.equal(m.get('feature/pay/src/test/PayTest.kt'), 'feature/pay');
  assert.equal(gradleModules(['web/src/index.ts', 'web/package.json']).size, 0); // not a Gradle PR
  assert.equal(moduleName('core/data/network'), ':core:data:network');
  assert.equal(moduleName('.'), ':');
});

test('codeWithoutTests: code changed in a module, none of its tests', () => {
  const f = (filename: string, additions = 3, status = 'modified') => ({ filename, status, additions });
  assert.equal(codeWithoutTests([f('core/net/src/main/kotlin/Api.kt')]), true);
  assert.equal(codeWithoutTests([f('core/net/src/main/kotlin/Api.kt'), f('core/net/src/test/kotlin/ApiTest.kt')]), false);
  assert.equal(codeWithoutTests([f('core/net/build.gradle.kts'), f('core/net/src/main/res/values/strings.xml')]), false); // no code
  assert.equal(codeWithoutTests([f('core/net/src/main/kotlin/Api.kt', 0)]), false); // only deletions
});

test('enclosing: the declaration around a change, by indentation', () => {
  const head = [
    'class HomeSaldoFragment @Inject constructor() :',
    '    BaseFragment() {',
    '',
    '    private fun bindSaldo(saldo: Long) {',
    '        binding.button.setOnClickListener {',
    '            if (saldo > 0) {',
    '                show(saldo)',
    '            }',
    '        }',
    '    }',
    '',
    '    override fun onResume() {',
    '        super.onResume()',
    '    }',
    '}',
  ];
  const hunk = (newStart: number, lines: { kind: '+' | '-' | ' '; text: string; new?: number }[]) => ({ header: '', newStart, lines });
  // a change deep in a lambda inside a function: the function
  assert.equal(enclosing(head, hunk(6, [{ kind: ' ', text: '            if (saldo > 0) {', new: 6 }, { kind: '+', text: '                show(saldo)', new: 7 }])), 'private fun bindSaldo(saldo: Long)');
  // a removal: located by the line after it
  assert.equal(enclosing(head, hunk(13, [{ kind: '-', text: '        log()' }, { kind: ' ', text: '    }', new: 14 }])), 'override fun onResume()');
  // a change at the class's own level: the class
  assert.equal(enclosing(head, hunk(3, [{ kind: '+', text: '    private val x = 1', new: 3 }])), 'class HomeSaldoFragment @Inject constructor()');
  // at the top level: nothing
  assert.equal(enclosing(head, hunk(1, [{ kind: '+', text: 'import foo', new: 1 }])), null);
  // a function added (doc comment first): that function
  assert.equal(
    enclosing(head, hunk(11, [{ kind: '+', text: '    /** Shows it. */', new: 11 }, { kind: '+', text: '    @VisibleForTesting', new: 12 }, { kind: '+', text: '    fun show(x: Long) {', new: 13 }])),
    'fun show(x: Long)',
  );
  // a doc comment changed: the function it documents
  const doc = ['class A {', '    /**', '     * Old words.', '     */', '    fun documented() {', '    }', '}'];
  assert.equal(enclosing(doc, hunk(3, [{ kind: '-', text: '     * Old words.' }, { kind: '+', text: '     * New words.', new: 3 }, { kind: ' ', text: '     */', new: 4 }])), 'fun documented()');
  // only a blank line added: placed by the next line with text
  assert.equal(enclosing(head, hunk(8, [{ kind: '+', text: '', new: 8 }, { kind: ' ', text: '            }', new: 9 }])), 'private fun bindSaldo(saldo: Long)');
});

test('fillSlack: values, tags, and no empty lines left behind', async () => {
  const { fillSlack, prValues } = await import('../src/slackmsg.ts');
  const v = { ...prValues({ repo: 'o/r', number: 7, title: 'Fix <a> & b', url: 'https://x/7', author: 'ann' }), note: '' };
  assert.equal(fillSlack('{pr}', v), '<https://x/7|o/r#7 Fix &lt;a&gt; &amp; b>');
  assert.equal(fillSlack('Hi {@them}, {@author} and {@bob-2}: {title}\n{note}', v), 'Hi <@gh:*>, <@gh:ann> and <@gh:bob-2>: Fix &lt;a&gt; &amp; b');
  assert.equal(fillSlack('Hi {@recipient}', v), 'Hi <@gh:*>');
  assert.equal(fillSlack('{unknown} stays', v), '{unknown} stays');
});

test('repoPath: a markdown image link as a path in the repo', () => {
  const up = '..';
  assert.equal(repoPath('images/flow.png', 'docs/features'), 'docs/features/images/flow.png');
  assert.equal(repoPath('./a%20b.png?raw=1', 'docs'), 'docs/a b.png');
  assert.equal(repoPath([up, up, 'assets', 'x.svg'].join('/'), 'docs/features/ui'), 'docs/assets/x.svg');
  assert.equal(repoPath('/public/logo.png', 'docs'), 'public/logo.png');
  assert.equal(repoPath('flow.png', ''), 'flow.png');
  assert.equal(repoPath('https://x/y.png', 'docs'), null);
  assert.equal(repoPath('data:image/png;base64,AA', 'docs'), null);
});

test('suggestions: parsed from a comment, applied bottom up, line endings kept', () => {
  const t = { id: 'T', path: 'a.kt', line: 3, startLine: 2, diffSide: 'RIGHT' } as any;
  const s = suggestionOf(t, { databaseId: 1, body: 'Try this:\r\n```suggestion\r\nB2\r\n```', author: null } as any)!;
  assert.deepEqual([s.start, s.end, s.text], [2, 3, 'B2\n']);
  assert.equal(suggestionOf(t, { databaseId: 2, body: 'no block' } as any), null);
  const src = 'a\r\nb\r\nc\r\nd\r\n';
  assert.equal(applySuggestions(src, [s, { path: 'a.kt', start: 4, end: 4, text: '' }]), 'a\r\nB2\r\n');
  assert.equal(applySuggestions(src, [{ path: 'a.kt', start: 1, end: 1, text: '\n' }]), '\r\nb\r\nc\r\nd\r\n');
  assert.throws(() => applySuggestions(src, [s, { path: 'a.kt', start: 3, end: 4, text: 'x\n' }]));
});

test('queueNews: what changed between list refreshes', () => {
  const on = { replies: true, verdicts: true, ci: true };
  const base = { authored: true, reviewDecision: 'REVIEW_REQUIRED', ci: 'PENDING', thread: { awaiting: 0, allMineResolved: false } } as any;
  assert.deepEqual(queueNews(base, { ...base, reviewDecision: 'APPROVED', ci: 'FAILURE', thread: { awaiting: 1 } }, on), ['New reply for you', 'Approved', 'Checks failed']);
  assert.deepEqual(queueNews(base, { ...base, ci: 'SUCCESS' }, { ...on, ci: false }), []);
  assert.deepEqual(queueNews({ ...base, ci: 'FAILURE' }, { ...base, ci: 'SUCCESS' }, on), []); // a rerun that went green without being seen running
  assert.deepEqual(queueNews({ ...base, thread: undefined }, { ...base, thread: { awaiting: 2 } }, on), []); // thread status missing before
  assert.deepEqual(queueNews(base, { ...base, authored: false, reviewDecision: 'APPROVED' }, on), []);
});

test('withAnswered: a review just sent leaves "needs your review" until the search catches up', () => {
  const i = { repo: 'o/r', number: 1, requested: true, myState: null, waitingSince: '2026-10-28T09:00:00Z' } as any;
  const at = Date.parse('2026-10-28T09:10:00Z');
  const sent = new Map([['o/r#1', { event: 'APPROVE' as const, at }]]);
  assert.deepEqual([withAnswered([i], sent, at + 1000)[0].requested, withAnswered([i], sent, at + 1000)[0].myState], [false, 'APPROVED']);
  assert.equal(withAnswered([{ ...i, waitingSince: '2026-10-28T09:11:00Z' }], sent, at + 90_000)[0].requested, true); // asked again since
  assert.equal(withAnswered([i], sent, at + 10 * 60_000)[0].requested, true); // the search has caught up by then
});

test('inTests: test files and test folders', () => {
  for (const p of ['app/src/test/java/a/FooTest.kt', 'app/src/androidTest/a/Foo.kt', 'app/src/test/resources/x.json', 'web/__tests__/a.ts', 'web/a.test.ts', 'tests/test_a.py', 'app/test/logic.test.ts', 'e2e/login.spec.ts'])
    assert.ok(inTests(p), p);
  for (const p of ['app/src/main/java/a/Foo.kt', 'src/contest/a.ts', 'docs/testing.md', 'src/latest.ts']) assert.ok(!inTests(p), p);
});

test('rainbow: brackets coloured by depth, not inside strings or comments', () => {
  assert.equal(rainbow('f(a[b])'), 'f<span class="rb0">(</span>a<span class="rb1">[</span>b<span class="rb1">]</span><span class="rb0">)</span>');
  assert.equal(rainbow('x(<span class="hljs-string">"(a"</span>)'), 'x<span class="rb0">(</span><span class="hljs-string">"(a"</span><span class="rb0">)</span>');
  assert.equal(rainbow(') &lt;('), '<span class="rb2">)</span> &lt;<span class="rb2">(</span>'); // a hunk can start inside brackets
});

test('addsLogic: only changes with logic need a test', () => {
  const p = (...lines: string[]) => '@@ -1,1 +1,3 @@\n' + lines.map((l) => '+' + l).join('\n');
  for (const no of [p('    PENDING("pending"),', '    const val MAX_RETRIES = 3'), p('enum class Status { A, B }'), p('data class User(val id: String, val name: String)'), p('interface Repo {', '    fun load(id: String): User', '}'), p('import a.b.C', '// if this changes')])
    assert.ok(!addsLogic(no), no);
  for (const yes of [p('fun total(xs: List<Int>) = xs.sum()'), p('    fun save(u: User) {'), p('    if (x > 0) return x'), p('val f = { x: Int -> x + 1 }'), p('const f = (a) => a * 2'), p('export function go() {')])
    assert.ok(addsLogic(yes), yes);
  assert.ok(addsLogic(undefined)); // no patch: can't tell
});
