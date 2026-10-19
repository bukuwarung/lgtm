## ADDED Requirements

### Requirement: Firefox and Chrome support
The system SHALL run from a single build on Firefox 128+ and Chrome 121+ with identical behavior.

#### Scenario: Same package in both browsers
- **WHEN** the built zip is loaded in Firefox and in Chrome
- **THEN** sign-in, PR inbox, review view, and submit all work in both

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

#### Scenario: Refresh after submit
- **WHEN** the user submits a review
- **THEN** the sidebar reloads and the PR moves to its new group

#### Scenario: Open from toolbar on a PR tab
- **WHEN** the user clicks the toolbar button while the active tab is a GitHub PR URL
- **THEN** the review page opens directly on that PR

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

#### Scenario: Long paths
- **WHEN** files live under deep folders
- **THEN** the tree shows them nested by folder with single-child folder chains collapsed into one row, and folders can be collapsed

#### Scenario: Highlighting
- **WHEN** a changed file is TypeScript, Python, Go, YAML, or another common language
- **THEN** its diff lines are syntax highlighted, including lines inside multi-line strings or comments

### Requirement: Line comments on code
The system SHALL let the user start a comment on any diff line from a "+" shown on hover, and extend it to a range with shift-click.

#### Scenario: Comment on a code line
- **WHEN** the user hovers a line of a `.ts` file and clicks the "+"
- **THEN** a comment form opens under that line, anchored to it

### Requirement: Conversation
The system SHALL show the PR description, top-level comments, and submitted reviews with a verdict or summary above the files, in time order.

#### Scenario: Reviews and comments
- **WHEN** a PR has two comments and an approving review
- **THEN** all three appear in the conversation, the review labeled as approved

### Requirement: Inline review threads
The system SHALL show existing review threads inline at their line, with resolved and outdated threads collapsed, and SHALL allow replying to a thread.

#### Scenario: Reply to a thread
- **WHEN** the user submits a reply in an existing thread
- **THEN** the reply is posted to GitHub immediately and appears in the thread

### Requirement: Draft and submit a review
The system SHALL let the user draft line, multi-line, and file-level comments, keep drafts across page reloads, and submit them as a single review with event Comment, Approve, or Request changes.

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
