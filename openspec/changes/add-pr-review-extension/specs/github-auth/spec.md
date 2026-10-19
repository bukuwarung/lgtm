## ADDED Requirements

### Requirement: Device flow sign-in
The system SHALL let the user sign in to GitHub using the OAuth device flow, displaying the user code and verification URL, and SHALL poll for the access token at the interval GitHub specifies.

#### Scenario: Successful sign-in
- **WHEN** the user clicks "Sign in with GitHub" and authorizes the code on github.com
- **THEN** the system stores the access token and shows the PR inbox

#### Scenario: Code expires
- **WHEN** the device code expires before the user authorizes
- **THEN** the system stops polling and offers to restart sign-in

#### Scenario: GitHub asks to slow down
- **WHEN** the token poll returns `slow_down`
- **THEN** the system increases its poll interval by the amount GitHub returns

### Requirement: Personal access token fallback
The system SHALL let the user sign in by pasting a GitHub personal access token instead of using the device flow.

#### Scenario: No OAuth client configured
- **WHEN** the build has no OAuth client ID
- **THEN** the sign-in screen shows only the token field

### Requirement: GitHub host access
The system SHALL verify it has host access to `github.com` and `api.github.com` before sign-in, and SHALL let the user grant it with one click if missing.

#### Scenario: Host access not granted at install
- **WHEN** the review page opens and host permissions are not granted
- **THEN** a "Grant GitHub access" button is shown instead of sign-in, and clicking it requests the permissions

#### Scenario: Host access already granted
- **WHEN** host permissions were granted at install
- **THEN** sign-in is shown directly

### Requirement: Token persistence and sign-out
The system SHALL persist the token in extension-local storage only, and SHALL delete it on sign-out.

#### Scenario: Reopen after restart
- **WHEN** the user reopens the review page after restarting the browser
- **THEN** the user is still signed in

#### Scenario: Sign out
- **WHEN** the user clicks "Sign out"
- **THEN** the token is removed from storage and the sign-in screen is shown

### Requirement: Revoked or invalid token
The system SHALL treat any `401` response from the GitHub API as a signed-out state.

#### Scenario: Token revoked on github.com
- **WHEN** an API call returns `401`
- **THEN** the token is deleted and the user is returned to sign-in, with unsent review drafts kept
