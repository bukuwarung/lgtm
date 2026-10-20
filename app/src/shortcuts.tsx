import { useMemo } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Check, ConversationItem, Draft, PR, PRFile, Thread } from './github.ts';

export type File = PRFile & { generated: boolean };

// Scroll to an element by id, opening any collapsed <details> around it and flashing it. `near` is scrolled to
// first when the target isn't in the DOM yet (file bodies render lazily), then we wait for it to appear.
export function jumpTo(id: string, near?: string) {
  if (near && !document.getElementById(id)) document.getElementById(near)?.scrollIntoView();
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  };
  go();
}

const textOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 90);
const base = (path: string) => path.split('/').pop()!;

const VERDICT: Record<string, string> = { APPROVED: '✓ approved', CHANGES_REQUESTED: '✕ changes requested', COMMENTED: 'reviewed', DISMISSED: 'dismissed' };
const CHECK_ICON: Record<Check['state'], string> = { failure: '✕', pending: '●', success: '✓', neutral: '–' };

function Section({ title, count, extra, children }: { title: string; count: number; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <details open class="ix-sec">
      <summary>
        {title} <span class="count">{count}</span>
        {extra}
      </summary>
      {children}
    </details>
  );
}

function Entry({ label, meta, sub, dim, onClick }: { label: string; meta?: string; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button class={dim ? 'ix-item dim' : 'ix-item'} onClick={onClick} title={sub || label}>
      <span class="ix-label">
        {label} {meta && <span class="ix-meta">{meta}</span>}
      </span>
      {sub && <span class="ix-sub">{sub}</span>}
    </button>
  );
}

type IndexProps = {
  pr: PR;
  conversation: ConversationItem[];
  threads: Thread[];
  drafts: Draft[];
  checks: Check[] | null;
  onRefreshChecks: () => void;
  files: File[];
  counts: Counts;
};

// The PR Shortcut Index: jump to the description, any comment or review, CI checks, review threads, or a file.
export function ShortcutIndex({ pr, conversation, threads, drafts, checks, onRefreshChecks, files, counts }: IndexProps) {
  const excerpts = useMemo(() => conversation.map((c) => oneLine(textOf(c.html))), [conversation]);
  const order = new Map(files.map((f, i) => [f.filename, i]));
  const sortedThreads = [...threads].sort((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9) || (a.line ?? 0) - (b.line ?? 0));
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;

  return (
    <div class="index">
      <Section title="Conversation" count={conversation.length + 1}>
        <Entry label="Description" meta={pr.user.login} onClick={() => jumpTo('pr-description')} />
        {conversation.map((c, i) => (
          <Entry key={c.id} label={c.author} meta={c.state ? VERDICT[c.state] : 'commented'} sub={excerpts[i]} onClick={() => jumpTo('cv-' + c.id)} />
        ))}
      </Section>

      <Section
        title="Checks"
        count={checks?.length ?? 0}
        extra={
          <>
            {failing > 0 && <span class="ck-sum ck-failure">{failing} failing</span>}
            {pending > 0 && <span class="ck-sum ck-pending">{pending} running</span>}
            <span
              class="ix-refresh"
              role="button"
              tabIndex={0}
              title="Refresh checks"
              onClick={(e) => {
                e.preventDefault();
                onRefreshChecks();
              }}
            >
              ↻
            </span>
          </>
        }
      >
        {!checks ? (
          <p class="note ix-pad">Loading…</p>
        ) : !checks.length ? (
          <p class="note ix-pad">No checks.</p>
        ) : (
          checks.map((c) => (
            <a class="ix-item" href={c.url ?? undefined} target="_blank" rel="noopener" title={`${c.name}: ${c.summary}`}>
              <span class="ix-label">
                <span class={'ck ck-' + c.state}>{CHECK_ICON[c.state]}</span> {c.name}
              </span>
              {c.summary && <span class="ix-sub">{c.summary}</span>}
            </a>
          ))
        )}
      </Section>

      <Section title="Review threads" count={threads.length + drafts.length}>
        {drafts.map((d) => (
          <Entry
            key={d.id}
            label={`${base(d.path)}${d.line ? ':' + d.line : ''}`}
            meta="pending"
            sub={oneLine(d.body)}
            onClick={() => jumpTo('d-' + d.id, 'f-' + d.path)}
          />
        ))}
        {sortedThreads.map((t) => {
          const first = t.comments.nodes[0];
          return (
            <Entry
              key={t.id}
              label={`${base(t.path)}${t.line ? ':' + t.line : ''}`}
              meta={[first?.author?.login, t.isResolved && 'resolved', t.isOutdated && 'outdated'].filter(Boolean).join(' · ')}
              sub={oneLine(first?.bodyText ?? '')}
              dim={t.isResolved || t.isOutdated}
              onClick={() => jumpTo('t-' + t.id, 'f-' + t.path)}
            />
          );
        })}
        {!threads.length && !drafts.length && <p class="note ix-pad">No review threads.</p>}
      </Section>

      <Section title="Files" count={files.length}>
        <FileTree files={files} counts={counts} />
      </Section>
    </div>
  );
}

type TreeNode = { name: string; dirs: Map<string, TreeNode>; files: File[] };

function buildTree(files: File[]): TreeNode {
  const root: TreeNode = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.filename.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

type Counts = (path: string) => number;

export function FileTree({ files, counts }: { files: File[]; counts: Counts }) {
  const root = useMemo(() => buildTree(files), [files]);
  return <TreeChildren node={root} depth={0} counts={counts} />;
}

function TreeChildren({ node, depth, counts }: { node: TreeNode; depth: number; counts: Counts }) {
  return (
    <>
      {[...node.dirs.values()].sort((a, b) => byName(a.name, b.name)).map((d) => (
        <TreeDir key={d.name} node={d} depth={depth} counts={counts} />
      ))}
      {[...node.files].sort((a, b) => byName(a.filename, b.filename)).map((f) => {
        const c = counts(f.filename);
        return (
          <button
            key={f.filename}
            class="tree-file"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            title={f.filename}
            onClick={() => document.getElementById('f-' + f.filename)?.scrollIntoView()}
          >
            <span class={'fdot s-' + f.status} title={f.status} />
            <span class="tree-name">{f.filename.split('/').pop()}</span>
            {c > 0 && <span class="badge">💬{c}</span>}
          </button>
        );
      })}
    </>
  );
}

function TreeDir({ node, depth, counts }: { node: TreeNode; depth: number; counts: Counts }) {
  // Collapse single-child folder chains into one row ("src/core/utils"), as GitHub does.
  let n = node, name = node.name;
  while (!n.files.length && n.dirs.size === 1) {
    n = [...n.dirs.values()][0];
    name += '/' + n.name;
  }
  return (
    <details open class="tree-dir">
      <summary style={{ paddingLeft: `${8 + depth * 14}px` }} title={name}>{name}</summary>
      <TreeChildren node={n} depth={depth + 1} counts={counts} />
    </details>
  );
}

