// A pattern, whether it sets or unsets the attribute, and which: linguist-generated or linguist-binary.
export type Rule = [RegExp, boolean, 'generated' | 'binary'];

// gitattributes glob → RegExp. No "/" matches the basename at any depth; with "/" it is anchored to the root.
function globToRe(pattern: string): RegExp {
  const p = pattern.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') (re += '(?:.*/)?'), (i += 2);
      else (re += '.*'), i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|\\]/g, '\\$&'); // [...] classes pass through as-is
  }
  return new RegExp(pattern.includes('/') ? `^${re}$` : `(?:^|/)${re}$`);
}

export function parseGeneratedRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split('\n')) {
    const [pattern, ...attrs] = line.trim().split(/\s+/);
    if (!pattern || pattern.startsWith('#')) continue;
    for (const a of attrs) {
      const m = a.match(/^([-!]?)linguist-(generated|binary)(?:=(true|false))?$/);
      if (!m) continue;
      const on = !m[1] && m[3] !== 'false';
      try {
        rules.push([globToRe(pattern), on, m[2] as 'generated' | 'binary']);
      } catch {
        // malformed pattern: git ignores it too
      }
    }
  }
  return rules;
}

// Marked generated or binary; per attribute, the last matching rule wins, as in git.
const marked = (rules: Rule[], path: string, attr: Rule[2]) => rules.reduce((acc, [re, on, a]) => (a === attr && re.test(path) ? on : acc), false);
export const isGenerated = (rules: Rule[], path: string) => marked(rules, path, 'generated') || marked(rules, path, 'binary');
