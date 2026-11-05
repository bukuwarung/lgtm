import { slackEscape } from './platform.ts';

// The messages lgtm sends on Slack, as templates you can change (Settings → Slack → Messages). {name} fills in a value;
// {@recipient} (who gets it; {@them}, its first name, too), {@author} and {@any-github-login} tag that person on Slack (the sender turns <@gh:…> into a Slack mention,
// through the Slack people mapping; someone it can't place stays @login).
export type SlackKind = 'review' | 'nudge' | 'ask' | 'again' | 'qa';
export const SLACK_MESSAGES: Record<SlackKind, { label: string; initial: string; fields: string }> = {
  review: {
    label: 'After your review, to the author and assignees',
    initial: '{verdict} {pr}{comments}\n{note}',
    fields: '{verdict} Approved, Requested changes on, Reviewed · {comments} " · 3 comments on PaymentService.kt, RetryPolicy.kt" · {note} your review summary, quoted',
  },
  nudge: {
    label: 'Nudging the reviewers of your PR that has waited a day or more',
    initial: "👋 Could you take a look at {pr}? It's been waiting for review for {days}.",
    fields: '{days} "2 days"',
  },
  ask: {
    label: 'Asking someone to review your PR (editable when you ask)',
    initial: 'Hi! Could you review my PR when you have a moment? Thank you 🙏\n{pr}',
    fields: '',
  },
  again: {
    label: 'Asking a reviewer to look again (re-request on your PR); empty: no Slack message',
    initial: 'Addressed your comments 🙏 Could you take another look at {pr}?',
    fields: '',
  },
  qa: {
    label: 'Asking QA to test your PR, in the QA channel (editable when you ask)',
    initial: 'Need bandwidth to test: *{title}*{jira}\n*What changed:* {description}\nPR: {pr}',
    fields: '{jira} " (Jira: BUKU-123)", linked, from the title or branch · {description} the PR description\'s first paragraph · <!subteam^ID> tags a Slack group (its ID: on Slack, the group → ⋯ → Copy group ID)',
  },
};
// The PR description's first paragraph, as plain text for Slack: hidden <!-- comments -->, headings, images, quotes and
// tables out; a paragraph that only names Jira tickets skipped (the request links them); [text](url) as its text.
export function firstParagraph(body: string | null | undefined): string {
  const paras = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const plain = (x: string) =>
    x.split('\n').filter((l) => !/^\s*(#{1,6}\s|!\[|<img\b|>|\||[-*_]{3,}\s*$)/.test(l)).join(' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const onlyTickets = (x: string) => /^(jira|tickets?)\b[:\s]*/i.test(x) || /^([A-Z][A-Z0-9]+-\d+[\s,;()]*)+$/.test(x);
  const p = paras.map(plain).find((x) => x && !onlyTickets(x)) ?? '';
  return p.length > 600 ? p.slice(0, 600).replace(/\s+\S*$/, '') + '…' : p;
}

// Where the QA request goes, unless Settings says another channel (#qa-task-requests).
export const QA_CHANNEL = 'https://bukuwarung.slack.com/archives/C0B8FLVRSCQ';

// A Slack status that says someone is away for now: out sick, vacation, out of office (OOO), any "… leave", or the
// emoji people set for those. One that has expired doesn't count.
const AWAY = /\b(out sick|sick|vacation|holiday|out of (the )?office|ooo|on leave|\w+ leave|cuti|day off|pto)\b/i;
const AWAY_EMOJI = new Set(['palm_tree', 'desert_island', 'beach_with_umbrella', 'airplane', 'face_with_thermometer', 'thermometer', 'sick', 'face_with_head_bandage', 'mask', 'pill', 'hospital', 'baby_bottle']);
export function isAway(s: { text: string; emoji: string; until: number } | null | undefined, now = Date.now()) {
  if (!s || (s.until && s.until * 1000 < now)) return false;
  return AWAY.test(s.text) || AWAY_EMOJI.has(s.emoji.replace(/:/g, ''));
}

// A status as words: "Vacation · until Thu, 6 Nov" (a time when it ends today).
export function statusText(s: { text: string; emoji: string; until: number }) {
  if (!s.until) return s.text || s.emoji;
  const d = new Date(s.until * 1000);
  const when = d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${s.text || s.emoji} · until ${when}`;
}

export const COMMON_FIELDS = '{pr} the PR, linked · {title} · {url} · {repo} · {number} · {author} · {@recipient} tags who gets it · {@author} tags the author · {@login} tags anyone';

// Your wording, else lgtm's. Emptied, "again" sends nothing; the others fall back to lgtm's.
export const slackTemplate = (k: SlackKind) => {
  try {
    const mine = localStorage.getItem('slackMsg.' + k);
    return k === 'again' ? mine ?? SLACK_MESSAGES[k].initial : mine || SLACK_MESSAGES[k].initial;
  } catch {
    return SLACK_MESSAGES[k].initial;
  }
};

// The values every message can use, for a PR.
export const prValues = (p: { repo: string; number: number; title: string; url: string; author: string }) => ({
  pr: `<${p.url}|${slackEscape(`${p.repo}#${p.number} ${p.title}`)}>`,
  title: slackEscape(p.title),
  url: p.url,
  repo: p.repo,
  number: String(p.number),
  author: p.author,
});

export function fillSlack(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{@([A-Za-z0-9-]{1,39})\}/g, (_, who: string) => `<@gh:${who === 'recipient' || who === 'them' ? '*' : who === 'author' ? values.author : who}>`)
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// What a filled message looks like on Slack, for the Settings preview: links as their text, tags as @login, :emoji:
// as images (the workspace's own first, then the standard ones by GitHub's names, which mostly match), quoted lines.
export type SlackPart = { text: string } | { link: string } | { tag: string } | { emoji: string; src: string };
export function slackParts(message: string, emoji: (name: string) => string | undefined): { quote: boolean; parts: SlackPart[] }[] {
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return message.split('\n').map((line) => {
    const quote = line.startsWith('>');
    const parts: SlackPart[] = [];
    let last = 0;
    const body = quote ? line.slice(1) : line;
    for (const m of body.matchAll(/<!subteam\^\w+(?:\|@?([^>]+))?>|<([^>|]+)\|([^>]+)>|<@gh:([^>]+)>|:([a-z0-9_+'-]+):/g)) {
      const src = m[5] ? emoji(m[5]) : undefined;
      if (m[5] && !src) continue; // not an emoji Slack knows here: left as text
      if (m.index! > last) parts.push({ text: unescape(body.slice(last, m.index)) });
      parts.push(m[0].startsWith('<!subteam') ? { tag: m[1] ?? 'group' } : m[2] ? { link: unescape(m[3]) } : m[4] ? { tag: m[4] === '*' ? 'recipient' : m[4] } : { emoji: m[5], src: src! });
      last = m.index! + m[0].length;
    }
    if (last < body.length) parts.push({ text: unescape(body.slice(last)) });
    return { quote, parts };
  });
}
