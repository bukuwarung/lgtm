import { slackEscape, words } from './platform.ts';

// The messages lgtm sends on Slack, as templates you can change (Settings → Slack → Messages). {name} fills in a value;
// {@recipient} (who gets it; {@them}, its first name, too), {@author} and {@any-github-login} tag that person on Slack (the sender turns <@gh:…> into a Slack mention,
// through the Slack people mapping; someone it can't place stays @login).
export type SlackKind = 'review' | 'nudge' | 'ask' | 'again' | 'qa';
// Each fill-in and what it becomes; {@login} tags anyone, by their login.
export const SLACK_FIELDS: Record<string, string> = {
  pr: 'the PR, linked', title: 'its title', url: 'its address', repo: 'owner/repo', number: 'its number', author: "its author's login",
  '@recipient': 'tags who gets it', '@author': 'tags the author',
};
export const SLACK_MESSAGES: Record<SlackKind, { label: string; note: string; initial: string; fields: Record<string, string> }> = {
  review: {
    label: 'After your review',
    note: 'To the author and assignees.',
    initial: '{verdict} {pr}{comments}\n{note}',
    fields: { verdict: 'Approved, Requested changes on, or Reviewed', comments: '" · 3 comments on PaymentService.kt, RetryPolicy.kt"', note: 'your review summary, quoted' },
  },
  nudge: {
    label: 'Nudge the reviewers',
    note: words('To the reviewers of your PR once it has waited a day or more.'),
    initial: "👋 Could you take a look at {pr}? It's been waiting for review for {days}.",
    fields: { days: '"2 days"' },
  },
  ask: {
    label: 'Ask for a review',
    note: 'You can still change it each time you ask.',
    initial: 'Hi! Could you review my PR when you have a moment? Thank you 🙏\n{pr}',
    fields: {},
  },
  again: {
    label: 'Ask to look again',
    note: words('When you re-request a review on your PR. Leave it empty to send nothing.'),
    initial: 'Addressed your comments 🙏 Could you take another look at {pr}?',
    fields: {},
  },
  qa: {
    label: 'Ask QA to test',
    note: words('In the QA channel; you can still change it each time. <!subteam^ID> tags a Slack group (its ID: on Slack, the group → ⋯ → Copy group ID).'),
    initial: 'Need bandwidth to test: *{title}*{jira}\n*What changed:* {description}\nPR: {pr}',
    fields: { jira: '" (Jira: BUKU-123)", linked, from the title or branch', description: "the PR description's first paragraph" },
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
const gitlabHost = (repo: string) => (repo.split('/')[0].includes('.') ? repo.split('/')[0] : '');
export const prValues = (p: { repo: string; number: number; title: string; url: string; author: string }) => ({
  pr: `<${p.url}|${slackEscape(`${p.repo}${gitlabHost(p.repo) ? '!' : '#'}${p.number} ${p.title}`)}>`,
  title: slackEscape(p.title),
  url: p.url,
  repo: p.repo,
  number: String(p.number),
  author: p.author,
  authorKey: gitlabHost(p.repo) ? `${p.author}@${gitlabHost(p.repo)}` : p.author, // {@author}'s Slack-people key (personKey)
});

export function fillSlack(template: string, values: Record<string, string>): string {
  // "my PR" says "my MR" for a GitLab one (only that: the rest of your wording stays as written)
  return (values.repo && gitlabHost(values.repo) ? template.replace(/\bPR(s?)\b/g, 'MR$1').replace(/\bpull request/g, 'merge request') : template)
    .replace(/\{@([A-Za-z0-9-]{1,39})\}/g, (_, who: string) => `<@gh:${who === 'recipient' || who === 'them' ? '*' : who === 'author' ? values.authorKey ?? values.author : who}>`)
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// What a filled message looks like on Slack, for the previews: links as their text, tags as @login, :emoji: as images
// (the workspace's own first, then the standard ones by GitHub's names, which mostly match), *bold*, `code`, quoted
// lines.
export type SlackPart = { text: string } | { link: string } | { tag: string } | { emoji: string; src: string } | { bold: string } | { code: string };
export function slackParts(message: string, emoji: (name: string) => string | undefined): { quote: boolean; parts: SlackPart[] }[] {
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return message.split('\n').map((line) => {
    const quote = line.startsWith('>');
    const parts: SlackPart[] = [];
    let last = 0;
    const body = quote ? line.slice(1) : line;
    for (const m of body.matchAll(/<!subteam\^\w+(?:\|@?([^>]+))?>|<([^>|]+)\|([^>]+)>|<@gh:([^>]+)>|:([a-z0-9_+'-]+):|`([^`]+)`|\*([^*\s][^*]*)\*/g)) {
      const src = m[5] ? emoji(m[5]) : undefined;
      if (m[5] && !src) continue; // not an emoji Slack knows here: left as text
      if (m.index! > last) parts.push({ text: unescape(body.slice(last, m.index)) });
      parts.push(
        m[0].startsWith('<!subteam') ? { tag: m[1] ?? 'group' }
        : m[2] ? { link: unescape(m[3]) }
        : m[4] ? { tag: m[4] === '*' ? 'recipient' : m[4] }
        : m[6] != null ? { code: unescape(m[6]) }
        : m[7] != null ? { bold: unescape(m[7]) }
        : { emoji: m[5], src: src! },
      );
      last = m.index! + m[0].length;
    }
    if (last < body.length) parts.push({ text: unescape(body.slice(last)) });
    return { quote, parts };
  });
}
