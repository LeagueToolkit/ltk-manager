---
title: "Extension: Spec Drift Detection"
type: extension
created: "2026-03-10"
updated: "2026-03-10"
---

## Hooks

| Hook             | Action                                                          |
| ---------------- | --------------------------------------------------------------- |
| before_implement | Compare existing code against spec requirements to detect drift |

## Configuration

| Setting | Default  | Description                                                                          |
| ------- | -------- | ------------------------------------------------------------------------------------ |
| scope   | modified | Which files to check: "modified" (only files in tasks) or "all" (full feature scope) |

## Instructions

### before_implement

Before `/genesis-implement` begins executing tasks, scan files that the feature's tasks will modify (not create) to detect behavioral divergence from the specification.

#### Process

1. **Identify target files.** Read the feature's `tasks.md` and collect all file paths listed under "Modifies:" (skip "Creates:" — new files can't have drift).

2. **Load the spec.** Read the feature's `spec.md` and extract all functional requirements (FR-\*) with their MUST/SHOULD/MAY strength.

3. **For each modified file that already exists:**

   a. Read the current file contents.

   b. Compare the file's current behavior against the FRs that reference it (via the task's Context Package spec requirements).

   c. Look for signs of drift:
   - Functions or methods that appear to implement an FR but with different behavior than specified
   - Constants or configuration values that contradict spec requirements
   - Control flow that handles cases differently than the spec describes
   - Missing validation or checks that the spec requires

4. **Classify each finding:**
   - **Confirmed drift:** Code clearly contradicts a specific FR
   - **Possible drift:** Code behavior is ambiguous relative to the FR
   - **Stale code:** Code implements behavior from a previous version of the spec that has since changed

5. **Report findings.**

#### Output Format

```markdown
## Spec Drift Report

**Feature:** {feature-name}
**Files checked:** {count}
**Findings:** {count}

### Confirmed Drift

| #   | FR       | File   | Description     | Impact                  |
| --- | -------- | ------ | --------------- | ----------------------- |
| 1   | FR-{NNN} | {path} | {what diverges} | {potential consequence} |

### Possible Drift

| #   | FR       | File   | Description          |
| --- | -------- | ------ | -------------------- |
| 1   | FR-{NNN} | {path} | {ambiguous behavior} |

### Recommendations

- {Actions to resolve drift before continuing implementation}
```

If no findings: "No spec drift detected — existing code aligns with current spec."

#### Important

- This extension is **advisory**. Findings do not block implementation.
- If confirmed drift is found, recommend: "Consider updating the spec to reflect current behavior, or plan to fix the drift during implementation."
- Do NOT modify any files. This is a read-only analysis.

## Requirements

- Feature must have both spec.md and tasks.md
- At least one task must modify an existing file (otherwise nothing to check)

## Changelog

| Version | Date       | Changes         |
| ------- | ---------- | --------------- |
| 1.0.0   | 2026-03-10 | Initial release |
