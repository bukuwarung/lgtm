// Added lines that look like a secret: a private key, a known token shape, or a password or key assigned a literal.
// A guess to look at, not a verdict: placeholders, environment lookups and build-config references don't count, nor
// a test's literal passwords (made up for the test); a real key's shape counts anywhere.
import { parsePatch } from './diff.ts';
import { inTests } from './files.ts';

export type Secret = { path: string; line: number; kind: string };

// A private key: its BEGIN line starting the line (or a string), the key's base64 after it (on the next line, or after
// a \n in the same string); a docs line naming the format isn't one.
const PEM = /(?:^\s*|[=:(,+]\s*)["'`]?-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----(?:\\n)?([A-Za-z0-9+/=]{40,})?/;
const BASE64 = /^\s*["'`]?[A-Za-z0-9+/]{40,}={0,2}/;
const SHAPES: [RegExp, string][] = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{60,})\b/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\b[rs]k_live_[0-9A-Za-z]{20,}\b/, 'Stripe live key'],
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/, 'JWT'],
];
// name = "literal" (Kotlin, Java, JS, JSON, YAML, properties, Gradle): the name says secret, the value is a real string.
const ASSIGN = /\b([\w.-]*(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|storePassword|keyPassword))["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;
const PLACEHOLDER = /^(\$\{|<|%|\{\{)|x{4,}|\*{4,}|change.?me|your[_-]|example|dummy|placeholder|redacted|^(true|false|null|none)$/i;

export function findSecrets(files: { filename: string; patch?: string }[]): Secret[] {
  const out: Secret[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    for (const h of parsePatch(f.patch))
      for (const [i, l] of h.lines.entries()) {
        if (l.kind !== '+' || l.new == null) continue;
        const pem = l.text.match(PEM);
        if (pem && (pem[2] || BASE64.test(h.lines[i + 1]?.text ?? ''))) {
          out.push({ path: f.filename, line: l.new, kind: 'Private key' });
          continue;
        }
        const shape = SHAPES.find(([re]) => re.test(l.text));
        const a = shape ? null : l.text.match(ASSIGN);
        if (shape) out.push({ path: f.filename, line: l.new, kind: shape[1] });
        else if (a && !PLACEHOLDER.test(a[2]) && !inTests(f.filename)) out.push({ path: f.filename, line: l.new, kind: `A literal ${a[1]}` });
      }
  }
  return out;
}
