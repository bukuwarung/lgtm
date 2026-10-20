export type Rule = [RegExp, boolean];

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
      const on = a === 'linguist-generated' || a === 'linguist-generated=true';
      const off = a === '-linguist-generated' || a === '!linguist-generated' || a === 'linguist-generated=false';
      if (!on && !off) continue;
      try {
        rules.push([globToRe(pattern), on]);
      } catch {
        // malformed pattern: git ignores it too
      }
    }
  }
  return rules;
}

// Last matching rule wins, as in git.
export const isGenerated = (rules: Rule[], path: string) =>
  rules.reduce((acc, [re, on]) => (re.test(path) ? on : acc), false);
