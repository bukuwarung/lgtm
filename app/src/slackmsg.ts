import { slackEscape } from './platform.ts';

// The messages lgtm sends on Slack, as templates you can change (Settings → Slack messages). {name} fills in a value;
// {@them}, {@author} and {@any-github-login} tag that person on Slack (the sender turns <@gh:…> into a Slack mention,
// through the Slack people mapping; someone it can't place stays @login).
export type SlackKind = 'review' | 'nudge' | 'ask';
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
};
export const COMMON_FIELDS = '{pr} the PR, linked · {title} · {url} · {repo} · {number} · {author} · {@them} tags who gets it · {@author} tags the author · {@login} tags anyone';

export const slackTemplate = (k: SlackKind) => {
  try {
    return localStorage.getItem('slackMsg.' + k) || SLACK_MESSAGES[k].initial;
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
    .replace(/\{@([A-Za-z0-9-]{1,39})\}/g, (_, who: string) => `<@gh:${who === 'them' ? '*' : who === 'author' ? values.author : who}>`)
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
