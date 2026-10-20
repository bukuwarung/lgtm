# lgtm

Fast, markdown-first GitHub PR review in your own browser, signed in with your GitHub CLI login.

- Sidebar of every open PR you're asked to review or have reviewed, grouped: needs your review, you requested changes, you commented, you approved.
- Every changed file in one scrolling page with syntax highlighting and a GitHub-style file tree; file bodies render as they near the viewport.
- The PR conversation (description, comments, review verdicts) above the files; review threads inline.
- Markdown files first, rendered as rich diff by default. Hover a block and click the `+` gutter to comment on its source lines.
- Files marked `linguist-generated` in the root `.gitattributes` are hidden behind one "N generated files hidden" row.
- Stacked PRs (one's base branch is another's head) are grouped in the sidebar, bottom layer first.
- Draft comments survive reloads and are submitted as one review (Comment / Approve / Request changes), optionally with a Slack DM to the author and assignees.

Design and specs: [`openspec/changes/add-pr-review-app`](openspec/changes/add-pr-review-app).

## Use

Needs Node 22+ and the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`).

```bash
cd app && npm install && npm run build && npm link
```

Then, from anywhere:

```bash
lgtm
```

It serves the UI on `http://127.0.0.1:4517` and opens it in your default browser. Pass a PR URL to open it directly, e.g. `lgtm https://github.com/owner/repo/pull/123`. Running `lgtm` again reuses the running instance. Set `LGTM_PORT` to change the port; drafts are stored per port.

## Slack notifications (optional)

When configured, the submit panel offers "Message @author on Slack" (author and assignees, not you or bots). The DM is sent by the local server, so the token never reaches the page.

1. Create a Slack app at https://api.slack.com/apps (From scratch, in your workspace).
2. Under **OAuth & Permissions → User Token Scopes**, add `chat:write`, `im:write`, `users:read`, `users:read.email`. Install it to the workspace (an admin may need to approve).
3. Put the **User OAuth Token** in `~/.config/lgtm/config.json` and keep the file private (`chmod 600`):

```json
{ "slackToken": "xoxp-…" }
```

Messages are sent as you. People are found on Slack by their company email on GitHub; if someone isn't found, map them by hand with `"slackUsers": { "github-login": "U012ABC" }` (their Slack member ID). Changes apply without restarting.

## Develop

```bash
cd app
npm test       # logic checks (patch parsing, anchors, .gitattributes, markdown mapping, highlighting)
npm start      # build, then run the server
```
