---
name: lgtm-review
description: Open a GitHub pull request (or GitLab merge request) for review in lgtm, the user's local PR review app, with a link back to this session. Use when a pull request is ready for the user to review (one you opened or updated, or one they ask to review or look at) and they prefer lgtm or agree to it. Also use when the user says "check lgtm": read the messages lgtm left for this session (a comment to address, their review).
---

# Reviewing pull requests in lgtm

lgtm is the user's PR review app, a macOS app. It can open a PR
straight from a link that also carries this session's ID, so the user can come back here from lgtm: the Agents menu
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

   A GitLab merge request (https://HOST/GROUP/PROJECT/-/merge_requests/NUMBER, groups can nest) opens the same way,
   its host first: `open "lgtm://HOST/GROUP/PROJECT/pull/NUMBER?claude=SESSION_ID"`.

3. If that fails, lgtm isn't installed: say so, and give just the GitHub link.

4. Tell the user it's open, in one line, with the GitHub link written out in full:

   > Opened in lgtm: OWNER/REPO#NUMBER · [on GitHub](https://github.com/OWNER/REPO/pull/NUMBER)

   For a GitLab one: `GROUP/PROJECT!NUMBER · [on GitLab](https://HOST/GROUP/PROJECT/-/merge_requests/NUMBER)`.

   Don't link the `lgtm://` address: the Claude app doesn't open those links from a chat, so it would do nothing.
   If the user wants it open again later, run step 2 again.

## Messages from lgtm ("check lgtm")

lgtm leaves messages for this session in a file, newest last, separated by `---`:

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/lgtm/outbox/SESSION_ID.md"
```

(SESSION_ID as in step 1.) Read it, delete the file so they aren't handled twice, then act on each message: a review
lists the user's verdict and comments; a single comment is one to address. If the file isn't there, say there's
nothing from lgtm.

## Closing the loop on GitHub (or GitLab)

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

On a GitLab merge request, the same with glab (PROJECT_PATH is GROUP/PROJECT with each `/` written `%2F`; a thread is
a discussion):

```bash
# The MR's discussions (ids, whether resolved, who said what):
glab api "projects/PROJECT_PATH/merge_requests/NUMBER/discussions" --hostname HOST --paginate
# Reply on one, then resolve it:
glab api -X POST "projects/PROJECT_PATH/merge_requests/NUMBER/discussions/DISCUSSION_ID/notes" --hostname HOST -f body='Fixed in abc1234: …'
glab api -X PUT "projects/PROJECT_PATH/merge_requests/NUMBER/discussions/DISCUSSION_ID" --hostname HOST -f resolved=true
```

Then tell the user the PR is ready for another look. If they review in lgtm, it opens the re-review with what changed
since their last review and which of their threads were answered.
