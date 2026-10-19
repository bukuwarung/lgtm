import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, anchor, parsePatch, removedRuns } from '../src/diff.ts';
import { isGenerated, parseGeneratedRules } from '../src/gitattributes.ts';
import { highlightHunks, languageFor, splitLines } from '../src/highlight.ts';
import { isMarkdown, renderChunks } from '../src/markdown.ts';

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
  assert.match(renderChunks('```js\nconst a = 1;\n```\n', new Set()).map((c) => c.html).join(''), /hljs-keyword/);
});
