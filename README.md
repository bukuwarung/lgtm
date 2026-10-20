# lgtm

Fast, markdown-first GitHub PR review in your own browser, signed in with your GitHub CLI login.

- Sidebar of every open PR you're asked to review or have reviewed, grouped: needs your review, you requested changes, you commented, you approved.
- Every changed file in one scrolling page with syntax highlighting and a GitHub-style file tree; file bodies render as they near the viewport.
- The PR conversation (description, comments, review verdicts) above the files; review threads inline.
- Markdown files first, rendered as rich diff by default. Hover a block and click the `+` gutter to comment on its source lines.
- Files marked `linguist-generated` in the root `.gitattributes` are hidden behind one "N generated files hidden" row.
- Draft comments survive reloads and are submitted as one review (Comment / Approve / Request changes).

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

## Develop

```bash
cd app
npm test       # logic checks (patch parsing, anchors, .gitattributes, markdown mapping, highlighting)
npm start      # build, then run the server
```
