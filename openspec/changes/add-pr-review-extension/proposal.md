## Why

Reviewing PRs on github.com is slow on large diffs, buries the prose (READMEs, ADRs, specs) among code, shows markdown as raw source if you want to comment on it, and still makes you scroll past generated files. We want a faster, focused review surface that reads like a document first and code second.

## What Changes

- New browser extension (MV3) for **Firefox and Chrome** from one codebase and one build, opening a full-tab review UI (`review.html`). No backend.
- Sign in with GitHub via OAuth device flow; token kept in extension-local storage.
- PR sidebar: every open PR I'm asked to review or have reviewed, grouped by my status (needs review, I requested changes, I commented, I approved), plus "open by URL". Toolbar button on a GitHub PR tab opens that PR directly.
- Single continuous scrolling view of every changed file (no tabs, no pagination), like GitHub's "Files changed" but faster, with a GitHub-style file tree and syntax highlighting.
- PR conversation (description, comments, review verdicts) shown above the files.
- Markdown files (`.md`, `.mdx`, `.markdown`) sorted to the top and shown as **rich diff by default**, with line comments still possible (comments anchor to the source lines of the rendered block). Toggle per file to source diff.
- Files marked `linguist-generated` in `.gitattributes` are hidden from the view; a single "N generated files hidden" row can reveal them.
- Draft line comments locally, then submit as one review (Comment / Approve / Request changes). Existing review threads shown inline, with reply.

## Non-goals (v1)

- **macOS app.** Deferred. The review UI is a plain web page, so a later WKWebView/Tauri shell can reuse it unchanged.
- "Viewed" file state, suggestions blocks, GitHub Enterprise, multi-account. Each is additive later.

## Capabilities

### New Capabilities
- `github-auth`: Sign in/out with GitHub via device flow, persist and use the token.
- `pr-review-view`: PR inbox, continuous scrolling diff of all files, inline threads, drafting and submitting a review.
- `markdown-rich-diff`: Markdown-first ordering, rendered rich diff by default, line-anchored commenting on rendered blocks.
- `generated-file-filter`: Detect `linguist-generated` files from `.gitattributes` and hide them.

### Modified Capabilities
None (greenfield).

## Impact

- New code under `extension/`. Repo currently has only a README.
- Requires registering a GitHub OAuth App with device flow enabled (public `client_id` shipped in the extension; no secret).
- Requires host permissions for `https://github.com/*` and `https://api.github.com/*`.
- Published to both addons.mozilla.org and the Chrome Web Store (same zip).
- Runtime deps kept to: `preact`, `markdown-it`, `highlight.js` (common languages + Dockerfile). Build: `vite`, `typescript`, `web-ext`.
