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

export function prPrompt(pr: { html_url: string; number: number; title: string; base: { ref: string }; head: { ref: string } }, repo: string): string {
  return [
    `Let's look at this pull request: ${pr.html_url}`,
    `#${pr.number} ${pr.title} (${pr.head.ref} → ${pr.base.ref})`,
    `Read it with \`gh pr view ${pr.number} --repo ${repo} --comments\` and \`gh pr diff ${pr.number} --repo ${repo}\`.`,
  ].join('\n');
}

export function commentPrompt(
  c: { author: string; text: string; url: string },
  where: { repo: string; number: number; prUrl: string; path?: string; line?: number | null },
): string {
  const place = where.path ? ` on \`${where.path}${where.line ? `:${where.line}` : ''}\`` : '';
  return [
    `A review comment from @${c.author}${place} in ${where.repo}#${where.number} (${where.prUrl}):`,
    '',
    quote(c.text),
    '',
    `Comment: ${c.url}`,
    `Help me address it.`,
  ].join('\n');
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
    "You're helping someone review a GitHub pull request. They selected some code and have a question about it.",
    'Answer in Markdown, concisely and concretely, pointing at identifiers and lines. If the answer depends on code you can\'t see here, say so.',
    '',
    `PR: ${pr.html_url} (${pr.title})`,
    `File: ${path}`,
    `The file now:\n${source == null ? '(not available)' : cut(source, 150_000)}`,
    `Its diff in this PR:\n${patch ? cut(patch, 100_000) : '(none: unchanged, binary or too large)'}`,
    `Selected:\n${selection}`,
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
    `I reviewed ${pr.html_url} (#${pr.number} ${pr.title}) in lgtm and ${verdict}.`,
    body.trim() && `My summary:\n${quote(body, 1500)}`,
    list.length && `My comments (${list.length}):\n${list.join('\n')}`,
    list.length || event === 'REQUEST_CHANGES' ? 'Please address them, then tell me what changed.' : '',
  ].filter(Boolean).join('\n\n');
  return text.length > 8000 ? text.slice(0, 7999) + '…' : text;
}
