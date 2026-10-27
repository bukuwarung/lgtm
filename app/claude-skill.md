---
name: lgtm-review
description: Open a GitHub pull request for review in lgtm, the user's local PR review app, with a link back to this session. Use when a pull request is ready for the user to review (one you opened or updated, or one they ask to review or look at) and they prefer lgtm or agree to it.
---

# Reviewing pull requests in lgtm

lgtm is the user's PR review app (a macOS app, or the `lgtm` command for the browser version). It can open a PR
straight from a link that also carries this session's ID, so the user can come back here from lgtm: its ✳ Claude button
on that PR opens this session, and after they submit their review it offers to send the outcome here.

## When

When a pull request is ready for the user to review:

- If the user has told you they review in lgtm (check your memory), open it there without asking.
- If they've said they don't want this, don't offer.
- Otherwise offer once, briefly: "Want to review it in lgtm?" If they answer for good ("always", "never"), save that to
  memory so you don't ask again.

## How

1. Get the session ID: run `echo "${CLAUDE_CODE_HOST_SESSION_ID:-$CLAUDE_CODE_SESSION_ID}"` (the Claude app's ID when
   there is one, else the CLI's). Use the value it prints, written out, in the steps below.
2. Open the PR in the app:

   ```bash
   open "lgtm://OWNER/REPO/pull/NUMBER?claude=SESSION_ID"
   ```

3. If that fails (the app isn't installed), use the browser version, which starts lgtm if needed:

   ```bash
   lgtm "https://github.com/OWNER/REPO/pull/NUMBER?claude=SESSION_ID"
   ```

4. Tell the user it's open, in one line, with the links to come back to it, written out in full:

   > Opened in lgtm: [OWNER/REPO#NUMBER](lgtm://OWNER/REPO/pull/NUMBER?claude=SESSION_ID) · [on GitHub](https://github.com/OWNER/REPO/pull/NUMBER)

   With the browser version, link the address the `lgtm` command printed, followed by `#/OWNER/REPO/pull/NUMBER`,
   instead of the `lgtm://` one. If neither command worked, say so and give just the GitHub link.

When the user comes back with their review (lgtm sends it as a message listing their verdict and comments), work
through it like any review: address each comment, then say what changed.
