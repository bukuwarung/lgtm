## Why

Reviewing PRs on github.com is slow on large diffs, buries the prose (READMEs, ADRs, specs) among code, shows markdown as raw source if you want to comment on it, and still makes you scroll past generated files. We want a faster, focused review surface that reads like a document first and code second.

## What Changes

- New local app: the `lgtm` command serves the review UI on `127.0.0.1` and opens it in your default browser. No browser extension, no hosted backend.
- Signs in with your existing GitHub CLI login (`gh auth token`); nothing to paste.
- PR sidebar: every open PR I'm asked to review or have reviewed, grouped by my status (needs review, I requested changes, I commented, I approved), plus "open by URL". `lgtm <PR URL>` opens that PR directly.
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
- `github-auth`: Use the GitHub CLI's login; keep the token away from other websites.
- `pr-review-view`: PR inbox, continuous scrolling diff of all files, inline threads, drafting and submitting a review.
- `markdown-rich-diff`: Markdown-first ordering, rendered rich diff by default, line-anchored commenting on rendered blocks.
- `generated-file-filter`: Detect `linguist-generated` files from `.gitattributes` and hide them.

### Modified Capabilities
None (greenfield).

## Impact

- New code under `app/`. Repo currently has only a README.
- Requires the GitHub CLI (`gh`) signed in, and Node to run the server.
- Runtime deps kept to: `preact`, `markdown-it`, `highlight.js` (common languages + Dockerfile). Build: `vite`, `typescript`.
