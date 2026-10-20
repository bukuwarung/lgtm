## ADDED Requirements

### Requirement: Slack DM after submitting a review
When Slack is configured, the system SHALL offer to message the PR author and assignees (excluding the reviewer and bots) on Slack after a review is submitted, with the verdict, a link to the PR, the comment count, and the review summary.

#### Scenario: Approve with Slack on
- **WHEN** the user approves with "Message @author on Slack" checked
- **THEN** the review is submitted and the author gets a DM like "✅ Approved <link|org/repo#12 Title> · 2 comments"

#### Scenario: Slack not configured
- **WHEN** no Slack token is configured
- **THEN** the submit panel shows no Slack option

#### Scenario: Person not found on Slack
- **WHEN** a recipient can't be matched to a Slack user
- **THEN** the review stays submitted and the page says who couldn't be messaged and how to map them

### Requirement: Slack token stays on the local server
The system SHALL keep the Slack token in the local server's config and only accept Slack requests from its own page.

#### Scenario: Request from another site
- **WHEN** another origin posts to `/slack`
- **THEN** the server answers `403`
