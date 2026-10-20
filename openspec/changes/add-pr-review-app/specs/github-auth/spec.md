## ADDED Requirements

### Requirement: Sign in with the GitHub CLI
The system SHALL authenticate with the token of the user's existing GitHub CLI login, without asking for credentials.

#### Scenario: gh signed in
- **WHEN** the user runs `lgtm` while `gh auth status` is signed in
- **THEN** the review UI opens in the default browser, already signed in

#### Scenario: gh missing or signed out
- **WHEN** the user runs `lgtm` without a gh login
- **THEN** it exits with a message to run `gh auth login`

#### Scenario: Token rejected
- **WHEN** GitHub answers `401`
- **THEN** the page tells the user to run `gh auth login` and reload, with unsent drafts kept

### Requirement: Token only reaches the lgtm page
The local server SHALL listen on 127.0.0.1 only and serve the token only to same-origin requests addressed to its own host.

#### Scenario: Other website asks for the token
- **WHEN** a page on another origin requests `http://127.0.0.1:4517/token`
- **THEN** the server answers `403`

#### Scenario: DNS rebinding
- **WHEN** a request arrives with a `Host` header other than `127.0.0.1:PORT` or `localhost:PORT`
- **THEN** the server answers `403`

### Requirement: One running instance
The system SHALL reuse an already running lgtm server instead of failing.

#### Scenario: Second launch
- **WHEN** `lgtm` is run while another lgtm is serving the port
- **THEN** it opens the browser on the running instance and exits
