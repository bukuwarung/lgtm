## ADDED Requirements

### Requirement: Slack DM after submitting a review
When Slack is configured, the system SHALL offer to message the PR author and assignees (excluding the reviewer and bots) on Slack after a review is submitted, with the verdict, a link to the PR, the comment count, and the review summary.

#### Scenario: Approve with Slack on
- **WHEN** the user approves with "Message @author on Slack" checked
- **THEN** the review is submitted and the author gets a DM like ":approved: Approved <link|org/repo#12 Title> · 2 comments" (":request-changes:" for requested changes; both are workspace emoji)

#### Scenario: Later reviews reply in the same thread
- **WHEN** the user reviews a PR they already sent a Slack DM about
- **THEN** the new message is a reply in that DM's thread, and if the thread no longer exists a new DM starts a new thread

#### Scenario: Slack not set up
- **WHEN** slackcli isn't installed or isn't signed in
- **THEN** the submit panel shows no Slack option

#### Scenario: Person not found on Slack
- **WHEN** a recipient can't be matched to a Slack user
- **THEN** the review stays submitted and the page says who couldn't be messaged and how to map them

### Requirement: Slack credentials stay out of lgtm
The system SHALL send Slack messages through slackcli, which holds the Slack sign-in, and SHALL only accept Slack requests from its own page.

#### Scenario: Recipient that looks like a flag
- **WHEN** a recipient value starts with `-` or isn't a user ID, `@handle`, or email
- **THEN** it is not passed to slackcli

#### Scenario: Request from another site
- **WHEN** another origin posts to `/slack`
- **THEN** the server answers `403`

### Requirement: Slack status and thread links on the PR page
The submit panel SHALL say why it offers no Slack message (slackcli not signed in, with its error, or nobody besides the user to message) instead of hiding the option silently. The PR page SHALL link to each stored Slack thread for that PR, as a message permalink on the workspace URL.

#### Scenario: Thread exists
- **WHEN** the user opens a PR they already messaged @isfa-buku about
- **THEN** the page shows "Slack: thread with @isfa-buku" linking to `https://<workspace>.slack.com/archives/<channel>/p<ts>`

#### Scenario: Own PR
- **WHEN** the user finishes a review on their own PR with no other assignees
- **THEN** the panel reads "No Slack message: nobody besides you is the author or an assignee"

### Requirement: Find Slack accounts
Settings SHALL list the watched team's members and the people in the user's queue with their current Slack mapping, and offer to look up the unmapped ones through slackcli: by their verified company email on GitHub, then by their GitHub name, then by their login's first word, accepting a match only when exactly one live Slack person is found. Each match SHALL be saved only when the user confirms it, to the user's config (`~/.config/lgtm/config.json`), the only place the mapping lives; an entry can be removed.

#### Scenario: New teammate
- **WHEN** `@mandeep-buku` has no mapping and the user clicks "Find Slack accounts"
- **THEN** the row shows "Mandeep Singh (Mandeep) by same name" with Save, and bots or apps with no single match say so

### Requirement: Accounts marked as bots
Settings SHALL let the user mark a GitHub account as a bot and undo it. A marked account SHALL never get a Slack message and SHALL drop out of the Slack people list, and its comments SHALL be treated as a bot's: folded in the conversation, bot-only threads collapsed and grouped with bots in the index, and never counted as awaiting the user's reply.

#### Scenario: AI reviewer account
- **WHEN** the user marks `@vorflux` as a bot
- **THEN** it leaves the unmapped list, appears under "Marked as bots" with ×, and its review comments fold like other bots'
