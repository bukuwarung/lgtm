## ADDED Requirements

### Requirement: Markdown files first
The system SHALL order changed files with extensions `.md`, `.mdx`, or `.markdown` (case-insensitive) before all other files, preserving GitHub's path order within each group.

#### Scenario: Mixed PR
- **WHEN** a PR changes `src/a.ts`, `docs/z.md`, and `README.md`
- **THEN** the view order is `README.md`, `docs/z.md`, `src/a.ts`

### Requirement: Rich diff by default
The system SHALL render added or modified markdown files as rendered markdown of the head version by default, highlight blocks containing added lines, and mark positions where lines were removed. The user SHALL be able to toggle any markdown file to the source diff.

#### Scenario: Modified paragraph
- **WHEN** a markdown file's patch adds a line inside a paragraph
- **THEN** that paragraph is rendered and highlighted as changed, and unchanged blocks render without highlight

#### Scenario: New file
- **WHEN** a markdown file is added in the PR
- **THEN** it renders without any "changed" tint

#### Scenario: Removal only
- **WHEN** a hunk removes lines and adds none
- **THEN** a "removed" marker appears at that position showing the removed source text struck through

#### Scenario: Toggle to source
- **WHEN** the user toggles a markdown file to source view
- **THEN** the standard line diff for that file is shown, and toggling back restores the rich view

#### Scenario: Raw HTML in markdown
- **WHEN** a markdown file contains raw HTML such as `<script>` or `<img onerror>`
- **THEN** it is rendered as escaped text, not as HTML

#### Scenario: Deleted markdown file
- **WHEN** a markdown file is deleted in the PR
- **THEN** it is shown as a source diff

### Requirement: Line-anchored comments on rendered blocks
The system SHALL let the user comment on any rendered block, anchoring the comment to that block's source line range on the head side, and SHALL show existing threads after the top-level block containing their line.

#### Scenario: Comment on a changed list item
- **WHEN** the user comments on a rendered list item spanning head lines 12–14, all inside a hunk
- **THEN** the draft is a multi-line comment with `start_line` 12, `line` 14, side `RIGHT`

#### Scenario: Nested list items, table rows, and code blocks
- **WHEN** the user moves from a nested list item, a table row, or a line of a fenced code block to its "+" gutter
- **THEN** the "+" stays on that item (not its parent list, table, or whole code block) and the comment anchors to that item's source lines

#### Scenario: Comment shown under its line
- **WHEN** a comment or comment form belongs to a list item, table row, or code line inside a larger block
- **THEN** it renders directly under that item (inside the list item before any sub-list, in a new row after the table row, after the code line), not after the whole list, table, or code block

#### Scenario: Block partially inside a hunk
- **WHEN** a block spans lines 20–30 and only lines 25–40 are inside a hunk
- **THEN** the comment range is clamped to 25–30

#### Scenario: Sections outside the diff
- **WHEN** a markdown file has top-level sections with no line inside any hunk
- **THEN** runs of them fold into "Show N unchanged sections" rows (unless one holds a comment), and once shown they are read-only context without a "+" gutter, as are list items and code lines outside the diff inside a section that is shown

#### Scenario: Mermaid diagram
- **WHEN** a markdown file (or a PR comment) contains a ```mermaid block
- **THEN** the diagram is drawn; in a file it stays commentable as a whole, its source is available collapsed below with per-line comments, and a diagram that fails to parse shows the parse error instead

#### Scenario: Front matter
- **WHEN** a markdown file starts with a YAML front matter block
- **THEN** the front matter is shown as a code block and the rest renders with correct line anchors

#### Scenario: Existing thread
- **WHEN** a review thread exists on head line 13
- **THEN** it is shown right under the deepest rendered block (list item, table row, code line, paragraph, …) whose range contains line 13

### Requirement: Language of unmarked code blocks
A code block without a language SHALL be highlighted as the language of the file its comment is on; in markdown files, in comments on markdown or non-code files, and in the PR conversation, as the PR's most common code language (markdown and plain text not counted). Blocks GitHub marked with a language SHALL keep it.

#### Scenario: Comment on a YAML file
- **WHEN** a review comment on `module-list.yaml` contains a fenced block with no language
- **THEN** the block is highlighted as YAML, while the same block in the PR description of a mostly-Kotlin PR is highlighted as Kotlin
