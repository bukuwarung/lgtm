# /lgtm

Open a pull request (or GitLab merge request) in lgtm, the user's PR review app, linked to this conversation.

## Arguments

- `link`: optional; the pull request's link. Without one: the last pull request linked in this conversation, else the
  current branch's (`gh pr view --json url -q .url`, or `glab mr view -F json` on GitLab).

## Workflow

1. Get this conversation's ID: `echo "$CODEX_THREAD_ID"`.
2. Open it: `open "lgtm://OWNER/REPO/pull/NUMBER?codex=CONVERSATION_ID"`. A GitLab merge request
   (https://HOST/GROUP/PROJECT/-/merge_requests/NUMBER) opens as `lgtm://HOST/GROUP/PROJECT/pull/NUMBER?codex=CONVERSATION_ID`.
   Add `?codex=CONVERSATION_ID` only when the pull request is in the repository you're working in (`git remote get-url
   origin`): lgtm takes that conversation for the one working on it. Any other pull request opens without it.
   `open` starts an app: if the sandbox blocks it, run it again asking for approval.
3. Say it's open in one line, with the pull request's own link written out. If there's no pull request to open, say
   so; if `open` fails, lgtm isn't installed.
