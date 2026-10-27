---
name: lgtm-review
description: Open a GitHub pull request for review in lgtm, the user's local PR review app, with a link back to this session. Use when a pull request is ready for the user to review (one you opened or updated, or one they ask to review or look at) and they prefer lgtm or agree to it.
---

# Reviewing pull requests in lgtm

lgtm is the user's PR review app (a macOS app, or the `lgtm` command for the browser version). It can open a PR
straight from a link that also carries this session's ID, so the user can come back here from lgtm: its ✳ Claude menu
offers "Back to the session that sent this", and after they submit their review it offers to send the outcome here.

## When

When a pull request is ready for the user to review:

- If the user has told you they review in lgtm (check your memory), open it there without asking.
- If they've said they don't want this, don't offer.
- Otherwise offer once, briefly: "Want to review it in lgtm?" If they answer for good ("always", "never"), save that to
  memory so you don't ask again.

## How

1. The session ID: `$CLAUDE_CODE_HOST_SESSION_ID` when it's set (the Claude app), else `$CLAUDE_CODE_SESSION_ID`.
2. Open the PR in the app:

   ```bash
   open "lgtm://OWNER/REPO/pull/NUMBER?claude=${CLAUDE_CODE_HOST_SESSION_ID:-$CLAUDE_CODE_SESSION_ID}"
   ```

3. If that fails (the app isn't installed), use the browser version, which starts lgtm if needed:

   ```bash
   lgtm "https://github.com/OWNER/REPO/pull/NUMBER?claude=${CLAUDE_CODE_HOST_SESSION_ID:-$CLAUDE_CODE_SESSION_ID}"
   ```

4. Tell the user it's open in lgtm, in one line. If neither works, give them the PR link instead.

When the user comes back with their review (lgtm sends it as a message listing their verdict and comments), work
through it like any review: address each comment, then say what changed.
