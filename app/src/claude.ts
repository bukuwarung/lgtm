// Handing a PR or a comment to Claude Code (the Claude desktop app). Its claude:// links: /code/new takes a prompt
// (q, at most 2592 characters) and an optional working folder; /code/continue reopens a session but takes no prompt,
// so for that one the prompt goes to the clipboard.
const MAX = 2592;

export function claudeNewLink(prompt: string, folder?: string): string {
  const p = new URLSearchParams({ q: prompt.length > MAX ? prompt.slice(0, MAX - 1) + '…' : prompt });
  if (folder) p.set('folder', folder);
  return `claude://code/new?${p}`;
}
export const claudeContinueLink = (id: string) => `claude://code/continue?session=${encodeURIComponent(id)}`;

const quote = (text: string, room = 1500) => (text.length > room ? text.slice(0, room) + '…' : text).trim().replace(/^/gm, '> ');

// A GitLab repo is host/group/…/project: its MRs are read with glab, given the project's address.
const gitlab = (repo: string) => repo.split('/')[0].includes('.');
const isMr = (url: string) => url.includes('/-/merge_requests/');

// The prompts lgtm hands Claude, as templates you can change (Settings → Claude Code → Prompts). {name} fills in a value
// (a name it doesn't know stays as written); what Claude must also have (the diff, the files, the answer's format) is
// added after your text, so editing can't lose it.
export type PromptKind = 'pr' | 'ask' | 'agent';
// Each fill-in and what it becomes.
const COMMON: Record<string, string> = {
  kind: 'pull request, or merge request', ref: '#12, or !12', url: "the PR's address", title: 'its title', repo: 'owner/repo', site: 'GitHub or GitLab',
};
// cli: run by lgtm through Claude Code's CLI, so its model and effort can be picked (Open in Claude Code opens the app,
// where the session picks them).
export const CLAUDE_PROMPTS: Record<PromptKind, { label: string; initial: string; fields: Record<string, string>; after?: string; cli?: boolean }> = {
  pr: {
    label: 'Open in Claude Code',
    initial: "Let's look at this {kind}: {url}\n{ref} {title} ({branch} → {base})\nRead it with {read}.",
    fields: { ...COMMON, branch: 'its branch', base: 'the branch it merges into', read: 'the gh or glab commands that read it' },
    after: 'from a comment: the comment, quoted, and "Help me address it."',
  },
  ask: {
    label: 'Ask Claude',
    cli: true,
    initial: "You're helping someone review a {site} {kind}. Answer their question in Markdown, concisely and concretely, naming files, identifiers and lines. If the answer depends on code you can't see here, say so.",
    fields: COMMON,
    after: 'what the question is about (the code you selected, or the whole PR), the code itself and your question',
  },
  agent: {
    label: 'Claude Code reviews first',
    cli: true,
    initial: "You are an adversarial code reviewer. Review this {kind} hard: find what will break. Look for bugs, wrong edge cases, race conditions, security problems, data loss, broken error handling, and risky changes without tests. No style nits, no praise, nothing you aren't confident about; at most 10 findings, the worst first. An empty list is fine.",
    fields: COMMON,
    after: 'the answer format lgtm reads (findings as JSON, each with its file and line), the description, the numbered diff and the changed files',
  },
};
export const promptTemplate = (k: PromptKind) => {
  try {
    return localStorage.getItem('claudePrompt.' + k) || CLAUDE_PROMPTS[k].initial;
  } catch {
    return CLAUDE_PROMPTS[k].initial;
  }
};
export const fillPrompt = (template: string, values: Record<string, string>) =>
  template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
// The fill-ins every prompt has, for a PR (its address says GitHub or GitLab).
export function prFields(pr: { html_url: string; title: string; number?: number }, repo?: string) {
  const lab = repo ? gitlab(repo) : isMr(pr.html_url);
  return {
    kind: lab ? 'merge request' : 'pull request',
    site: lab ? 'GitLab' : 'GitHub',
    ref: pr.number != null ? `${lab ? '!' : '#'}${pr.number}` : '',
    url: pr.html_url,
    title: pr.title,
    repo: repo ?? '',
  };
}

type PrLike = { html_url: string; number: number; title: string; base: { ref: string }; head: { ref: string } };
export function prPrompt(pr: PrLike, repo: string): string {
  const read = gitlab(repo)
    ? `\`glab mr view ${pr.number} -R https://${repo} --comments\` and \`glab mr diff ${pr.number} -R https://${repo}\``
    : `\`gh pr view ${pr.number} --repo ${repo} --comments\` and \`gh pr diff ${pr.number} --repo ${repo}\``;
  return fillPrompt(promptTemplate('pr'), { ...prFields(pr, repo), branch: pr.head.ref, base: pr.base.ref, read });
}

// A comment to address: the PR as "Open in Claude Code" puts it, then the comment.
export function commentPrompt(c: { author: string; text: string; url: string }, pr: PrLike, repo: string, at?: { path: string; line?: number | null }): string {
  const place = at ? ` on \`${at.path}${at.line ? `:${at.line}` : ''}\`` : '';
  return [prPrompt(pr, repo), `A review comment from @${c.author}${place}:`, quote(c.text), `Comment: ${c.url}\nHelp me address it.`].join('\n\n');
}

// "Ask Claude" about code selected in a file: the question with the file as it is now, its diff in this PR and the
// selection.
export function askPrompt(
  pr: { html_url: string; title: string },
  path: string,
  patch: string | undefined,
  source: string | null,
  selection: string,
  question: string,
): string {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n(cut here for length)' : s);
  return [
    fillPrompt(promptTemplate('ask'), prFields(pr)),
    `Their question is about code they selected in ${path}.`,
    '',
    `PR: ${pr.html_url} (${pr.title})`,
    `File: ${path}`,
    `The file now:\n${source == null ? '(not available)' : cut(source, 150_000)}`,
    `Its diff in this PR:\n${patch ? cut(patch, 100_000) : '(none: unchanged, binary or too large)'}`,
    `Selected:\n${selection}`,
    `Question: ${question}`,
  ].join('\n\n');
}

// A question about the whole PR: its description, then every file's diff (the specs among them), as much as fits.
export function prAskPrompt(pr: { html_url: string; title: string; body: string | null }, files: { filename: string; patch?: string }[], question: string): string {
  let room = 400_000;
  const diffs = files.map((f) => {
    const d = `--- ${f.filename}\n${f.patch ?? '(no diff: binary, too large, or only renamed)'}`;
    const take = d.slice(0, Math.max(0, room));
    room -= take.length;
    return take.length < d.length ? take + '\n(cut here for length)' : take;
  });
  return [
    fillPrompt(promptTemplate('ask'), prFields(pr)),
    `Their question is about the whole ${prFields(pr).kind}.`,
    '',
    `PR: ${pr.html_url} (${pr.title})`,
    `Description:\n${pr.body?.trim() || '(none)'}`,
    `Files changed (${files.length}):\n${files.map((f) => f.filename).join('\n')}`,
    `The diffs:\n${diffs.filter(Boolean).join('\n\n')}`,
    `Question: ${question}`,
  ].join('\n\n');
}

// After a review of a PR a Claude Code session sent to lgtm: the outcome, as a message for that session.
export function reviewDonePrompt(
  pr: { html_url: string; number: number; title: string },
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body: string,
  comments: { path: string; line?: number; body: string }[],
): string {
  const verdict = { APPROVE: 'approved it', REQUEST_CHANGES: 'requested changes', COMMENT: 'commented' }[event];
  const list = comments.map((c) => `- \`${c.path}${c.line ? `:${c.line}` : ''}\`: ${c.body.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
  const text = [
    `I reviewed ${pr.html_url} (${prFields(pr).ref} ${pr.title}) in lgtm and ${verdict}.`,
    body.trim() && `My summary:\n${quote(body, 1500)}`,
    list.length && `My comments (${list.length}):\n${list.join('\n')}`,
    list.length || event === 'REQUEST_CHANGES' ? 'Please address them, then tell me what changed.' : '',
  ].filter(Boolean).join('\n\n');
  return text.length > 8000 ? text.slice(0, 7999) + '…' : text;
}
