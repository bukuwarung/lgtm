# lgtm

Fast, markdown-first GitHub PR review as a browser extension (Firefox 128+, Chrome 121+, one build).

- Sidebar of every open PR you're asked to review or have reviewed, grouped: needs your review, you requested changes, you commented, you approved.
- Every changed file in one scrolling page with syntax highlighting and a GitHub-style file tree; file bodies render as they near the viewport.
- The PR conversation (description, comments, review verdicts) above the files; review threads inline.
- Markdown files first, rendered as rich diff by default. Hover a block and click the `+` gutter to comment on its source lines.
- Files marked `linguist-generated` in the root `.gitattributes` are hidden behind one "N generated files hidden" row.
- Draft comments survive reloads and are submitted as one review (Comment / Approve / Request changes).

Design and specs: [`openspec/changes/add-pr-review-extension`](openspec/changes/add-pr-review-extension).

## Develop

```bash
cd extension && npm install
npm test          # logic checks (patch parsing, anchors, .gitattributes, markdown mapping)
npm run build     # → extension/dist
npm run firefox   # launch Firefox with the extension
npm run chrome    # launch Chrome/Chromium with the extension
npm run package   # zip for addons.mozilla.org and the Chrome Web Store
```

## Sign-in

Two options:

- **Device flow (recommended):** register a GitHub OAuth App with "Enable Device Flow" checked (callback URL can be anything), then build with its client ID: `VITE_GITHUB_CLIENT_ID=<id> npm run build`. The client ID is public; there is no secret.
- **Token:** without a client ID, the sign-in screen accepts a personal access token (classic with `repo`, or fine-grained with Pull requests read & write + Contents read).

In Firefox, the first screen may ask you to grant access to github.com; that is the MV3 host permission prompt.
