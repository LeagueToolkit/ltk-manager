---
title: "Extension: Docs Drift Detection"
type: extension
created: "2026-03-14"
updated: "2026-03-14"
---

## Hooks

| Hook        | Action                                                 |
| ----------- | ------------------------------------------------------ |
| after_phase | Validate docs manifest against actual skills directory |

## Configuration

| Setting       | Default                            | Description                       |
| ------------- | ---------------------------------- | --------------------------------- |
| manifest_path | .genesis/design/docs-manifest.json | Path to the docs command manifest |
| skills_dir    | .claude/skills                     | Path to the skills directory      |

## Requirements

- `.genesis/design/docs-manifest.json` must exist
- `.claude/skills/` directory must contain skill subdirectories

## Instructions

### after_phase

After any Genesis phase completes, compare the docs command manifest against the actual skills directory to detect documentation drift.

**Scan process:**

1. Read `.genesis/design/docs-manifest.json` and extract the list of command names
2. Scan `.claude/skills/` for all `genesis-*/SKILL.md` directories — each directory name (minus `genesis-` prefix) is a command
3. Compare the two lists:
   - **Undocumented commands:** Skills that exist in `.claude/skills/` but are not in the manifest. Report: "Warning: {N} undocumented command(s): {list}. Add to docs-manifest.json."
   - **Stale manifest entries:** Commands in the manifest that have no matching skill directory. Report: "Warning: {N} stale manifest entry/entries: {list}. Remove from docs-manifest.json or create the skill."
4. If no drift detected: "Docs manifest is in sync with skills directory."

**Severity:** Advisory only. Drift warnings do not block any operations. They inform the developer that documentation may be out of date after a Genesis upgrade or skill addition.

## Changelog

| Version | Date       | Changes                               |
| ------- | ---------- | ------------------------------------- |
| 1.0     | 2026-03-14 | Initial extension for Pass 4.5 Studio |
