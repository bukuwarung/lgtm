import { slackEscape } from './platform.ts';

// The messages lgtm sends on Slack, as templates you can change (Settings → Slack messages). {name} fills in a value;
// {@recipient} (who gets it; {@them}, its first name, too), {@author} and {@any-github-login} tag that person on Slack (the sender turns <@gh:…> into a Slack mention,
// through the Slack people mapping; someone it can't place stays @login).
export type SlackKind = 'review' | 'nudge' | 'ask' | 'again';
export const SLACK_MESSAGES: Record<SlackKind, { label: string; initial: string; fields: string }> = {
  review: {
    label: 'After your review, to the author and assignees',
    initial: '{verdict} {pr}{comments}\n{note}',
    fields: '{verdict} Approved, Requested changes on, Reviewed · {comments} " · 3 comments" · {note} your review summary, quoted',
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
};
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
    for (const m of body.matchAll(/<([^>|]+)\|([^>]+)>|<@gh:([^>]+)>|:([a-z0-9_+'-]+):/g)) {
      const src = m[4] ? emoji(m[4]) : undefined;
      if (m[4] && !src) continue; // not an emoji Slack knows here: left as text
      if (m.index! > last) parts.push({ text: unescape(body.slice(last, m.index)) });
      parts.push(m[1] ? { link: unescape(m[2]) } : m[3] ? { tag: m[3] === '*' ? 'recipient' : m[3] } : { emoji: m[4], src: src! });
      last = m.index! + m[0].length;
    }
    if (last < body.length) parts.push({ text: unescape(body.slice(last)) });
    return { quote, parts };
  });
}
