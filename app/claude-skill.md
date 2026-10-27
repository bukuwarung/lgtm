---
name: lgtm-review
description: Open a GitHub pull request for review in lgtm, the user's local PR review app, with a link back to this session. Use when a pull request is ready for the user to review (one you opened or updated, or one they ask to review or look at) and they prefer lgtm or agree to it. Also use when the user says "check lgtm": read the messages lgtm left for this session (a comment to address, their review).
---

# Reviewing pull requests in lgtm

lgtm is the user's PR review app (a macOS app, or the `lgtm` command for the browser version). It can open a PR
straight from a link that also carries this session's ID, so the user can come back here from lgtm: its ✳ Claude button
on that PR opens this session, and from there lgtm leaves messages for it (their review, a comment to address).

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

## Messages from lgtm ("check lgtm")

lgtm leaves messages for this session in a file, newest last, separated by `---`:

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/lgtm/outbox/SESSION_ID.md"
```

(SESSION_ID as in step 1.) Read it, delete the file so they aren't handled twice, then act on each message: a review
lists the user's verdict and comments; a single comment is one to address. If the file isn't there, say there's
nothing from lgtm.

## Closing the loop on GitHub

After you've addressed the user's review comments and pushed, reply on each thread you addressed with one line on
what changed (and the commit), and resolve it; on one you didn't address, reply why and leave it open. Ask the user
once whether they want this (the replies go out under their GitHub account), and remember the answer.

```bash
# The PR's threads (ids, whether resolved, who said what):
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:20){nodes{author{login} body}}}}}}}' -f o=OWNER -f r=REPO -F n=NUMBER
# Reply on one, then resolve it:
gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{id}}}' -f t=THREAD_ID -f b='Fixed in abc1234: …'
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=THREAD_ID
```

Then tell the user the PR is ready for another look. If they review in lgtm, it opens the re-review with what changed
since their last review and which of their threads were answered.
