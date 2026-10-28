# lgtm

Fast GitHub PR review as a Mac app: every file on one page, less noise. It runs on your machine and signs in with your GitHub CLI login.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/scene-review-dark.png">
  <img alt="A PR: the bar with ✳ Claude and Finish review, the Jira ticket, status pills, changes since your last review, and a diff" src="docs/features/scene-review-light.png" width="760">
</picture>

## Install

macOS 13 or later, with Homebrew:

```bash
brew tap bukuwarung/lgtm https://github.com/bukuwarung/lgtm
brew install --cask bukuwarung/lgtm/lgtm
gh auth login   # once, if you haven't
```

`brew upgrade` updates it. Slack and Jira are optional; lgtm shows how to set them up on first launch ([install notes](docs/features.md#install-notes)).

## What it does

- **Your queue**: PRs to review, your own and your team's, each with what needs you and a time to review.
- **Reading**: every changed file on one page, markdown rendered, noise folded away, and only what changed since your last review.
- **Commenting**: drafts that survive reloads and suggested changes, sent as one review.
- **Your PRs**: reviewers suggested and asked on GitHub and Slack, merged, and the Jira ticket moved on.
- **Claude Code**: Claude sends PRs here for your review, and your review goes back to it.
- **Kotlin, Java and Gradle**: modules, the function each change is in, doc comments rendered.
- **On your Mac**: a Dock badge, notifications, `lgtm://` links, and several GitHub accounts.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/scene-queue-dark.png">
  <img alt="The PR list: Reviewing, Your PRs and Team tabs, PRs grouped by where they stand, with pills for what needs you" src="docs/features/scene-queue-light.png" width="380">
</picture>

More: [all features](docs/features.md) · [keyboard shortcuts](docs/features.md#keyboard-shortcuts) · [build and release](docs/develop.md)

## License

[MIT](LICENSE). The markdown themes are adapted from [markdown.style](https://markdown.style) (Apache 2.0).
