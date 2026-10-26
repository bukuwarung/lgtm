// Handing a PR or a comment to Claude Code (the Claude desktop app). Its claude:// links: /code/new takes a prompt
// (q, at most 2592 characters) and an optional working folder; /code/continue reopens a session but takes no prompt,
// so for that one the prompt goes to the clipboard.
const MAX = 2592;

export function claudeNewLink(prompt: string, folder?: string): string {
  const p = new URLSearchParams({ q: prompt.length > MAX ? prompt.slice(0, MAX - 1) + '…' : prompt });
  if (folder) p.set('folder', folder);
  return `claude://code/new?${p}`;
}
export const CLAUDE_CONTINUE = 'claude://code/continue?session=last';
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
