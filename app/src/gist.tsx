import { useEffect, useMemo, useState } from 'preact/hooks';
import { getGist, type Gist } from './github.ts';
import { splitPatch, type Line } from './diff.ts';
import { isMarkdown, md } from './markdown.ts';
import { highlightBlocks } from './highlight.ts';
import { CodeSnippet, Empty, Time, Who } from './tags.tsx';
import { FileIcon } from './shortcuts.tsx';
import { PageSkeleton } from './history.tsx';

// A gist, read-only: a patch in it as a diff, a file at a time (a commit's message above them); markdown rendered; the
// rest as highlighted code.
export function GistPage({ id }: { id: string }) {
  const [g, setG] = useState<Gist | null | undefined>(undefined);
  const [err, setErr] = useState('');
  useEffect(() => {
    setG(undefined);
    getGist(id).then(setG, (e) => (setErr(e.message), setG(null)));
  }, [id]);
  if (g === undefined) return <PageSkeleton title="the gist" />;
  if (!g) return <div role="main" class="page"><Empty tone="err" action={['Retry', () => (setErr(''), setG(undefined), getGist(id).then(setG, (e) => (setErr(e.message), setG(null))))]}>Couldn't load the gist: {err}</Empty></div>;
  const files = Object.values(g.files);
  return (
    <div role="main" class="page gist">
      <header class="gist-h">
        <h2>{g.description || files[0]?.filename || 'Gist'}</h2>
        <p class="note">
          {g.owner && <Who login={g.owner.login} src={g.owner.avatar_url} />} · updated <Time at={g.updated_at} /> · <a href={g.html_url} target="_blank" rel="noopener">Open on GitHub</a>
        </p>
      </header>
      {files.map((f) => (/\.(patch|diff)$/i.test(f.filename) || f.language === 'Diff' ? <PatchFile key={f.filename} text={f.content} /> : <PlainFile key={f.filename} name={f.filename} text={f.content} />))}
    </div>
  );
}

function PatchFile({ text }: { text: string }) {
  const { lead, files } = useMemo(() => splitPatch(text), [text]);
  if (!files.length) return <PlainFile name="patch" text={text} />;
  return (
    <>
      {lead && <pre class="gist-lead">{lead}</pre>}
      {files.map((f) => (
        <section class="file" key={f.path}>
          <header class="file-h">
            {f.status !== 'modified' && <span class={`st s-${f.status}`}>{f.status}</span>}
            <span class="file-name">
              <FileIcon path={f.path} big /> <b>{f.path}</b>
            </span>
            <span class="counts">
              <b class="a">+{f.additions}</b> <b class="d">−{f.deletions}</b>
            </span>
          </header>
          {f.hunks.map((h) => (
            <>
              <div class="gist-hunk">{h.header}</div>
              <CodeSnippet lines={h.lines} path={f.path} hit={() => false} />
            </>
          ))}
        </section>
      ))}
    </>
  );
}

function PlainFile({ name, text }: { name: string; text: string }) {
  const lines: Line[] = useMemo(() => text.replace(/\n$/, '').split('\n').map((t, i) => ({ kind: ' ', text: t, new: i + 1 })), [text]);
  return (
    <section class="file">
      <header class="file-h">
        <span class="file-name">
          <FileIcon path={name} big /> <b>{name}</b>
        </span>
      </header>
      {isMarkdown(name) ? <div class="md pad" ref={(el) => void (el && highlightBlocks(el))} dangerouslySetInnerHTML={{ __html: md.render(text) }} /> : <CodeSnippet lines={lines} path={name} hit={() => false} />}
    </section>
  );
}
