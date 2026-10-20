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
