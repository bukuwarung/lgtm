// Room (Android's SQLite layer): a PR that changes a table (an @Entity's stored fields) without raising the
// @Database version leaves installed apps with the old schema, and Room refuses to open it: the app crashes for
// existing users on update. Raising the version (with a migration, or a destructive fallback) is the PR's to do.
import { parsePatch } from './diff.ts';
import { inTests } from './files.ts';

type F = { filename: string; status: string; patch?: string };
export type SchemaChange = { path: string; entity: string; line: number; side: 'RIGHT' | 'LEFT'; text: string };

// A stored field's declaration: Kotlin val/var (not const, not a getter), or a Java field (not static); Room's
// column annotations too. @Ignore'd ones aren't columns.
const KT_FIELD = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|internal|public|override|open|lateinit)\s+)*va[lr]\s+\w+\s*:/;
const JAVA_FIELD = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|public|protected|final|transient)\s+)*[\w.<>[\], ]+\s+\w+\s*(?:=[^=]|;)/;
const COLUMN = /@(?:ColumnInfo|PrimaryKey|Embedded|Relation|Entity\s*\()/;

export const isEntity = (text: string) => /@Entity\b/.test(text);
export const mayBeEntity = (path: string) => /\.(kt|java)$/.test(path) && !inTests(path) && /(Entity|Table|Model)\.(kt|java)$|\/(entity|entities|db|database|room|model|models|local)\//i.test(path);

// Lines of a patch that change stored fields: the ones a reviewer would point at.
export function schemaLines(path: string, patch: string): { line: number; side: 'RIGHT' | 'LEFT'; text: string }[] {
  const field = path.endsWith('.java') ? JAVA_FIELD : KT_FIELD;
  const out: { line: number; side: 'RIGHT' | 'LEFT'; text: string }[] = [];
  for (const h of parsePatch(patch))
    h.lines.forEach((l, i) => {
      if (l.kind === ' ' || /^\s*(\/\/|\*|\/\*)/.test(l.text)) return;
      const ignored = /@Ignore\b/.test(l.text) || /@Ignore\b/.test(h.lines[i - 1]?.text ?? '');
      const stored = (field.test(l.text) && !/\bconst\b|\bstatic\b|\bget\(\)|\breturn\b/.test(l.text)) || COLUMN.test(l.text);
      if (stored && !ignored) out.push(l.kind === '+' ? { line: l.new!, side: 'RIGHT', text: l.text.trim() } : { line: l.old!, side: 'LEFT', text: l.text.trim() });
    });
  // A field removed and added the same (name, type, column annotations): only a modifier, a default or the order
  // changed, not the table.
  const key = (t: string) => t.replace(/\b(?:val|var|private|internal|public|protected|override|open|lateinit|final|transient)\b|=[^,)]*|[,;]\s*$|\s+/g, '');
  const was = new Map<string, number>();
  for (const x of out.filter((x) => x.side === 'LEFT')) was.set(key(x.text), (was.get(key(x.text)) ?? 0) + 1);
  const same = new Set<string>();
  for (const x of out.filter((x) => x.side === 'RIGHT')) if (was.get(key(x.text))) was.set(key(x.text), was.get(key(x.text))! - 1), same.add(key(x.text));
  return out.filter((x) => !same.has(key(x.text)));
}

// Does the PR raise a @Database's version (an added "version = N" in a file with @Database, or its patch)?
export function raisesVersion(files: F[], texts: Map<string, string>): boolean {
  return files.some((f) => {
    if (!f.patch || !(/@Database\b/.test(f.patch) || /@Database\b/.test(texts.get(f.filename) ?? ''))) return false;
    return parsePatch(f.patch).some((h) => h.lines.some((l) => l.kind === '+' && /\bversion\s*=\s*\d+/.test(l.text)));
  });
}

// The whole check: entity files changed in their stored fields, when no @Database version is raised. `read` fetches a
// file at the PR's head (or base, for a deleted one) when the patch alone doesn't show @Entity or @Database.
export async function roomCheck(files: F[], read: (f: F) => Promise<string | null>): Promise<SchemaChange[]> {
  const texts = new Map<string, string>();
  const changes: SchemaChange[] = [];
  const candidates = files.filter((f) => f.patch && /\.(kt|java)$/.test(f.filename) && !inTests(f.filename) && (isEntity(f.patch) || mayBeEntity(f.filename) || /Database/.test(f.filename)));
  await Promise.all(
    candidates.map(async (f) => {
      const text = /@(Entity|Database)\b/.test(f.patch!) && f.status !== 'modified' ? f.patch! : ((await read(f).catch(() => null)) ?? '');
      texts.set(f.filename, text);
      if (!isEntity(text)) return;
      const entity = text.match(/@Entity\b[\s\S]*?\b(?:class|record)\s+(\w+)/)?.[1] ?? f.filename.split('/').pop()!.replace(/\.\w+$/, '');
      // A new (or deleted) entity is a table only once (until) the database lists it: an added (removed) "X::class".
      const sign = f.status === 'added' ? '+' : f.status === 'removed' ? '-' : null;
      if (sign && !files.some((g) => g.patch?.split('\n').some((l) => l[0] === sign && new RegExp(`\\b${entity}::class\\b|\\b${entity}\\.class\\b`).test(l)))) return;
      for (const l of schemaLines(f.filename, f.patch!)) changes.push({ path: f.filename, entity, ...l });
    }),
  );
  return changes.length && !raisesVersion(files, texts) ? changes : [];
}
