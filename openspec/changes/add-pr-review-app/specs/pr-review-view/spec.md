## ADDED Requirements

### Requirement: Runs in the user's own browser
The system SHALL serve its UI from a local server and work in current Firefox and Chrome without installing anything into the browser.

#### Scenario: Launch
- **WHEN** the user runs `lgtm`
- **THEN** the review UI opens in the default browser

### Requirement: PR sidebar grouped by review status
The system SHALL show, in a collapsible sidebar, every open PR where the signed-in user's review is requested or that they have reviewed (excluding their own), grouped as: Needs your review, You requested changes, You commented, You approved. It SHALL open any PR from a pasted `github.com/{owner}/{repo}/pull/{n}` URL.

#### Scenario: Grouping
- **WHEN** the user has one PR awaiting review, one they approved, and one where they requested changes
- **THEN** each appears under its group with repo, number, title, author, and relative update time

#### Scenario: Re-requested review
- **WHEN** the user reviewed a PR and the author requested their review again
- **THEN** the PR is under "Needs your review" and marked re-requested

#### Scenario: Overall PR state
- **WHEN** a PR's overall review decision is approved or changes requested
- **THEN** the item shows that state in addition to the user's own

#### Scenario: Draft PRs hidden by default
- **WHEN** the review queue includes other people's draft PRs
- **THEN** they are hidden behind a "N draft PRs hidden · show" toggle that is remembered, except the PR currently open

#### Scenario: Your PRs
- **WHEN** the user has open PRs they authored or are assigned to
- **THEN** a "Your PRs" tab (beside the "Reviewing" tab, the choice remembered) lists them grouped as Changes requested, Approved, Waiting for review, and Draft (their own drafts always shown), and an assigned PR that also needs their review stays only in the review queue

#### Scenario: Stacked PRs
- **WHEN** PR #2's base branch is PR #1's head branch and both are in the list
- **THEN** they appear together as one stack, #1 then #2, in the group of the more urgent one, each with its own status

#### Scenario: Live queue
- **WHEN** a new review request arrives while the page is open
- **THEN** it appears within 3 minutes, the tab title count updates, and with notifications on a desktop notification opens that PR when clicked

#### Scenario: Refresh after submit
- **WHEN** the user submits a review
- **THEN** the sidebar reloads and the PR moves to its new group

#### Scenario: Open a PR from the command line
- **WHEN** the user runs `lgtm https://github.com/owner/repo/pull/123`
- **THEN** the UI opens directly on that PR

### Requirement: Continuous scrolling diff
The system SHALL render every visible changed file of a PR in one continuous scrolling page, each file under a sticky header showing path, status, and +/- counts, with syntax highlighting for recognized languages, and a GitHub-style file tree for jump navigation.

#### Scenario: Large PR stays responsive
- **WHEN** a PR with 1000 changed files is opened
- **THEN** the first files render without waiting for all files' content, and off-screen files are not laid out until scrolled near

#### Scenario: File without patch
- **WHEN** GitHub returns a file with no `patch` (binary or too large)
- **THEN** the file shows a placeholder row with a link to the file on GitHub

#### Scenario: Jump to file
- **WHEN** the user clicks a file in the tree
- **THEN** the view scrolls to that file's header

#### Scenario: Collapse the index
- **WHEN** the user clicks "Index" in the PR bar
- **THEN** the PR Shortcut Index hides and the diff takes the full width, and the choice is remembered

#### Scenario: Resize a column
- **WHEN** the user drags the right edge of the PR list or the index
- **THEN** the column resizes, keeps that width after reload, and double-click restores the default

### Requirement: PR Shortcut Index
The system SHALL show, beside the diff, an index linking to the PR description, each conversation comment and review, each CI check, each review thread and pending draft, and each changed file.

#### Scenario: Jump to a thread in an unrendered file
- **WHEN** the user clicks a review thread whose file hasn't rendered yet
- **THEN** the view scrolls to it once the file renders, expands it if collapsed, and highlights it

#### Scenario: Checks
- **WHEN** the head commit has failing, running, and passing checks
- **THEN** the index lists failures first with a failing count, and each check links to its run

#### Scenario: Failed job log
- **WHEN** the user clicks "log" on a failed GitHub Actions check
- **THEN** the end of that job's log up to its last error is shown in the index

#### Scenario: Long paths
- **WHEN** files live under deep folders
- **THEN** the tree shows them nested by folder with single-child folder chains collapsed into one row, and folders can be collapsed

#### Scenario: Highlighting
- **WHEN** a changed file is TypeScript, Python, Go, YAML, or another common language
- **THEN** its diff lines are syntax highlighted, including lines inside multi-line strings or comments

### Requirement: Viewed files
The system SHALL let the user mark each file viewed, using GitHub's own viewed state, collapse viewed files, and show viewed progress in the index.

#### Scenario: Mark viewed
- **WHEN** the user checks "Viewed" on a file (or presses `v`)
- **THEN** GitHub records it as viewed, the file collapses, and the index count goes up by one

### Requirement: Changes since my last review
When the user has reviewed an earlier commit of the PR, the system SHALL show by default only the changes between that commit and the current head, limited to the PR's files, with a toggle to the full diff.

#### Scenario: Re-review after new commits
- **WHEN** the user opens a PR they reviewed at commit A and the head is now B
- **THEN** the diff shows A → B for the PR's files, says so, and offers "Show all changes"

#### Scenario: Rebased since
- **WHEN** A is not an ancestor of B
- **THEN** the banner warns that the files may also include changes from the base branch

### Requirement: Stack navigation
The system SHALL show a PR's position in its stack and link to the layers below and above it.

#### Scenario: Middle layer
- **WHEN** the user opens layer 3 of a 4-PR stack
- **THEN** the PR bar shows "‹ Layer 3/4 ›" linking to layers 2 and 4, and `[` / `]` navigate

### Requirement: Show more lines
The system SHALL let the user expand unchanged lines before, between, and after hunks, with correct old and new line numbers.

#### Scenario: Expand a gap
- **WHEN** the user clicks "Show 34 unchanged lines" above a hunk starting at line 35
- **THEN** lines 1–34 of the head file appear, highlighted, and are not commentable

### Requirement: Keyboard shortcuts
The system SHALL support `j`/`k` files, `n`/`p` threads, `v` viewed, `c` comment, `[`/`]` stack, `i` index, `⌘↵` finish review, `?` help, and SHALL ignore them while the user is typing.

#### Scenario: Space comments at the current line
- **WHEN** the user presses Space with the mouse over a diff line or rendered markdown block
- **THEN** the comment form opens for that line or block, exactly as clicking its "+" would; with nothing under the mouse it uses the first line at the top of the view, and with nothing commentable Space scrolls as usual

#### Scenario: Find in unrendered files
- **WHEN** the user presses ⌘F
- **THEN** every file renders so the browser's find covers the whole PR

### Requirement: Line comments on code
The system SHALL let the user start a comment on any diff line from a "+" shown on hover, and extend it to a range with shift-click.

#### Scenario: Comment on a code line
- **WHEN** the user hovers a line of a `.ts` file and clicks the "+"
- **THEN** a comment form opens under that line, anchored to it

### Requirement: Comment editor
The system SHALL provide, for line comments, replies, and the review summary, an editor with a GitHub-rendered preview, completion for emoji shortcodes and for @mentions of people on the PR, formatting shortcuts, and (for line comments) insertion of a suggested-change block prefilled with the commented lines.

#### Scenario: Emoji and mention completion
- **WHEN** the user types ":tad" or "@gag"
- **THEN** matching emoji (with their images) or PR participants are offered, and Enter or Tab inserts ":tada: " or "@gagandeep-buku "

#### Scenario: Preview
- **WHEN** the user switches to Preview
- **THEN** the text is shown as GitHub renders it (emoji, mention links, suggestion blocks)

#### Scenario: Suggest a change
- **WHEN** the user clicks "Suggest" in a comment on lines 39–40
- **THEN** a ```suggestion block containing lines 39–40 is inserted

### Requirement: Conversation
The system SHALL show the PR description, top-level comments, and submitted reviews with a verdict or summary above the files, in time order.

#### Scenario: Reviews and comments
- **WHEN** a PR has two comments and an approving review
- **THEN** all three appear in the conversation, the review labeled as approved

### Requirement: Inline review threads
The system SHALL show existing review threads inline at their line, with resolved and outdated threads collapsed, and SHALL allow replying to, resolving, and unresolving a thread.

#### Scenario: Reply to a thread
- **WHEN** the user submits a reply in an existing thread
- **THEN** the reply is posted to GitHub immediately and appears in the thread

### Requirement: Draft and submit a review
The system SHALL let the user draft line, multi-line, and file-level comments, keep drafts across page reloads, and submit them as a single review with event Comment, Approve, or Request changes.

#### Scenario: Edit a pending comment
- **WHEN** the user clicks Edit on a pending comment
- **THEN** it reopens in the comment form at the same place and Update replaces it

#### Scenario: Drafts survive reload
- **WHEN** the user has unsent draft comments and reloads the page
- **THEN** the drafts are restored at their positions

#### Scenario: Submit review
- **WHEN** the user submits with event "Approve" and two drafts
- **THEN** one review containing both comments is created on GitHub and the local drafts are cleared

#### Scenario: Submit fails
- **WHEN** the submit request fails
- **THEN** the drafts are kept and the error message from GitHub is shown

#### Scenario: New commits pushed while reviewing
- **WHEN** the PR head SHA changed since drafts were created
- **THEN** the user is warned before submitting, and the review is submitted against the SHA the drafts were written on

### Requirement: Merge my own PRs
On a PR the user opened or is assigned to, the system SHALL show GitHub's merge status with the reasons it can't merge yet, and offer the matching controls: Ready for review (draft), Update branch (behind the base), merge with the repo's allowed methods, enable or disable auto-merge, and an admin bypass when the user may merge as admin. The sidebar's "Your PRs" entries SHALL show a merge pill (ready to merge, behind base, conflicts, auto-merge on).

#### Scenario: Blocked PR
- **WHEN** the user's PR is a draft with a required review and a failing check
- **THEN** the box reads "Not ready to merge: This is a draft · Review required · 1 failing check", offers Ready for review, and the merge button is disabled

#### Scenario: Merge with confirmation
- **WHEN** the user clicks "Squash and merge" on a mergeable PR
- **THEN** an editable commit title and message prefilled with GitHub's defaults appear, and only "Confirm squash and merge" merges, refusing if the head moved since the status loaded

#### Scenario: Someone else's PR
- **WHEN** the user reviews a PR they didn't open and aren't assigned to
- **THEN** no merge box is shown

### Requirement: Deleted files collapsed
The system SHALL show a deleted file in its place in the page and index, collapsed to a single row with its header (file-level Comment and Viewed still available), and show its removed lines only when asked. A deleted file that already has line comments SHALL open expanded.

#### Scenario: Deletion-heavy PR
- **WHEN** a PR deletes 25 files
- **THEN** each shows as one "Deleted. Show its N lines" row, and clicking one renders that file's removed lines

### Requirement: Comment links
The system SHALL link each comment (PR description, conversation comments and reviews, review-thread comments) to its github.com URL and offer a button that copies that URL.

#### Scenario: Copy a review comment's link
- **WHEN** the user clicks 🔗 on a review-thread comment
- **THEN** its `…/pull/N#discussion_r…` URL is on the clipboard and the button briefly reads "Copied"

### Requirement: Reviewer attention cues
The PR list SHALL show each PR's size and flag what needs the user or blocks the PR: failing CI, merge conflicts, unsent draft comments, and review threads awaiting the user's reply (open, not outdated, last comment by a person other than the user, on the user's PR or in a thread they joined; bots never count).

#### Scenario: Author answered my comment
- **WHEN** the author replies to a current, unresolved thread I commented in
- **THEN** the PR shows "💬 1 awaiting your reply" in the list, and the thread is outlined with "awaiting your reply" in the PR

### Requirement: Less to read in the diff
The diff SHALL highlight the changed span inside modified lines, dim code moved without changes (runs of 3+ lines unique on both sides of the PR) with a link to where it moved from or to, fold changed Kotlin/Java import blocks to one row naming packages the file didn't import before, and offer a remembered toggle (`w`) that shows whitespace-only changes as unchanged lines. Files SHALL be ordered markdown first, then each source file followed by its tests.

#### Scenario: Import block
- **WHEN** a Kotlin file's diff adds imports from `dagger`, `retrofit2` and a package it already imported
- **THEN** the import lines fold to "⋯ 3 imports added · show" with "+ retrofit2" (dagger was already imported), and a comment on one of those lines keeps the block open

#### Scenario: Moved block
- **WHEN** a PR moves a 10-line function from A.kt to B.kt unchanged
- **THEN** both runs are dimmed, B.kt's reads "Moved here from A.kt:n without changes", and boilerplate repeated across files is never reported as moved

### Requirement: Context without leaving the page
The system SHALL show the Jira ticket named in the PR title or branch (status, type, summary, description) via the Atlassian CLI, fold bot comments in the conversation to one line, return to the reading position when a PR is reopened, and mark files changed since the user's last visit.

#### Scenario: Resume
- **WHEN** the user leaves a PR mid-way and opens it again after a new push
- **THEN** the page scrolls back to where they were, and files whose content changed carry "new since your last visit"
