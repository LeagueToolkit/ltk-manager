---
title: "Extension: Changelog Generation"
type: extension
created: "2026-03-10"
updated: "2026-03-10"
---

## Hooks

| Hook         | Action                                                     |
| ------------ | ---------------------------------------------------------- |
| after_review | Generate a changelog entry when the review verdict is Pass |

## Configuration

| Setting | Default        | Description                                           |
| ------- | -------------- | ----------------------------------------------------- |
| format  | keepachangelog | Changelog format: "keepachangelog" or "conventional"  |
| file    | CHANGELOG.md   | Path to the changelog file (relative to project root) |

## Instructions

### after_review

After a `/genesis-review` completes with a **Pass** verdict (all criteria pass), generate a changelog entry for the completed feature.

**Important:** Only fire when the review recommendation is "All criteria pass. Feature is complete." If the review found issues or requires fixes, do NOT generate a changelog entry.

#### Process

1. **Read the spec's Changelog Preview section.** Load `.genesis/features/{feature-name}/spec.md` and extract the "Changelog Preview" section. This contains:
   - **What users will see:** User-facing changes
   - **What developers will see:** Developer-facing changes (API, internals)

2. **Read the git diff summary.** Run `git log --oneline main..HEAD` (or the appropriate base branch) to get the list of commits for this feature.

3. **Determine the version.** Check:
   - If `package.json` exists, read the current version
   - If the constitution specifies versioning strategy, follow it
   - Otherwise, use the date as the version identifier

4. **Generate the changelog entry** in Keep a Changelog format:

```markdown
## [{version}] - {YYYY-MM-DD}

### Added

- {New features from Changelog Preview — user-facing items}

### Changed

- {Modifications from Changelog Preview — user-facing items}

### Fixed

- {Bug fixes, if any}

### Developer

- {Developer-facing changes from Changelog Preview}
```

5. **Present the entry to the user.** Do NOT write to the changelog file automatically. Instead:
   - Show the generated entry
   - Ask: "Add this entry to {changelog file}? (Prepend after the header)"
   - If approved, prepend the entry after the changelog file's header (or create the file if it doesn't exist)

#### Output Format

```markdown
## Changelog Entry Generated

**Feature:** {feature-name}
**Commits:** {count}

{The formatted changelog entry}

Add to {changelog file}? This will prepend after the file header.
```

#### Edge Cases

- If no Changelog Preview section exists in the spec: generate the entry from commit messages only, and note: "No Changelog Preview found in spec. Entry generated from commit history."
- If the changelog file doesn't exist: offer to create it with a standard header.
- If the feature only has developer-facing changes: include only the Developer section.

## Requirements

- Review must pass (all criteria met)
- Feature must have spec.md with completed review
- Git repository with commits on feature branch

## Changelog

| Version | Date       | Changes         |
| ------- | ---------- | --------------- |
| 1.0.0   | 2026-03-10 | Initial release |
