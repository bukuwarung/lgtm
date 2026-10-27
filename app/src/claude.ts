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

// The walkthrough (shown in lgtm, from the claude CLI): what the PR does, its changes grouped by intent, and where to
// slow down. Generated files are left out; the diff is cut at MAX_DIFF characters.
const MAX_DIFF = 400_000;
export function walkthroughPrompt(
  pr: { html_url: string; title: string; body: string | null },
  files: { filename: string; status: string; patch?: string; generated?: boolean }[],
): string {
  let diff = '';
  for (const f of files.filter((f) => !f.generated)) {
    const part = `--- ${f.filename} (${f.status})\n${f.patch ?? '(no text diff: binary, renamed only, or too large)'}\n`;
    if (diff.length + part.length > MAX_DIFF) {
      diff += `\n(The diff continues; it was cut here for length.)\n`;
      break;
    }
    diff += part;
  }
  return [
    "You're helping someone review a GitHub pull request. Its title, description and diff are below. Write a short walkthrough in Markdown:",
    '1. One or two sentences: what the PR does and why.',
    '2. A "### Changes" section: the changes grouped by intent (not file by file), one bullet each, naming the files involved as full paths in backticks, exactly as in the diff.',
    '3. A "### Worth a close look" section: up to five spots where a reviewer should slow down (risky logic, edge cases, behaviour changes, missing tests), each naming the file path in backticks and saying why.',
    'Be concise and concrete. No praise, no preamble, no closing remarks.',
    '',
    `PR: ${pr.html_url}`,
    `Title: ${pr.title}`,
    `Description:\n${pr.body?.trim() || '(none)'}`,
    `Diff:\n${diff}`,
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
