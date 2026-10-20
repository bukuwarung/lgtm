## ADDED Requirements

### Requirement: Detect linguist-generated files
The system SHALL read the repository root `.gitattributes` at the PR head SHA and mark a changed file as generated when the last matching line sets `linguist-generated` (bare or `=true`) and no later matching line unsets it (`-linguist-generated` or `=false`).

#### Scenario: Basename pattern
- **WHEN** `.gitattributes` has `*.pb.go linguist-generated` and the PR changes `api/v1/user.pb.go`
- **THEN** `api/v1/user.pb.go` is marked generated

#### Scenario: Anchored pattern
- **WHEN** `.gitattributes` has `gen/** linguist-generated=true`
- **THEN** `gen/a/b.ts` is generated and `src/gen/b.ts` is not

#### Scenario: Later line unsets
- **WHEN** `.gitattributes` has `dist/** linguist-generated` followed by `dist/keep.js -linguist-generated`
- **THEN** `dist/keep.js` is not generated

#### Scenario: No .gitattributes
- **WHEN** the repository has no root `.gitattributes`
- **THEN** no files are marked generated

### Requirement: Hide generated files
The system SHALL exclude generated files from the scrolling view and outline, and SHALL show a single row stating how many were hidden, which reveals them when clicked.

#### Scenario: Generated files hidden
- **WHEN** a PR changes 10 files of which 3 are generated
- **THEN** 7 files are shown and a row reads "3 generated files hidden"

#### Scenario: Renamed without changes
- **WHEN** a PR renames or moves 5 files without changing their content
- **THEN** they are hidden behind a "5 files renamed or moved without changes hidden" row, while binary or too-large files that did change stay visible

#### Scenario: Reveal
- **WHEN** the user clicks the hidden-files row
- **THEN** the generated files are shown at the end of the view
