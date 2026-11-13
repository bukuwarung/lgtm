import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, commonIndent, dedentHtml, anchor, relocate, markText, rangeChange, changePairs, gaps, ignoreWhitespace, importFolds, movedLines, ownRoot, parsePatch, removedRuns, wordChange } from '../src/diff.ts';
import { codeIndex, docSnippet, peekLines, refTo, specRefs } from '../src/specrefs.ts';
import { applySuggestions, awaitsMe, codeOwners, queueNews, withAnswered, markBots, repoPath, suggestionOf, threadTiers, parsePrUrl, isLab, numRef } from '../src/github.ts';
import { adfToMarkdown, jiraKeys } from '../src/jira.ts';
import { addsLogic, codeWithoutTests, deletedTests, isArchivedSpec, uniqueNames, estimate, inTests, estimateLabel, gradleModules, moduleName, modulesOf, moduleView, reviewOrder, untested } from '../src/files.ts';
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
  const { claudeNewLink, commentPrompt, prPrompt } = await import('../src/prompts.ts');
  const u = new URL(claudeNewLink('Fix this & that', '/Users/me/app'));
  assert.equal(u.protocol + '//' + u.host + u.pathname, 'claude://code/new');
  assert.equal(u.searchParams.get('q'), 'Fix this & that');
  assert.equal(u.searchParams.get('folder'), '/Users/me/app');
  assert.equal(new URL(claudeNewLink('x'.repeat(5000))).searchParams.get('q')!.length, 2592);
  const pr = { html_url: 'https://github.com/o/r/pull/7', number: 7, title: 'Add X', base: { ref: 'main' }, head: { ref: 'feat' } };
  assert.match(prPrompt(pr, 'o/r'), /gh pr diff 7 --repo o\/r/);
  assert.match(commentPrompt({ author: 'bob', text: 'Use a fake\nhere', url: 'u' }, pr, 'o/r', { path: 'A.kt', line: 3 }), /from @bob on `A.kt:3`[\s\S]*> Use a fake\n> here/);
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

test('uniqueNames: the name alone, with parent folders until it\'s unique', () => {
  const got = uniqueNames(['a/specs/out/spec.md', 'a/specs/pin/spec.md', 'a/b/Store.kt', 'x/y/README.md', 'z/y/README.md', 'docs/x.md', 'docs/sub/docs/x.md']);
  assert.deepEqual([...got.values()], ['out/spec.md', 'pin/spec.md', 'Store.kt', 'x/y/README.md', 'z/y/README.md', 'docs/x.md', 'sub/docs/x.md']);
});

test('isArchivedSpec: markdown in an archive folder', () => {
  assert.deepEqual(['docs/specs/archive/v1.md', 'specs/Archived/old.md', 'docs/_archive/x.md', 'docs/specs/now.md', 'src/archive/Store.kt', 'docs/archives/x.md', 'openspec/changes/archive/2026-09-22-x/.openspec.yaml'].map(isArchivedSpec), [true, true, true, false, false, true, true]);
});

test('deletedTests: tests deleted outright, not renamed or moved', () => {
  const f = (filename: string, status: string) => ({ filename, status, additions: 0 });
  assert.deepEqual(
    deletedTests([
      f('app/src/test/java/a/FooTest.kt', 'removed'), // gone
      f('tests/test_pay.py', 'removed'), // gone
      f('src/old/cart.test.ts', 'removed'), f('src/new/cart.test.ts', 'added'), // moved
      f('src/__tests__/b.test.ts', 'renamed'), f('src/gone.ts', 'removed'), f('src/x.test.ts', 'modified'),
    ]),
    ['app/src/test/java/a/FooTest.kt', 'tests/test_pay.py'],
  );
});

test('markText marks text only, closing around tags and counting entities as one', () => {
  assert.equal(markText('val fee', 4, 7, 'm'), 'val <mark class="m">fee</mark>');
  assert.equal(markText('<span class="k">val</span> a &amp; b', 2, 7, 'm'), '<span class="k">va<mark class="m wd-s">l</mark></span><mark class="m wd-e"> a &amp;</mark> b');
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
  // With single lines on: the lone comment too, still not the commented-out code.
  assert.deepEqual(lineCommentBlocks(h, true, '//', 1).map((b) => [b.start, b.end]), [[0, 0], [2, 4]]);
  assert.deepEqual(docParts(blocks[0].lines!, 'kdoc', 'line').paras.map((p) => p.md), ['Retries the charge with backoff.', 'Network errors only: a declined card\nis final.']);
});

test('lineCommentBlocks: # runs too (Python, YAML, ProGuard), not shebangs or commented-out keys and rules', async () => {
  const { lineCommentBlocks, lineCommentSyntax, docParts } = await import('../src/docs.ts');
  assert.deepEqual(['a.py', 'ci.yml', 'proguard-rules.pro', 'Dockerfile', 'a.kt', 'README.md'].map(lineCommentSyntax), ['#', '#', '#', '#', '//', null]);
  const h = parsePatch([
    '@@ -1,2 +1,10 @@', '+#!/usr/bin/env python', '+# Retries the charge with backoff.', '+# A declined card is final.', ' x = 1',
    '+# -keep class com.a.** { *; }', '+# -dontwarn okhttp3.**', '+# timeout: 30', '+# retries: 3',
  ].join('\n'));
  const blocks = lineCommentBlocks(h, true, '#');
  assert.deepEqual(blocks.map((b) => [b.start, b.end]), [[1, 2]]);
  assert.deepEqual(docParts(blocks[0].lines!, 'kdoc', 'line').paras.map((p) => p.md), ['Retries the charge with backoff.', 'A declined card is final.']);
});

test('reviewDonePrompt: the review, as a message back to the Claude session', async () => {
  const { reviewDonePrompt } = await import('../src/prompts.ts');
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
  // Approved, green and mergeable at once: one "Ready to merge", not three notifications.
  const ready = { ...base, isDraft: false, reviewDecision: 'APPROVED', ci: 'SUCCESS', mergeState: 'CLEAN', autoMerge: false, queue: null };
  assert.deepEqual(queueNews({ ...base, mergeState: 'BLOCKED' }, ready, { ...on, ready: true }), ['Ready to merge']);
  assert.deepEqual(queueNews({ ...base, mergeState: 'BLOCKED' }, { ...ready, autoMerge: true }, { ...on, ready: true }), ['Approved', 'Checks passed']); // auto-merge merges it
  assert.deepEqual(queueNews(ready, ready, { ...on, ready: true }), []);
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
  // Other languages
  for (const yes of [p('    public void setName(String name) {'), p('fn parse(s: &str) -> Result<u32> {'), p('def total(xs):'), p('  def name'), p('func (s *Server) Start() error {'), p('  func load() async throws -> User {'), p('  Future<void> save(User u) async {'), p('    get total() {'), p('square = lambda x: x * x'), p('int add(int a, int b) {')])
    assert.ok(addsLogic(yes), yes);
  for (const no of [p('enum class Status(val code: Int) {'), p('public class User {'), p('public static final int MAX = 3;'), p('int add(int a, int b);'), p('    String name;'), p('struct Point { x: i32, y: i32 }'), p('    case pending = "pending"')])
    assert.ok(!addsLogic(no), no);
});

test('markText: a range split by tags is tagged first, middle and last', () => {
  assert.equal(markText('ab', 0, 2, 'm'), '<mark class="m">ab</mark>');
  assert.equal(
    markText('<i>a</i> <b>b</b>', 0, 3, 'm'),
    '<i><mark class="m wd-s">a</mark></i><mark class="m wd-m"> </mark><b><mark class="m wd-m">b</mark></b><mark class="m wd-e"></mark>',
  );
});

test('ignoreWhitespace: blank lines added or removed on their own count as whitespace', () => {
  const [h] = parsePatch(['@@ -1,3 +1,4 @@', ' a', '+', ' b', '-', ' c'].join('\n'));
  const lines = ignoreWhitespace([h])[0].lines;
  assert.ok(lines.every((l) => l.kind === ' '), JSON.stringify(lines));
  assert.deepEqual(lines.map((l) => [l.old ?? null, l.new ?? null]), [[1, 1], [null, 2], [2, 3], [3, null], [4, 4]]);
  assert.deepEqual(gaps(ignoreWhitespace([h])).at(-1), gaps([h]).at(-1)); // the file's rest lines up as before
});

test('modulesOf / moduleView: modules from build files, shown only when they tell something', () => {
  const roots = [{ dir: '.', gradle: true }, { dir: 'app', gradle: true }, { dir: 'core/network', gradle: true }];
  const m = modulesOf(['app/src/main/A.kt', 'core/network/src/main/B.kt', 'core/network/build.gradle.kts', 'gradle/libs.versions.toml'], roots);
  assert.deepEqual([...m.values()], ['app', 'core/network', 'core/network', '.']);
  assert.equal(moduleView(m), 'all');
  assert.equal(moduleView(modulesOf(['app/src/main/A.kt', 'app/src/main/B.kt'], roots)), 'pill'); // one module: just named
  assert.equal(moduleView(modulesOf(['src/index.ts', 'package.json'], [{ dir: '.', gradle: false }])), 'none'); // a single-package repo
  const ts = modulesOf(['packages/pay/lib/a.ts', 'packages/web/index.ts'], [{ dir: '.', gradle: false }, { dir: 'packages/pay', gradle: false }, { dir: 'packages/web', gradle: false }]);
  assert.equal(moduleView(ts), 'all');
  assert.equal(moduleName('packages/pay'), 'packages/pay'); // npm packages by folder; Gradle's keep their :names
  assert.equal(moduleName('core/network'), ':core:network');
});

test('theme files: VS Code colours and tokens, Zed families, lenient JSON', async () => {
  const { fromVSCode, fromZedFile, parseThemeFile } = await import('../src/themes.ts');
  const vs = parseThemeFile(`{
    // VS Code themes are often JSONC
    "name": "Night", "type": "dark",
    "colors": { "editor.background": "#101010", "foreground": "#eeeeee", "gitDecoration.addedResourceForeground": "#00ff00", "terminal.ansiRed": "#ff0000", },
    "tokenColors": [
      { "scope": ["keyword.control", "storage"], "settings": { "foreground": "#ff00ff" } },
      { "scope": "string.quoted.double", "settings": { "foreground": "#ffff00" } },
      { "scope": "comment", "settings": { "fontStyle": "italic" } },
    ],
  }`);
  const t = fromVSCode(vs, '');
  assert.equal(t.dark['--bg'], '#101010');
  assert.equal(t.dark['--fg'], '#eeeeee');
  assert.equal(t.dark['--addfg'], '#00ff00');
  assert.equal(t.dark['--delfg'], '#ff0000'); // from the terminal's red, as the theme names no git colour
  assert.equal(t.dark['--hl-kw'], '#ff00ff'); // keyword.control, the first preference named exactly
  assert.equal(t.dark['--hl-str'], '#ffff00'); // string.quoted.double starts with string
  assert.equal(t.dark['--hl-com'], undefined); // a rule with no colour isn't one
  assert.equal(t.light['--bg'], '#101010'); // one look for both
  assert.throws(() => fromVSCode({ include: './base.json' }, ''));
  const { withIncludes, fromVSCodeSet, vsAppearance } = await import('../src/themes.ts');
  const merged = await withIncludes({ include: 'base.json', colors: { 'editor.background': '#111111' } }, async () => ({ colors: { 'editor.background': '#000000', foreground: '#cccccc' }, tokenColors: [{ scope: 'comment', settings: { foreground: '#777777' } }] }));
  assert.deepEqual(merged.colors, { 'editor.background': '#111111', foreground: '#cccccc' }); // its own over the include's
  assert.equal(merged.tokenColors.length, 1);
  const set = fromVSCodeSet('Ext', [{ label: 'Day', appearance: vsAppearance('vs'), file: vs }, { label: 'Night', appearance: vsAppearance('vs-dark'), file: vs }], '');
  assert.deepEqual(set.pick, { light: 'Day', dark: 'Night' });

  const zed = fromZedFile(
    { name: 'Pair', themes: [{ name: 'Pair Light', appearance: 'light', style: { 'editor.background': '#ffffffff', created: '#00aa00ff' } }, { name: 'Pair Dark', appearance: 'dark', style: { 'editor.background': '#000000ff' } }] },
    '',
  );
  assert.equal(zed.light['--bg'], '#ffffff'); // an opaque alpha is dropped
  assert.equal(zed.dark['--bg'], '#000000');
  assert.equal(zed.light['--add'], 'color-mix(in srgb, #00aa00 16%, #ffffff)');
  assert.deepEqual(zed.pick, { light: 'Pair Light', dark: 'Pair Dark' });
});

test('trimContext: with whitespace ignored, only a few unchanged lines around each real change', async () => {
  const { trimContext } = await import('../src/diff.ts');
  const ctx = (n: number) => ({ kind: ' ' as const, text: `c${n}`, old: n, new: n });
  const lines = [...Array.from({ length: 10 }, (_, i) => ctx(i + 1)), { kind: '-' as const, text: 'x', old: 11 }, { kind: '+' as const, text: 'y', new: 11 }, ...Array.from({ length: 10 }, (_, i) => ({ ...ctx(i + 12), old: i + 12, new: i + 12 }))];
  const [h, ...rest] = trimContext([{ header: '@@ -1,21 +1,21 @@ fun f()', newStart: 1, lines }], 3);
  assert.equal(rest.length, 0);
  assert.deepEqual(h.lines.map((l) => l.text), ['c8', 'c9', 'c10', 'x', 'y', 'c12', 'c13', 'c14']);
  assert.equal(h.header, '@@ -8,7 +8,7 @@ fun f()'); // the function it's in, kept
  assert.equal(h.newStart, 8);
  // Two changes far apart: two hunks; a commented line counts as a change.
  const two = trimContext([{ header: '@@ -1,21 +1,21 @@', newStart: 1, lines: Array.from({ length: 21 }, (_, i) => ctx(i + 1)) }], 3, new Set([2, 20]));
  assert.deepEqual(two.map((x) => [x.lines[0].new, x.lines.at(-1)!.new]), [[1, 5], [17, 21]]);
  // Already tight: the hunk as it was.
  const tight = { header: '@@ -1,3 +1,3 @@', newStart: 1, lines: [ctx(1), { kind: '+' as const, text: 'z', new: 2 }, ctx(3)] };
  assert.equal(trimContext([tight], 3)[0], tight);
  // Unchanged lines at the edges that say nothing (blank, }, ), */) are left out; inside a hunk they stay.
  const c = (n: number, text: string) => ({ kind: ' ' as const, text, old: n, new: n });
  const edges = trimContext([{ header: '@@ -1,7 +1,7 @@', newStart: 1, lines: [c(1, '    }'), c(2, '}'), c(3, ''), { kind: '-' as const, text: 'a', old: 4 }, { kind: '+' as const, text: 'b', new: 4 }, c(5, '  '), c(6, 'x()'), c(7, '  */')] }], 3);
  assert.deepEqual(edges[0].lines.map((l) => l.text), ['a', 'b', '  ', 'x()']);
  assert.equal(edges[0].newStart, 4);
  // …unless someone commented on one.
  assert.equal(trimContext([{ header: '@@ -1,2 +1,2 @@', newStart: 1, lines: [c(1, '}'), { kind: '+' as const, text: 'z', new: 2 }] }], 3, new Set([1]))[0].lines.length, 2);
});

test('importsOnly: a file whose every change is an import', async () => {
  const { importsOnly, parsePatch } = await import('../src/diff.ts');
  const imports = parsePatch(`@@ -1,5 +1,6 @@
 package com.acme.ui
 
-import androidx.compose.foundation.layout.*
+import androidx.compose.foundation.layout.Box
+import androidx.compose.foundation.layout.Column
 import androidx.compose.runtime.Composable`);
  assert.equal(importsOnly('app/src/main/java/com/acme/ui/Home.kt', imports), true);
  assert.equal(importsOnly('docs/Home.md', imports), false); // not a language with imports
  const code = parsePatch(`@@ -1,4 +1,5 @@
 import androidx.compose.runtime.Composable
+import androidx.compose.foundation.layout.Box
 
-fun a() = 1
+fun a() = 2`);
  assert.equal(importsOnly('Home.kt', code), false);
});

test('commonIndent and dedentHtml leave out the shared indentation', () => {
  assert.equal(commonIndent(['    a', '      b', '', '  ', '    c']), 4);
  assert.equal(commonIndent(['\t\tx', '\ty']), 1);
  assert.equal(commonIndent(['', '  ']), 0);
  assert.equal(dedentHtml('<span class="x">    </span><span>fun</span>', 4), '<span class="x"></span><span>fun</span>');
  assert.equal(dedentHtml('  <span>  a</span>', 3), '<span> a</span>');
  assert.equal(dedentHtml(' x', 4), 'x');
});

test('codeOwners: CODEOWNERS patterns, the last match deciding', () => {
  const co = `# build
*.gradle @me
gradle/ @me
.github/ @me
/module-list.yaml @me
app/src/main/java/com/x/payments/ @bhargav
docs/**/*.md @org/docs
*  @fallback
/app/build.gradle @other`;
  assert.deepEqual(codeOwners(co, '.github/workflows/lint.yml'), ['@fallback']); // * comes later and wins
  const noStar = co.replace('*  @fallback\n', '');
  assert.deepEqual(codeOwners(noStar, '.github/workflows/lint.yml'), ['@me']);
  assert.deepEqual(codeOwners(noStar, 'feature/build.gradle'), ['@me']); // unanchored: any folder
  assert.deepEqual(codeOwners(noStar, 'app/build.gradle'), ['@other']); // a later, anchored line wins
  assert.deepEqual(codeOwners(noStar, 'module-list.yaml'), ['@me']);
  assert.deepEqual(codeOwners(noStar, 'sub/module-list.yaml'), []); // anchored to the root
  assert.deepEqual(codeOwners(noStar, 'lib/gradle/wrapper.jar'), ['@me']); // a folder name, anywhere
  assert.deepEqual(codeOwners(noStar, 'app/src/main/java/com/x/payments/Pay.kt'), ['@bhargav']);
  assert.deepEqual(codeOwners(noStar, 'docs/a/b/c.md'), ['@org/docs']);
  assert.deepEqual(codeOwners(noStar, 'docs/c.md'), ['@org/docs']);
  assert.deepEqual(codeOwners(noStar, 'src/Main.kt'), []);
  assert.deepEqual(codeOwners('build/** @b', 'build/x/y.kts'), ['@b']);
});

test('specrefs: code spans in specs naming the PR\'s files, and where', () => {
  const files = [
    { filename: 'app/proguard-rules.pro', patch: '@@ -1 +1 @@\n-a\n+b' },
    { filename: 'app/src/main/java/x/LegacySignalHandler.kt', patch: '@@ -1,2 +1,3 @@\n class LegacySignalHandler {\n+  fun initialiseBureau() {}\n }' },
    { filename: 'openspec/changes/x/tasks.md', patch: '@@ -0,0 +1,3 @@\n+- [ ] 2.1 Tighten `proguard-rules.pro`\n+- [x] 2.2 Call `initialiseBureau()` from `LegacySignalHandler.start`\n+- [ ] 2.3 Mention `Unrelated` and `app/Other.kt`' },
  ];
  const ix = codeIndex(files);
  assert.deepEqual(refTo('proguard-rules.pro', ix), { path: 'app/proguard-rules.pro' });
  assert.deepEqual(refTo('app/proguard-rules.pro:12', ix), { path: 'app/proguard-rules.pro' });
  assert.deepEqual(refTo('initialiseBureau()', ix), { path: 'app/src/main/java/x/LegacySignalHandler.kt', line: 2 }); // its declaration
  assert.deepEqual(refTo('LegacySignalHandler#start', ix), { path: 'app/src/main/java/x/LegacySignalHandler.kt', line: 1 }); // start isn't declared: its class
  assert.equal(refTo('Unrelated', ix), null);
  assert.equal(refTo('run the build', ix), null);
  assert.equal(refTo('tasks.md', ix), null); // specs aren't code
  const refs = specRefs(files, ix);
  assert.deepEqual(refs.get('app/proguard-rules.pro'), [{ spec: 'openspec/changes/x/tasks.md', line: 1, label: 'tasks.md 2.1' }]);
  assert.deepEqual(refs.get('app/src/main/java/x/LegacySignalHandler.kt'), [{ spec: 'openspec/changes/x/tasks.md', line: 2, label: 'tasks.md 2.2' }]);
  // The preview: from a little above the declaration; else from the file's first change.
  const patch = '@@ -1,6 +1,7 @@\n a\n b\n c\n d\n+fun go() {}\n e\n f';
  assert.deepEqual(peekLines(patch, 5, 3).map((l) => l.text), ['c', 'd', 'fun go() {}']);
  assert.deepEqual(peekLines(patch, undefined, 2).map((l) => l.text), ['c', 'd']);
  const imports = '@@ -1,3 +1,4 @@\n import a\n+import b\n import c\n@@ -10,3 +11,4 @@\n class X {\n   val y = 1\n+  val z = 2\n }';
  assert.deepEqual(peekLines(imports, undefined, 2).map((l) => l.text), ['class X {', '  val y = 1']); // past the added import
  // A spec's preview: the block around the line, between blank lines.
  const spec = '@@ -0,0 +1,7 @@\n+# Tasks\n+\n+## 2. Dead rules\n+- [x] 2.1 In `a.pro`, delete\n+- [x] 2.2 Build\n+\n+## 3. Live';
  assert.equal(docSnippet(spec, 4), '## 2. Dead rules\n- [x] 2.1 In `a.pro`, delete\n- [x] 2.2 Build');
});

test('testPhase: Given-When-Then and Arrange-Act-Assert comments', async () => {
  const { testPhase } = await import('../src/docs.ts');
  assert.deepEqual(testPhase('    // Given a logged-in user'), { kind: 'given', word: 'Given', rest: 'a logged-in user' });
  assert.deepEqual(testPhase('// when'), { kind: 'when', word: 'When', rest: '' });
  assert.deepEqual(testPhase('  # Then: it fails'), { kind: 'then', word: 'Then', rest: 'it fails' });
  assert.deepEqual(testPhase('/* Act */'), { kind: 'when', word: 'Act', rest: '' });
  assert.deepEqual(testPhase('// Assert - totals'), { kind: 'then', word: 'Assert', rest: 'totals' });
  assert.deepEqual(testPhase('// and the cache is warm'), { kind: 'and', word: 'And', rest: 'the cache is warm' });
  assert.equal(testPhase('// Givens are odd'), null);
  assert.equal(testPhase('val given = 1 // Given'), null); // a comment after code isn't a phase
  assert.equal(testPhase('// assertion helper'), null);
});

test('strings.xml: names and readable texts, the changed part', async () => {
  const { parseString, changedRange, stringHtml, isStringsXml } = await import('../src/strings.ts');
  assert.ok(isStringsXml('app/src/main/res/values-in/strings.xml'));
  assert.ok(!isStringsXml('app/src/main/res/layout/main.xml'));
  assert.deepEqual(parseString(`    <string name="otp_sent">We\\'ve sent a code to %1$s.\\nCheck &amp; enter it.</string>`), {
    lead: '    ', name: 'otp_sent', value: "We've sent a code to %1$s.\nCheck & enter it.", untranslated: false,
  });
  assert.equal(parseString('<string name="k" translatable="false">"  spaced "</string>')!.value, '  spaced ');
  assert.equal(parseString('<item quantity="one">%d day</item>')!.name, 'one');
  assert.equal(parseString('<string name="multi">'), null); // spans lines: left as XML
  assert.deepEqual(changedRange('Send code', 'Resend code'), [[0, 1], [0, 3]]); // S → Res
  assert.deepEqual(changedRange('Code sent to %1$s', 'Code sent again to %1$s'), [[10, 10], [10, 16]]);
  assert.match(stringHtml(parseString('<string name="a">Hi %1$s</string>')!), /sx-key">a<.*sx-arg">%1\$s</);
});

test('translations: a changed string against the other languages', async () => {
  const { changedStrings, translationNotes, stringsOf, isLocaleDir } = await import('../src/strings.ts');
  assert.ok(isLocaleDir('values') && isLocaleDir('values-in') && isLocaleDir('values-zh-rCN'));
  assert.ok(!isLocaleDir('values-night') && !isLocaleDir('values-v21') && !isLocaleDir('values-sw600dp'));
  const changed = changedStrings([
    { kind: '-', text: '<string name="sent">Code sent</string>' },
    { kind: '+', text: '<string name="sent">Code sent to %1$s</string>' },
    { kind: '+', text: '<string name="title">Verify</string>' },
    { kind: '+', text: '<string name="ok">OK</string>' },
    { kind: '+', text: '<string name="id" translatable="false">x</string>' },
  ]);
  assert.deepEqual([...changed.keys()], ['sent', 'title', 'ok']);
  const id = { dir: 'values-in', strings: stringsOf('<resources>\n<string name="sent">Kode dikirim</string>\n<string name="ok">\n  Oke\n</string>\n</resources>'), changed: new Set<string>() };
  assert.deepEqual(Object.fromEntries(translationNotes(changed, [id])), {
    sent: ['placeholders differ in values-in'], // %1$s added here only
    title: ['missing in values-in'],
  });
  const updated = { ...id, strings: new Map([['sent', 'Kode dikirim ke %1$s'], ['title', 'Verifikasi'], ['ok', 'Oke']]) };
  assert.deepEqual(Object.fromEntries(translationNotes(changed, [updated])), { sent: ['values-in not updated'] });
  assert.deepEqual(Object.fromEntries(translationNotes(changed, [{ ...updated, changed: new Set(['sent']) }])), {});
});

test('collapseReviews: comments posted one by one are one review, its strongest verdict', async () => {
  const { collapseReviews } = await import('../src/github.ts');
  const at = (m: number) => new Date(Date.UTC(2026, 10, 3, 7, m)).toISOString();
  const out = collapseReviews(
    [
      { state: 'COMMENTED', submittedAt: at(0) },
      { state: 'COMMENTED', submittedAt: at(3) },
      { state: 'CHANGES_REQUESTED', submittedAt: at(8) }, // within 10 min of the last: the same review
      { state: 'APPROVED', submittedAt: at(40) },
      { state: 'PENDING', submittedAt: null },
    ],
    [at(-60)], // asked an hour before
    at(-120),
  );
  assert.deepEqual(out.map((r) => [r.state, r.at]), [['CHANGES_REQUESTED', at(8)], ['APPROVED', at(40)]]);
  assert.equal(out[0].waited, 60 * 60_000);
});

test('isAway: Slack statuses that mean someone is out today', async () => {
  const { isAway } = await import('../src/slackmsg.ts');
  const s = (text: string, emoji = '', until = 0) => ({ text, emoji, until });
  for (const t of ['Out sick', 'Vacation', 'Out of office', 'OOO', 'Annual leave', 'Sick leave', 'on leave', 'Cuti'])
    assert.ok(isAway(s(t)), t);
  assert.ok(isAway(s('', ':palm_tree:')));
  assert.ok(!isAway(s('In a meeting', ':spiral_calendar_pad:')));
  assert.ok(!isAway(s('Working remotely', ':house_with_garden:')));
  assert.ok(!isAway(s('Vacation', '', 1000)), 'expired');
  assert.ok(!isAway(null));
});

test('alignChanges: removed lines beside their most similar added ones, in order, rows as many as the longer side', async () => {
  const { alignChanges } = await import('../src/diff.ts');
  // One line became several: it sits beside the one most like it, not the first.
  assert.deepEqual(
    alignChanges(['viewModel.onAction(DeviceChangeAction.FaceCaptureFailed(it)) }'], ['.onFailure {', 'if (cancelled) {', 'endAndReload()', '} else {', 'viewModel.onAction(DeviceChangeAction.FaceCaptureFailed(it))', '}']),
    [[null, 0], [null, 1], [null, 2], [null, 3], [0, 4], [null, 5]],
  );
  // Edited lines stay paired one to one.
  assert.deepEqual(alignChanges(['val a = 1', 'val b = 2'], ['val a = 10', 'val b = 20']), [[0, 0], [1, 1]]);
  // More removed than added: the added ones find their matches.
  assert.deepEqual(alignChanges(['import x', 'fun go() {', 'log()'], ['fun go(fast: Boolean) {']), [[0, null], [1, 0], [2, null]]);
  assert.deepEqual(alignChanges([], ['a', 'b']), [[null, 0], [null, 1]]);
});

test('relocate moves a draft with its lines, or gives up', () => {
  const old = ['a', 'b', 'c', 'd', 'e'];
  const all = (n: number) => parsePatch(`@@ -1,1 +1,${n} @@\n` + Array.from({ length: n }, (_, i) => `+${i}`).join('\n'));
  assert.deepEqual(relocate(old, old, all(5), 3, 3), { line: 3 }); // unchanged
  assert.deepEqual(relocate(old, ['x', 'y', ...old], all(7), 2, 3), { startLine: 4, line: 5 }); // shifted down
  assert.equal(relocate(old, ['a', 'b', 'C', 'd', 'e'], all(5), 3, 3), null); // the line changed
  assert.equal(relocate(old, ['x', ...old, ...old], all(11), 3, 3), null); // moved, and twice: can't tell
  assert.equal(relocate(old, ['x', 'y', ...old], all(3), 3, 3), null); // moved out of the diff
});

test('lint baseline: new and cleared suppressions, moves ignored', async () => {
  const { baselineChanges, isLintBaseline } = await import('../src/lintbaseline.ts');
  assert.ok(isLintBaseline('app/lint-baseline.xml') && !isLintBaseline('app/src/main/res/values/strings.xml'));
  const issue = (mark: string, id: string, file: string, line: string[]) =>
    [`<issue`, `id="${id}"`, `message="Call &quot;x&quot;">`, `<location`, `file="src/main/java/${file}"`].map((l) => mark + l).concat(line, [mark + `</issue>`]);
  const patch = [
    '@@ -1,20 +1,20 @@',
    ...issue(' ', 'Moved', 'A.kt', ['-line="3"/>', '+line="9"/>']), // only its line changed
    ...issue('-', 'Gone', 'B.kt', ['-line="4"/>']),
    ...issue('+', 'MissingPermission', 'C.kt', ['+line="7"/>']),
  ];
  const { added, removed } = baselineChanges('app/lint-baseline.xml', patch.join('\n'));
  assert.deepEqual(added.map((s) => [s.id, s.file, s.line, s.message]), [['MissingPermission', 'app/src/main/java/C.kt', 7, 'Call "x"']]);
  assert.deepEqual(removed.map((s) => s.id), ['Gone']);
});

test('reviewPlan: specs, build, models, code (each with its tests), other tests, resources', async () => {
  const { reviewPlan } = await import('../src/files.ts');
  const plan = reviewPlan([
    'openspec/changes/x/design.md',
    'app/src/main/java/a/model/Card.kt',
    'app/src/main/java/a/CardReader.kt',
    'app/src/test/java/a/CardReaderTest.kt',
    'app/build.gradle.kts',
    '.editorconfig',
    'app/src/main/AndroidManifest.xml',
    'app/src/main/res/values/strings.xml',
    'app/src/main/assets/fw.bin',
    'app/src/test/java/a/model/CardTest.kt',
    'app/src/test/java/a/CardReaderIT.kt',
    'app/src/test/java/a/PinPadTest.kt', // its subject isn't in the PR
  ]);
  assert.deepEqual(plan.map((s) => [s.title, s.paths.length]), [
    ['Specs and docs', 1], ['Build and config', 3], ['Models and contracts', 2], ['Implementation', 3], ['Tests', 1], ['Resources and assets', 2],
  ]);
  // A test right below what it tests, in that file's step.
  assert.deepEqual(plan[3].paths, ['app/src/main/java/a/CardReader.kt', 'app/src/test/java/a/CardReaderTest.kt', 'app/src/test/java/a/CardReaderIT.kt']);
  assert.deepEqual(plan[2].paths, ['app/src/main/java/a/model/Card.kt', 'app/src/test/java/a/model/CardTest.kt']);
  assert.deepEqual(plan[4].paths, ['app/src/test/java/a/PinPadTest.kt']);
});

test('gitattributes: filter=lfs, last rule wins', async () => {
  const { inLfs, isGenerated, parseGeneratedRules } = await import('../src/gitattributes.ts');
  const r = parseGeneratedRules('*.bin filter=lfs diff=lfs merge=lfs -text\napp/src/debug/** -filter\n*.lock linguist-generated');
  assert.ok(inLfs(r, 'app/src/main/assets/fw.bin'));
  assert.ok(!inLfs(r, 'app/src/debug/assets/fw.bin'));
  assert.ok(!inLfs(r, 'app/x.kt') && isGenerated(r, 'yarn.lock') && !isGenerated(r, 'a.bin'));
});

test('findSecrets: key shapes and literal passwords, not placeholders', async () => {
  const { findSecrets } = await import('../src/secrets.ts');
  const patch = [
    '@@ -1,1 +1,10 @@',
    '+-----BEGIN RSA PRIVATE KEY-----',
    '+MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
    '+storePassword = "hunter2hunter2"',
    '+val apiKey = BuildConfig.API_KEY',
    '+password: "${DB_PASSWORD}"',
    '+const token = "ghp_' + 'a'.repeat(36) + '"',
    '+keyPassword "changeme123"',
    ' val password = "context-not-added"',
    '+Vendor keys arrive as PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`); convert them',
    '+const k = "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7"',
  ].join('\n');
  assert.deepEqual(findSecrets([{ filename: 'app/x.kt', patch }]).map((s) => [s.line, s.kind]), [
    [1, 'Private key'], [3, 'A literal storePassword'], [6, 'GitHub token'], [10, 'Private key'],
  ]);
});

test('manifest: permissions and exported components, before and after', async () => {
  const { manifestChanges, isRisky } = await import('../src/manifest.ts');
  const before = `<manifest><uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.READ_SMS"/>
    <application><activity android:name=".Main" android:exported="true"><intent-filter/></activity>
    <service android:name=".Sync" android:exported="false"/></application></manifest>`;
  const after = `<manifest><uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
    <!-- <uses-permission android:name="android.permission.CAMERA"/> -->
    <application><activity android:name=".Main" android:exported="true"><intent-filter/></activity>
    <service android:name=".Sync" android:exported="true"/>
    <receiver android:name=".Boot"><intent-filter><action android:name="BOOT"/></intent-filter></receiver></application></manifest>`;
  const c = manifestChanges(before, after);
  assert.deepEqual(c.added, ['android.permission.BLUETOOTH_CONNECT']);
  assert.deepEqual(c.removed, ['android.permission.READ_SMS']);
  assert.deepEqual(c.newComps.map((x) => [x.name, x.exported, x.implicit]), [['.Boot', true, true]]);
  assert.deepEqual(c.nowExported.map((x) => x.name), ['.Sync']);
  assert.ok(isRisky('android.permission.BLUETOOTH_CONNECT') && !isRisky('android.permission.INTERNET'));
});

test('depChanges: gradle, catalog and npm; upgrades, adds, removes', async () => {
  const { depChanges } = await import('../src/deps.ts');
  const gradle = ['@@ -1,4 +1,4 @@', '-    implementation("com.squareup.okhttp3:okhttp:4.12.0")', '+    implementation("com.squareup.okhttp3:okhttp:5.0.0")', '+    implementation(libs.timber)', '-    testImplementation "junit:junit:4.13.2"', '     // implementation("x:y:1.0")'].join('\n');
  const toml = ['@@ -1,3 +1,3 @@', '-retrofit = "2.9.0"', '+retrofit = "2.11.0"', '+room-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }'].join('\n');
  const npm = ['@@ -1,5 +1,5 @@', '-  "version": "1.7.3",', '+  "version": "1.8.0",', '-    "preact": "^10.19.0",', '+    "preact": "^10.24.0",', '     "build": "vite build"'].join('\n');
  const got = depChanges([{ filename: 'app/build.gradle.kts', patch: gradle }, { filename: 'gradle/libs.versions.toml', patch: toml }, { filename: 'app/package.json', patch: npm }]);
  assert.deepEqual(got.map((d) => [d.name, d.from ?? null, d.to ?? null, !!d.major]), [
    ['com.squareup.okhttp3:okhttp', '4.12.0', '5.0.0', true],
    ['libs.timber', null, null, false],
    ['junit:junit', '4.13.2', null, false],
    ['retrofit (version)', '2.9.0', '2.11.0', false],
    ['androidx.room:room-runtime', null, null, false],
    ['preact', '^10.19.0', '^10.24.0', false],
  ]);
});

test('depChanges: versions not pinned (snapshot, dynamic, latest, git branch), pinned ones not', async () => {
  const { depChanges } = await import('../src/deps.ts');
  const gradle = ['@@ -1,1 +1,6 @@', '+    implementation("com.acme:pay:2.1.0-SNAPSHOT")', '+    implementation("com.acme:ui:1.+")', '+    implementation("com.acme:log:latest.release")', '+    implementation("com.acme:net:[1.0,2.0)")', '+    implementation("com.acme:ok:1.2.3")'].join('\n');
  const toml = ['@@ -1,1 +1,2 @@', '+acme = "3.+"', '+core = "1.4.0"'].join('\n');
  const npm = ['@@ -1,1 +1,8 @@', '+    "left-pad": "*",', '+    "kit": "latest",', '+    "ui": "github:acme/ui#main",', '+    "sdk": "git+https://github.com/acme/sdk.git",', '+    "fmt": "acme/fmt#3f2a9c1",', '+    "lib": "github:acme/lib#v2.1.0",', '+    "preact": "^10.24.0",', '+    "dev": "vite"'].join('\n');
  const got = depChanges([{ filename: 'build.gradle.kts', patch: gradle }, { filename: 'gradle/libs.versions.toml', patch: toml }, { filename: 'package.json', patch: npm }]);
  assert.deepEqual(got.map((d) => [d.name, !!d.unpinned]), [
    ['com.acme:pay', true], ['com.acme:ui', true], ['com.acme:log', true], ['com.acme:net', true], ['com.acme:ok', false],
    ['acme (version)', true], ['core (version)', false],
    ['left-pad', true], ['kit', true], ['ui', true], ['sdk', true], ['fmt', false], ['lib', false], ['preact', false],
  ]);
  assert.equal(got.find((d) => d.name === 'ui')!.unpinned, 'git branch main');
});

test('findHardcoded: UI text in layouts and code, not ids, resources, tests or previews', async () => {
  const { findHardcoded } = await import('../src/hardcoded.ts');
  const layout = ['@@ -1,1 +1,5 @@', '+    android:text="Simpan data"', '+    android:text="@string/save"', '+    tools:text="Preview only"', '+    android:hint="Nomor HP"'].join('\n');
  const kt = [
    '@@ -1,1 +1,12 @@',
    '+        Text("Pindah ke BukuAgen")',
    '+        Text(stringResource(R.string.cta))',
    '+        Toast.makeText(context, "Gagal menyimpan", Toast.LENGTH_SHORT).show()',
    '+        Log.d(TAG, "loaded items")',
    '+        binding.title.text = "${user.name}"',
    '+        analytics.track(event = "screen_view")',
    '+@Preview',
    '+@Composable',
    '+fun CardPreview() { Text("Sample") }',
    '+private val PREVIEW_STATE = State(',
    '+    title = "Masukkan kode OTP",',
    '+)',
  ].join('\n');
  const got = findHardcoded([
    { filename: 'app/src/main/res/layout/activity_main.xml', patch: layout },
    { filename: 'app/src/main/java/a/Screen.kt', patch: kt },
    { filename: 'app/src/test/java/a/ScreenTest.kt', patch: kt },
  ]);
  assert.deepEqual(got.map((h) => [h.path.split('/').pop(), h.line, h.text]), [
    ['activity_main.xml', 1, 'Simpan data'], ['activity_main.xml', 4, 'Nomor HP'],
    ['Screen.kt', 1, 'Pindah ke BukuAgen'], ['Screen.kt', 3, 'Gagal menyimpan'],
  ]);
});

test('room: stored-field changes in an entity, unless the database version is raised', async () => {
  const { roomCheck, schemaLines } = await import('../src/room.ts');
  const entity = ['@@ -3,6 +3,8 @@', ' @Entity(tableName = "card")', ' data class CardEntity(', '     @PrimaryKey val id: String,', '+    val nickname: String?,', '+    @Ignore val cached: Boolean = false,', '     val last4: String,', ' ) {', '+    fun label() = "x"', ' }'].join('\n');
  assert.deepEqual(schemaLines('a/CardEntity.kt', entity).map((l) => l.line), [6]);
  assert.deepEqual(schemaLines('a/X.kt', ['@@ -1,2 +1,2 @@', '-    val deleted: Int,', '+    var deleted: Int = 0,', '-    val name: String', '+    val title: String'].join('\n')).map((l) => l.text), ['val name: String', 'val title: String']);
  const files = [{ filename: 'app/src/main/java/a/db/CardEntity.kt', status: 'modified', patch: entity }];
  const full = '@Entity(tableName = "card")\ndata class CardEntity(';
  const got = await roomCheck(files, async () => full);
  assert.deepEqual(got.map((c) => [c.entity, c.line]), [['CardEntity', 6]]);
  const db = { filename: 'app/src/main/java/a/db/AppDatabase.kt', status: 'modified', patch: ['@@ -1,2 +1,2 @@', ' @Database(entities = [CardEntity::class],', '-    version = 4)', '+    version = 5)'].join('\n') };
  assert.deepEqual(await roomCheck([...files, db], async (f) => (f.filename.endsWith('AppDatabase.kt') ? db.patch : full)), []);
  const notEntity = [{ filename: 'app/src/main/java/a/model/Card.kt', status: 'modified', patch: entity.replace('@Entity(tableName = "card")', '@Serializable') }];
  assert.deepEqual(await roomCheck(notEntity, async () => 'data class Card('), []);
});

test('spring: Flyway edits and order, private @Transactional, JPA entity without a migration', async () => {
  const { migrationIssues, migrationVersion, privateTransactional, entityWithoutMigration } = await import('../src/spring.ts');
  assert.equal(migrationVersion('a/db/migration/V2026_11_02_1__fleet.sql'), '2026.11.02.1');
  assert.equal(migrationVersion('a/db/migration/202009101700__setup.sql'), '202009101700');
  const dir = 'svc/src/main/resources/db/migration';
  const existing = new Map([[dir, [`${dir}/v20250201__a.sql`, `${dir}/v20250301__b.sql`]]]);
  const got = migrationIssues([
    { filename: `${dir}/v20250201__a.sql`, status: 'modified', patch: '@@ -1 +1 @@\n-ALTER TABLE a ADD x int;\n+ALTER TABLE a ADD x bigint;' },
    { filename: `${dir}/v20250215__late.sql`, status: 'added', patch: '' },
    { filename: `${dir}/v20250301__dup.sql`, status: 'added', patch: '' },
    { filename: `${dir}/v20250401__new.sql`, status: 'added', patch: '' },
    { filename: `${dir}/R__views.sql`, status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' },
  ], existing);
  assert.deepEqual(got.map((i) => [i.path.split('/').pop(), i.kind]), [['v20250201__a.sql', 'edited'], ['v20250215__late.sql', 'older'], ['v20250301__dup.sql', 'duplicate']]);
  const tx = ['@@ -1,1 +1,4 @@', '+    @Transactional', '+    private void settle(Payment p) {', '+    @Transactional', '+    public void pay(Payment p) {'].join('\n');
  assert.deepEqual(privateTransactional([{ filename: 'svc/src/main/java/PayService.java', status: 'modified', patch: tx }]).map((x) => x.line), [1]);
  const entity = { filename: 'svc/src/main/java/persistence/PaymentEntity.java', status: 'modified', patch: '@@ -5,2 +5,3 @@\n     private String id;\n+    private BigDecimal fee;\n     private String status;' };
  const jpa = '@Entity\n@Table(name = "payments")\npublic class PaymentEntity {';
  assert.deepEqual((await entityWithoutMigration([entity], async () => jpa)).map((x) => [x.entity, x.line]), [['PaymentEntity', 6]]);
  assert.deepEqual(await entityWithoutMigration([entity, { filename: `${dir}/v20250501__fee.sql`, status: 'added', patch: '' }], async () => jpa), []);
});

test('web: focused tests, debugger, raw HTML, lockfile drift', async () => {
  const { focused, rawHtml, lockfileDrift } = await import('../src/web.ts');
  const spec = { filename: 'src/cart.test.ts', status: 'modified', patch: ['@@ -1,1 +1,4 @@', "+describe.only('cart', () => {", "+  it('adds', () => {})", '+  // it.only is fine in a comment', '+  debugger'].join('\n') };
  const app = { filename: 'src/Cart.vue', status: 'modified', patch: ['@@ -1,1 +1,5 @@', '+  <div v-html="note"></div>', '+  // @ts-ignore', '+  el.innerHTML = html', '+  if (el.innerHTML == "") {}', '+  // eslint-disable-next-line no-console'].join('\n') };
  assert.deepEqual(focused([spec, app]).map((h) => [h.line, h.what]), [[1, 'describe.only'], [4, 'debugger']]);
  assert.deepEqual(rawHtml([app, spec]).map((h) => [h.line, h.what]), [[1, 'v-html'], [3, '.innerHTML =']]);
  const pkg = { filename: 'web/package.json', status: 'modified', patch: ['@@ -5,3 +5,3 @@', '-    "vue": "^3.4.0",', '+    "vue": "^3.5.0",'].join('\n') };
  assert.deepEqual(await lockfileDrift([pkg], async () => ['package.json', 'package-lock.json']), [{ path: 'web/package.json', line: 5, lock: 'package-lock.json' }]);
  assert.deepEqual(await lockfileDrift([pkg, { filename: 'web/package-lock.json', status: 'modified' }], async () => ['package-lock.json']), []);
  assert.deepEqual(await lockfileDrift([pkg], async () => ['package.json']), []); // no lockfile there: nothing to drift
});

test('switchedOff: tests skipped and checks silenced, in any language; moved lines and docs ignored', async () => {
  const { switchedOff } = await import('../src/switchedoff.ts');
  const p = (filename: string, ...lines: string[]) => ({ filename, patch: ['@@ -1,1 +1,9 @@', ...lines].join('\n') });
  const got = switchedOff([
    p('app/src/test/java/a/CartTest.kt', '+    @Ignore("flaky")', '+    @Test fun adds() {}'),
    p('src/cart.test.ts', "+  it.skip('adds', () => {})", "+  xit('removes', () => {})", "+  await load('t', { skip: true })"),
    p('app/src/test/java/a/PayTest.kt', '+        pending?.onResult(ok)'),
    p('spec/cart_spec.rb', "+  pending 'needs the new API'"),
    p('tests/test_pay.py', '+@pytest.mark.skip(reason="later")'),
    p('pay/pay_test.go', '+\tt.Skip("needs db")'),
    p('app/src/main/java/a/Cart.kt', '+@Suppress("UNCHECKED_CAST")', '+    @Ignore val cached: Int = 0', '+    val skip: Boolean'),
    p('src/cart.ts', '+  // @ts-ignore', '+  // eslint-disable-next-line no-console', '+  // @ts-expect-error: typed later'),
    p('lib/pay.py', '+import os  # noqa: F401', '+x = y  # type: ignore[assignment]'),
    p('pay/pay.go', '+\tdefer f.Close() //nolint:errcheck'),
    p('app/src/main/res/layout/a.xml', '+    tools:ignore="HardcodedText"'),
    p('src/moved.ts', '-// @ts-ignore', '+  // @ts-ignore'),
    { ...p('app/src/main/java/a/New.kt', '+@Suppress("MagicNumber")', '+// @ts-ignore'), status: 'added' }, // in a new file too
    p('README.md', '+Use `@Suppress("X")` sparingly.'),
  ]).map((x) => [x.what, x.test]);
  assert.deepEqual(got, [
    ['@Ignore("flaky")', true], ['it.skip(', true], ['xit(', true], ['pending', true], ['@pytest.mark.skip', true], ['t.Skip(', true],
    ['@Suppress("UNCHECKED_CAST")', false], // @Ignore and skip outside tests aren't tests
    ['@ts-ignore', false], ['eslint-disable-next-line no-console', false], ['# noqa: F401', false], ['# type: ignore[assignment]', false],
    ['//nolint:errcheck', false], ['tools:ignore="HardcodedText"', false], ['@Suppress("MagicNumber")', false], ['@ts-ignore', false],
  ]);
});

test('switchedOff: CI let off in workflows and scripts', async () => {
  const { switchedOff } = await import('../src/switchedoff.ts');
  const p = (filename: string, ...lines: string[]) => ({ filename, patch: ['@@ -1,1 +1,9 @@', ...lines].join('\n') });
  const got = switchedOff([
    p('.github/workflows/ci.yml', '+        continue-on-error: true', '+    if: false', '+      - run: npm run lint || true', '+          kill $PID 2>/dev/null || true', '+          files=$(git diff --name-only || true)', '+      - run: ./gradlew build -x test', "+    if: github.event_name == 'push'"),
    p('.gitlab-ci.yml', '+  allow_failure: true'),
    p('scripts/release.sh', '+git commit --no-verify -m wip', '+echo done || true'),
    p('src/app.ts', '+const x = a || true'),
  ]).map((x) => [x.what, !!x.ci]);
  assert.deepEqual(got, [
    ['continue-on-error: true', true], ['if: false', true], ['|| true', true], ['-x test', true],
    ['allow_failure: true', true], ['--no-verify', true],
  ]);
});

test('protectionsOff: release builds readable, debuggable, cleartext, TLS unchecked; debug and tests not', async () => {
  const { protectionsOff } = await import('../src/switchedoff.ts');
  const p = (filename: string, ...lines: string[]) => ({ filename, patch: ['@@ -1,1 +1,9 @@', ...lines].join('\n') });
  const got = protectionsOff([
    p('app/build.gradle.kts', '     buildTypes {', '         release {', '-            isMinifyEnabled = true', '+            isMinifyEnabled = false', '         }', '         debug {', '-            isMinifyEnabled = true', '+            isMinifyEnabled = false'),
    p('app/build.gradle', '         release {', '             signingConfig signingConfigs.release', '-            minifyEnabled true', '+            minifyEnabled false'),
    p('lib/build.gradle.kts', '         release {', '+            isMinifyEnabled = false'), // a library's default
    p('app/proguard-rules.pro', '+-dontobfuscate', '+-keep class ** { *; }', '+-keep class com.acme.Model { *; }'),
    p('app/src/main/AndroidManifest.xml', '+        android:usesCleartextTraffic="true"', '+        android:debuggable="true"'),
    p('app/src/debug/AndroidManifest.xml', '+        android:usesCleartextTraffic="true"'),
    p('app/src/main/res/xml/network_security_config.xml', '+    <base-config cleartextTrafficPermitted="true">', '+            <certificates src="user" />'),
    p('app/src/main/res/xml/nsc.xml', '+    <debug-overrides>', '+        <trust-anchors>', '+            <certificates src="user" />', '+    </debug-overrides>'),
    p('api/client.py', '+    r = requests.get(url, verify=False)'),
    p('net/client.go', '+\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},'),
    p('app/src/main/java/a/Net.kt', '+        .hostnameVerifier { _, _ -> true }'),
    p('app/src/test/java/a/NetTest.kt', '+        .hostnameVerifier { _, _ -> true }'),
  ]).map((x) => x.what);
  assert.deepEqual(got, [
    'isMinifyEnabled = false', 'minifyEnabled false', '-dontobfuscate', '-keep class ** { *; }',
    'android:usesCleartextTraffic="true"', 'android:debuggable="true"', 'cleartextTrafficPermitted="true"', '<certificates src="user"',
    'verify=False', 'InsecureSkipVerify: true', 'hostnameVerifier { _, _ -> true',
  ]);
});

test('earlierVerdicts: a person\'s replaced verdicts fold under their latest', async () => {
  const { earlierVerdicts } = await import('../src/github.ts');
  const v = (id: string, author: string, state: string | undefined, at: string, bot = false) => ({ id, author, state: state as any, at, bot });
  const got = earlierVerdicts([
    v('r1', 'andika', 'CHANGES_REQUESTED', '1'), v('c2', 'andika', undefined, '2'), v('r3', 'budi', 'APPROVED', '3'),
    v('r4', 'andika', 'APPROVED', '4'), v('r5', 'cubic', 'CHANGES_REQUESTED', '5', true), v('r6', 'cubic', 'APPROVED', '6', true),
  ]);
  assert.deepEqual([...got], [['r4', ['r1']]]); // comments, other people and bots untouched
});

test('markProps: a theme\'s colours for lgtm\'s marks only where they read at 4.5:1', async () => {
  const { markProps, contrast } = await import('../src/look.ts');
  const { BUILTIN_THEMES } = await import('../src/themes.ts');
  const ayu = markProps(BUILTIN_THEMES.ayu)['--c-attn'];
  assert.match(ayu, /^light-dark\(#9a6700, /); // Ayu Light's amber is too pale: lgtm's own
  assert.ok(!ayu.endsWith('#d29922)')); // Ayu Dark's reads well: the theme's
  for (const t of Object.values(BUILTIN_THEMES))
    for (const [k, v] of Object.entries(markProps(t)))
      if (k !== '--c-bad-tint') {
        const [, l, d] = v.match(/^light-dark\((#\w+), (#\w+)\)$/)!;
        if (l !== '#' && t.light['--bg']) assert.ok(contrast(l, t.light['--bg']) >= 4.5 || ['#9a6700', '#bf8700', '#8a5300', '#cf222e', '#1a7f37', '#0b5cad', '#57606a'].includes(l), `${k} light`);
        if (t.dark['--bg']) assert.ok(contrast(d, t.dark['--bg']) >= 4.5 || ['#d29922', '#e3b341', '#f85149', '#3fb950', '#79b8ff', '#9da7b3', '#56d364'].includes(d), `${k} dark`);
      }
});

test('repoLabel: the repo name alone, unless two owners have one by that name', async () => {
  const { knowRepos, repoLabel } = await import('../src/platform.ts');
  knowRepos(['bukuwarung/bukuwarung-app', 'bukuwarung/lgtm', 'someone/lgtm']);
  assert.equal(repoLabel('bukuwarung/bukuwarung-app'), 'bukuwarung-app');
  assert.equal(repoLabel('bukuwarung/lgtm'), 'bukuwarung/lgtm');
  assert.equal(repoLabel('someone/lgtm'), 'someone/lgtm');
});

test('merge box: do-not-merge signs, and required checks that never ran', async () => {
  const { holdSigns, neverRan } = await import('../src/github.ts');
  assert.deepEqual(holdSigns('[WIP] Payment retries', ['bug', 'do-not-merge', 'On Hold'], 'wip: halfway'), ['the “do-not-merge” label', 'the “On Hold” label', 'its title', 'the last commit (“wip: halfway”)']);
  assert.deepEqual(holdSigns('Wipe old caches', ['wipe'], 'Fix DNMS lookup'), []);
  const done = [{ name: 'CI / build', state: 'success' as const }, { name: 'lint', state: 'failure' as const }];
  assert.deepEqual(neverRan(['build', 'lint', 'e2e'], done), ['e2e']);
  assert.deepEqual(neverRan(['e2e'], [...done, { name: 'CI / test', state: 'pending' as const }]), []); // still running: may yet come
});

test('expertise: who wrote the lines a PR touches', async () => {
  const { touchedLines, tally, whoKnows } = await import('../src/expertise.ts');
  const patch = ['@@ -10,4 +10,5 @@', ' a', '-b', '+B', '+C', ' d', ' e'].join('\n');
  assert.deepEqual(touchedLines(patch), [10, 11, 12, 13]);
  const by = tally([{ startingLine: 1, endingLine: 11, login: 'rina' }, { startingLine: 12, endingLine: 20, login: 'budi' }], [10, 11, 12, 13]);
  assert.deepEqual([...by], [['rina', 2], ['budi', 2]]);
  const k = whoKnows([{ path: 'Pay.kt', lines: 4, by }, { path: 'Cart.kt', lines: 4, by: new Map([['rina', 4]]) }]);
  assert.deepEqual(k.map((x) => [x.login, x.share, x.file]), [['rina', 0.75, 'Cart.kt'], ['budi', 0.25, 'Pay.kt']]);
});

test('agentSays: a comment opening with 🤖, after any hidden markers', async () => {
  const { agentSays } = await import('../src/github.ts');
  assert.ok(agentSays('🤖 Posted by an agent.'));
  assert.ok(agentSays('<!-- pr-human-review-check -->\n🤖 Posted by an agent.\n\n### Commits added after approval'));
  assert.ok(agentSays('  \n🤖 Follow-up on the detekt config'));
  assert.ok(!agentSays('Looks good 🤖'));
  assert.ok(!agentSays('<!-- marker -->\nCommits added after approval'));
  assert.ok(!agentSays(undefined));
});

test('firstParagraph: the PR description for the QA request', async () => {
  const { firstParagraph } = await import('../src/slackmsg.ts');
  assert.equal(firstParagraph('<!-- template -->\n## Summary\nRetries failed charges\nthree times.\n\nMore.'), 'Retries failed charges three times.');
  assert.equal(firstParagraph('![shot](x.png)\n\nFixes the PIN pad.'), 'Fixes the PIN pad.');
  assert.equal(firstParagraph(null), '');
  assert.ok(firstParagraph('word '.repeat(200)).endsWith('…'));
  // Jira-only openings, headings and quotes skipped; links as their text.
  assert.equal(firstParagraph('JIRA: [BUKU-1](https://x/browse/BUKU-1) (phases 1–3)\n\n## Summary\n\nRemoves the [blanket](https://x) keeps.'), 'Removes the blanket keeps.');
  assert.equal(firstParagraph('## JIRA\n[BUKU-2](https://x/browse/BUKU-2)\n\n> **Draft.**\n\n## Problem\nKey loading truncates the TMK.'), 'Key loading truncates the TMK.');
});

test('PR and GitLab MR addresses', () => {
  assert.deepEqual(parsePrUrl('https://github.com/o/r/pull/12'), { repo: 'o/r', n: 12 });
  assert.deepEqual(parsePrUrl('#/o/r.js/pull/3'), { repo: 'o/r.js', n: 3 });
  assert.deepEqual(parsePrUrl('https://gitlab.com/gitlab-org/cli/-/merge_requests/4345#note_1'), { repo: 'gitlab.com/gitlab-org/cli', n: 4345 });
  assert.deepEqual(parsePrUrl('https://git.example.co.id:8443/a/b/c/-/merge_requests/7'), { repo: 'git.example.co.id:8443/a/b/c', n: 7 });
  assert.deepEqual(parsePrUrl('#/gitlab.com/group/sub/proj/pull/9'), { repo: 'gitlab.com/group/sub/proj', n: 9 });
  assert.equal(parsePrUrl('https://gitlab.com/group/proj/-/issues/9'), null);
  assert.ok(isLab('gitlab.com/a/b') && !isLab('bukuwarung/lgtm') && !isLab('o/r.js'));
  assert.equal(numRef('gitlab.com/a/b', 4), '!4');
  assert.equal(numRef('o/r', 4), '#4');
});

test("GitLab's suggestion range", () => {
  const t = { id: 't', path: 'a.ts', line: 10, diffSide: 'RIGHT' } as any;
  const s = suggestionOf(t, { databaseId: 1, body: '```suggestion:-2+1\nX\n```', author: null } as any)!;
  assert.deepEqual([s.start, s.end, s.text], [8, 11, 'X\n']);
});

test('GitLab people reach Slack as login@host, never as a GitHub login', async () => {
  const { personKey } = await import('../src/platform.ts');
  const { fillSlack, prValues } = await import('../src/slackmsg.ts');
  assert.equal(personKey('gitlab.com/g/p', 'ana'), 'ana@gitlab.com');
  assert.equal(personKey('o/r', 'ana'), 'ana');
  const v = prValues({ repo: 'gitlab.com/g/p', number: 3, title: 'T', url: 'https://gitlab.com/g/p/-/merge_requests/3', author: 'ana' });
  assert.equal(fillSlack('{@author} {pr}', v), '<@gh:ana@gitlab.com> <https://gitlab.com/g/p/-/merge_requests/3|gitlab.com/g/p!3 T>');
});

test("GitLab comment positions: both lines on unchanged ones, line codes for a range", async () => {
  const { linePosition } = await import('../src/gitlab.ts');
  const patch = '@@ -10,3 +10,4 @@\n a\n-b\n+B\n+C\n d';
  assert.deepEqual(await linePosition({ path: 'x.ts', side: 'RIGHT', line: 10 }, patch), { old_line: 10, new_line: 10 });
  assert.deepEqual(await linePosition({ path: 'x.ts', side: 'RIGHT', line: 12 }, patch), { new_line: 12 });
  assert.deepEqual(await linePosition({ path: 'x.ts', side: 'LEFT', line: 11 }, patch), { old_line: 11 });
  const r: any = await linePosition({ path: 'x.ts', side: 'RIGHT', line: 13, startLine: 11 }, patch);
  assert.deepEqual([r.old_line, r.new_line], [12, 13]);
  assert.match(r.line_range.start.line_code, /^[0-9a-f]{40}_12_11$/);
  assert.equal(r.line_range.start.type, 'new');
  assert.match(r.line_range.end.line_code, /_12_13$/);
});

test("GitLab CODEOWNERS sections: a section's default owners for patterns that name none", async () => {
  const { sectionOwners } = await import('../src/gitlab.ts');
  const t = sectionOwners('* @all\n[Payments] @g/payments\napp/pay/\nlib/ @ana\n^[Docs][2] @docs\n*.md');
  assert.deepEqual(codeOwners(t, 'app/pay/x.kt'), ['@g/payments']);
  assert.deepEqual(codeOwners(t, 'lib/a.kt'), ['@ana']);
  assert.deepEqual(codeOwners(t, 'README.md'), ['@docs']);
  assert.deepEqual(codeOwners(t, 'src/x.kt'), ['@all']);
});

test('Claude prompts: the defaults read as before (a comment adds itself to the PR opener); your wording replaces them', async () => {
  const { prPrompt, commentPrompt, reviewDonePrompt } = await import('../src/prompts.ts');
  const pr = { html_url: 'https://github.com/o/r/pull/12', number: 12, title: 'Fix it', base: { ref: 'main' }, head: { ref: 'fix' } };
  assert.equal(prPrompt(pr, 'o/r'), "Let's look at this pull request: https://github.com/o/r/pull/12\n#12 Fix it (fix → main)\nRead it with `gh pr view 12 --repo o/r --comments` and `gh pr diff 12 --repo o/r`.");
  assert.equal(commentPrompt({ author: 'ana', text: 'Why?', url: 'u' }, pr, 'o/r', { path: 'a.kt', line: 3 }), `${prPrompt(pr, 'o/r')}\n\nA review comment from @ana on \`a.kt:3\`:\n\n> Why?\n\nComment: u\nHelp me address it.`);
  assert.equal(reviewDonePrompt(pr, 'APPROVE', '', []), 'I reviewed https://github.com/o/r/pull/12 (#12 Fix it) in lgtm and approved it.');
  const store = new Map([['claudePrompt.pr', 'Review {ref} on {site} ({kind}): {url}']]);
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null };
  try {
    assert.equal(prPrompt({ ...pr, html_url: 'https://gitlab.com/g/p/-/merge_requests/12' }, 'gitlab.com/g/p'), 'Review !12 on GitLab (merge request): https://gitlab.com/g/p/-/merge_requests/12');
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("an agent's fix is shifted back to the indentation of the lines it replaces", async () => {
  const { reindent } = await import('../src/prompts.ts');
  assert.equal(reindent('for (;;) x++;', '  for (;;) x--;'), '  for (;;) x++;');
  assert.equal(reindent('if (a) {\n  b();\n}', '    if (a) {\n      c();\n    }'), '    if (a) {\n      b();\n    }');
  assert.equal(reindent('    kept();', '    old();'), '    kept();'); // already indented
  assert.equal(reindent('a();\n\nb();', '\tx();'), '\ta();\n\n\tb();'); // blank lines stay blank
});

test("an agent finding's fix becomes a suggestion only for lines in the diff, re-indented; GitLab ranges say their size", async () => {
  const { suggestedFix } = await import('../src/agentreview.ts');
  const { noteBody } = await import('../src/gitlab.ts');
  const patch = '@@ -1,3 +1,3 @@\n fun a() {\n-  return x\n+  return y\n }';
  assert.equal(suggestedFix(patch, 2, 2, 'return z'), '```suggestion\n  return z\n```');
  assert.equal(suggestedFix(patch, 2, 3, '```kotlin\n  return z\n}\n```'), '```suggestion\n  return z\n}\n```');
  assert.equal(suggestedFix(patch, 2, 5, 'x'), null); // line 5 isn't in the diff
  assert.equal(suggestedFix(patch, 2, 2, '  return y'), null); // no change
  const body = 'Fix it\n\n```suggestion\n  return z\n}\n```';
  assert.equal(noteBody({ body, line: 3, startLine: 2 }), 'Fix it\n\n```suggestion:-1+0\n  return z\n}\n```');
  assert.equal(noteBody({ body, line: 3 }), body);
});

test('kept: a fetch is kept until it expires, asked once at a time, and the stale copy stands in when asking fails', async () => {
  const { kept } = await import('../src/platform.ts');
  const ls: any = { getItem: (k: string) => (k in ls.d ? ls.d[k] : null), setItem: (k: string, v: string) => void (ls.d[k] = v), removeItem: (k: string) => void delete ls.d[k], d: { 'kept:old': JSON.stringify({ until: 1, v: 0 }) } };
  const proxy = new Proxy(ls, { ownKeys: () => Object.keys(ls.d), getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true, value: ls.d[k as string] }) });
  (globalThis as any).localStorage = proxy;
  try {
    let calls = 0;
    const load = async () => ++calls;
    assert.deepEqual(await Promise.all([kept('n', load), kept('n', load)]), [1, 1]);
    assert.equal(await kept('n', load), 1);
    assert.equal(calls, 1);
    assert.equal(ls.d['kept:old'], undefined); // expired entries swept
    ls.d['kept:n'] = JSON.stringify({ until: 1, v: 7 });
    assert.equal(await kept('n', () => Promise.reject(new Error('offline'))), 7);
    await assert.rejects(kept('none', () => Promise.reject(new Error('offline'))));
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test('PR parts asked at once go to GitHub as one query, across PRs, each PR getting its own answer and its own errors', async () => {
  const { getThreads, getChecks } = await import('../src/github.ts');
  const bodies: string[] = [];
  const was = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const t = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'T1' }] };
    return new Response(JSON.stringify({
      data: { p0: { pullRequest: { reviewThreads: t, commits: { nodes: [] } } }, p1: { pullRequest: { reviewThreads: null } } },
      errors: [{ message: 'no threads for you', path: ['p1', 'pullRequest', 'reviewThreads'] }],
    }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const [a, b, c] = await Promise.allSettled([getThreads('acme/shop', 1), getThreads('acme/web', 2), getChecks('acme/shop', 1)]);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /p0:repository.*p1:repository/);
    assert.deepEqual(a.status === 'fulfilled' && a.value.map((t) => t.id), ['T1']);
    assert.equal(b.status === 'rejected' && (b.reason as Error).message, 'no threads for you');
    assert.deepEqual(c.status === 'fulfilled' && c.value, []);
  } finally {
    globalThis.fetch = was;
  }
});

test('hiddenChanges: changed lines whitespace-ignoring and import folding keep out of sight', async () => {
  const { hiddenChanges } = await import('../src/diff.ts');
  const patch = ['@@ -1,6 +1,7 @@', ' package com.acme', ' ', '-import a.B', '+import a.C', '+import a.D', ' ', '-fun x() {  }', '+fun x() { }', '+val y = 1'].join('\n');
  assert.deepEqual(hiddenChanges('src/X.kt', patch, true, true), { ws: 2, imports: 3 });
  assert.deepEqual(hiddenChanges('src/X.kt', patch, false, false), { ws: 0, imports: 0 });
  assert.deepEqual(hiddenChanges('notes.md', patch, false, true), { ws: 0, imports: 0 });
});

test('moveRuns: each side of moved code as one block, the other side between staying out of it', async () => {
  const { movedLines, moveRuns, parsePatch } = await import('../src/diff.ts');
  const a = parsePatch(['@@ -1,5 +1,1 @@', ' class A {', '-  fun one() = compute(1)', '-  fun two() = compute(2)', '+  // kept', '-  fun three() = compute(3)', ' }'].join('\n'));
  const b = parsePatch(['@@ -1,1 +1,4 @@', ' class B {', '+  fun one() = compute(1)', '+  fun two() = compute(2)', '+  fun three() = compute(3)', ' }'].join('\n'));
  const moved = movedLines([{ filename: 'A.kt', hunks: a }, { filename: 'B.kt', hunks: b }]);
  assert.deepEqual(moveRuns(a, moved.get('A.kt')), [{ hunk: 0, start: 1, end: 4, kind: '-', to: 'B.kt:2', count: 3 }]);
  assert.deepEqual(moveRuns(b, moved.get('B.kt')), [{ hunk: 0, start: 1, end: 3, kind: '+', to: 'A.kt:2', count: 3 }]);
  assert.deepEqual(moveRuns(a, undefined), []);
});
