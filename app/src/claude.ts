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
export type PromptKind = 'pr' | 'comment' | 'ask' | 'askPr' | 'agent' | 'reviewDone';
const COMMON = '{kind} pull request or merge request · {ref} #12 or !12 · {url} · {title} · {repo} · {site} GitHub or GitLab';
export const CLAUDE_PROMPTS: Record<PromptKind, { label: string; initial: string; fields: string; after?: string }> = {
  pr: {
    label: 'Open a PR in Claude Code (✳ Claude on a PR)',
    initial: "Let's look at this {kind}: {url}\n{ref} {title} ({branch} → {base})\nRead it with {read}.",
    fields: `${COMMON} · {branch} its branch · {base} the one it merges into · {read} the gh or glab commands that read it`,
  },
  comment: {
    label: 'Help address a comment (✳ on a comment)',
    initial: 'A review comment from @{author}{place} in {repo}{ref} ({url}):\n\n{comment}\n\nComment: {commentUrl}\nHelp me address it.',
    fields: `${COMMON} · {author} · {place} " on \`File.kt:41\`" for one on code · {comment} the comment, quoted · {commentUrl}`,
  },
  ask: {
    label: 'Ask Claude about selected code',
    initial: "You're helping someone review a {site} {kind}. They selected some code and have a question about it.\nAnswer in Markdown, concisely and concretely, pointing at identifiers and lines. If the answer depends on code you can't see here, say so.",
    fields: `${COMMON} · {path} the file`,
    after: 'Then lgtm adds the PR, the file as it is now, its diff, what you selected and your question.',
  },
  askPr: {
    label: 'Ask Claude about the whole PR',
    initial: "You're helping someone review a {site} {kind}. They have a question about the whole {kind}.\nAnswer in Markdown, concisely and concretely, naming files and identifiers. If the answer depends on code you can't see here, say so.",
    fields: COMMON,
    after: 'Then lgtm adds the description, the files changed, their diffs and your question.',
  },
  agent: {
    label: 'Claude Code reviews first: the brief',
    initial: "You are an adversarial code reviewer. Review this {kind} hard: find what will break. Look for bugs, wrong edge cases, race conditions, security problems, data loss, broken error handling, and risky changes without tests. No style nits, no praise, nothing you aren't confident about; at most 10 findings, the worst first. An empty list is fine.",
    fields: COMMON,
    after: 'Then lgtm adds the answer format it reads (findings as JSON, each with its file and line), the description, the numbered diff and the changed files.',
  },
  reviewDone: {
    label: 'Your review, sent to the Claude Code session that opened the PR',
    initial: 'I reviewed {url} ({ref} {title}) in lgtm and {verdict}.\n\n{summary}\n\n{comments}\n\n{ask}',
    fields: `${COMMON} · {verdict} approved it, requested changes, or commented · {summary} your summary, quoted · {comments} your comments, listed · {ask} "Please address them, then tell me what changed." when there's something to address (each empty when there's nothing)`,
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

export function prPrompt(pr: { html_url: string; number: number; title: string; base: { ref: string }; head: { ref: string } }, repo: string): string {
  const read = gitlab(repo)
    ? `\`glab mr view ${pr.number} -R https://${repo} --comments\` and \`glab mr diff ${pr.number} -R https://${repo}\``
    : `\`gh pr view ${pr.number} --repo ${repo} --comments\` and \`gh pr diff ${pr.number} --repo ${repo}\``;
  return fillPrompt(promptTemplate('pr'), { ...prFields(pr, repo), branch: pr.head.ref, base: pr.base.ref, read });
}

export function commentPrompt(
  c: { author: string; text: string; url: string },
  where: { repo: string; number: number; prUrl: string; path?: string; line?: number | null },
): string {
  const place = where.path ? ` on \`${where.path}${where.line ? `:${where.line}` : ''}\`` : '';
  return fillPrompt(promptTemplate('comment'), {
    ...prFields({ html_url: where.prUrl, title: '', number: where.number }, where.repo),
    author: c.author,
    place,
    comment: quote(c.text),
    commentUrl: c.url,
  });
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
    fillPrompt(promptTemplate('ask'), { ...prFields(pr), path }),
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
    fillPrompt(promptTemplate('askPr'), prFields(pr)),
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
  const text = fillPrompt(promptTemplate('reviewDone'), {
    ...prFields(pr),
    verdict,
    summary: body.trim() ? `My summary:\n${quote(body, 1500)}` : '',
    comments: list.length ? `My comments (${list.length}):\n${list.join('\n')}` : '',
    ask: list.length || event === 'REQUEST_CHANGES' ? 'Please address them, then tell me what changed.' : '',
  });
  return text.length > 8000 ? text.slice(0, 7999) + '…' : text;
}
