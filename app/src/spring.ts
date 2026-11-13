// Java backends (Spring, JPA, Flyway): what breaks a deploy or silently doesn't work.
import { parsePatch } from './diff.ts';
import { inTests } from './files.ts';
import { NOT_ENTITY, schemaLines } from './room.ts';

type F = { filename: string; status: string; patch?: string; previous_filename?: string };

// Flyway: SQL migrations under a db/migration folder, "<prefix><version>__<what>.sql" (V, v, or none, as configured);
// R__ ones are repeatable (run again whenever they change).
export const isMigration = (path: string) => /(^|\/)db\/migration\/(.+\/)?[^/]+__[^/]*\.sql$/.test(path);
const repeatable = (path: string) => /\/R__[^/]*$/.test(path);
export const migrationVersion = (path: string) => path.split('/').pop()!.match(/^[A-Za-z]?(\d[\d._]*)__/)?.[1]?.replace(/_/g, '.') ?? null;
// Version order, part by part (1.10 after 1.9; 20200724115600 as one number).
export const compareVersions = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

export type MigrationIssue = { path: string; kind: 'edited' | 'older' | 'duplicate'; newest?: string };
// A versioned migration that was already there and is changed, renamed or deleted: Flyway checks every applied
// migration's checksum, and refuses to start when one differs. `existing`: each touched folder's files on the base.
export function migrationIssues(files: F[], existing: Map<string, string[]>): MigrationIssue[] {
  const out: MigrationIssue[] = [];
  for (const f of files) {
    const was = f.previous_filename ?? f.filename;
    if (isMigration(was) && !repeatable(was) && (f.status === 'modified' || f.status === 'removed' || (f.status === 'renamed' && was !== f.filename)) && (f.status !== 'modified' || f.patch == null || /^[-+](?!\s*(--.*)?$)/m.test(f.patch.replace(/^(\+\+\+|---).*$/gm, ''))))
      out.push({ path: f.filename, kind: 'edited' });
  }
  for (const f of files.filter((f) => f.status === 'added' && isMigration(f.filename) && !repeatable(f.filename))) {
    const v = migrationVersion(f.filename);
    const folder = f.filename.slice(0, f.filename.lastIndexOf('/'));
    const there = (existing.get(folder) ?? []).map(migrationVersion).filter((x): x is string => !!x);
    if (!v || !there.length) continue;
    const newest = there.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
    if (there.some((x) => compareVersions(x, v) === 0)) out.push({ path: f.filename, kind: 'duplicate' });
    else if (compareVersions(v, newest) < 0) out.push({ path: f.filename, kind: 'older', newest });
  }
  return out;
}

// @Transactional on a private method: Spring's proxy never sees the call, so it runs without a transaction.
export function privateTransactional(files: F[]): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  for (const f of files.filter((f) => f.patch && /\.(java|kt)$/.test(f.filename) && !inTests(f.filename)))
    for (const h of parsePatch(f.patch!))
      h.lines.forEach((l, i) => {
        if (l.kind !== '+' || !/@Transactional\b/.test(l.text)) return;
        const decl = h.lines.slice(i, i + 6).find((x) => /\b(fun|void|[A-Z]\w*(<[^>]*>)?)\s+\w+\s*\(/.test(x.text) || /\bfun\s/.test(x.text));
        if (decl && /\bprivate\b/.test(decl.text) && !/\bclass\b/.test(decl.text)) out.push({ path: f.filename, line: l.new! });
      });
  return out;
}

// A JPA entity (not Room's) whose stored fields change, in a PR that adds no migration: the database won't have them.
export const isJpaEntity = (text: string) => /@Entity\b/.test(text) && (/(javax|jakarta)\.persistence/.test(text) || /@Table\s*\(/.test(text)) && !/androidx\.room/.test(text);
export async function entityWithoutMigration(files: F[], read: (f: F) => Promise<string | null>) {
  if (files.some((f) => f.status === 'added' && isMigration(f.filename))) return [];
  const out: { path: string; entity: string; line: number; side: 'RIGHT' | 'LEFT'; text: string }[] = [];
  await Promise.all(
    files
      .filter((f) => f.patch && f.status !== 'removed' && /\.(java|kt)$/.test(f.filename) && !inTests(f.filename) && (/@Entity|@Column|@Table/.test(f.patch) || (!NOT_ENTITY.test(f.filename) && /(Entity|Model|Record)\.(java|kt)$|\/(entity|entities|model|domain|persistence)\//i.test(f.filename))))
      .map(async (f) => {
        const lines = schemaLines(f.filename, f.patch!);
        if (!lines.length) return;
        const text = (await read(f).catch(() => null)) ?? '';
        if (!isJpaEntity(text)) return;
        const entity = text.match(/@Entity\b[\s\S]*?\b(?:class|record)\s+(\w+)/)?.[1] ?? f.filename.split('/').pop()!.replace(/\.\w+$/, '');
        for (const l of lines) out.push({ path: f.filename, entity, ...l });
      }),
  );
  return out;
}
