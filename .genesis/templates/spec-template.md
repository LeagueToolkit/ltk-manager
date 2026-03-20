---
title: "Specification: {Feature Name}"
type: spec
version: "1.0"
status: Draft
created: "{Date}"
updated: "{Date}"
feature: "{feature-name}"
branch: "genesis/{NNN}-{feature-name}"
---

## 1. Overview

<!-- GUIDANCE: What this feature does, in plain language. One to three paragraphs. No implementation details. -->

{Feature description}

## 2. Design Document References

<!-- GUIDANCE: Links to relevant design docs that provide context for this spec. -->

- [Design Overview](.genesis/design/overview.md)
- [{Relevant Feature Design}](.genesis/design/features/{name}.md)
- [{Relevant Technical Doc}](.genesis/design/technical/{name}.md)

## 3. User Stories

<!-- GUIDANCE: Format: "As a {role}, I want to {action} so that {value}." Each story represents a distinct user need. -->

### US-{NNN}: {Story Title}

**As a** {role}, **I want to** {action} **so that** {value}.

### US-{NNN}: {Story Title}

**As a** {role}, **I want to** {action} **so that** {value}.

## 4. Functional Requirements

<!-- GUIDANCE:
Specific, testable behaviors organized by user story. Say WHAT, not HOW.

Use RFC 2119 requirement strength keywords:
- **MUST** — Absolute requirement. Failure to satisfy is a spec violation. Review verdict: Fail.
- **SHOULD** — Expected in normal circumstances, but may be omitted with documented justification. Review verdict: Partial.
- **MAY** — Truly optional. Nice to have. Review verdict: Info only.

Example:
- **FR-001:** The system MUST validate all input before processing.
- **FR-002:** The system SHOULD cache responses for repeated queries.
- **FR-003:** The system MAY display a loading animation during processing.

Optional: Add Pre/Post/Invariant contracts for requirements involving state changes.
- **Pre:** {Required state before execution — what must be true for this to run}
- **Post:** {Guaranteed state after execution — what will be true when done}
- **Invariant:** {Property that must hold throughout execution}

Example with contracts:
- **FR-010:** The system MUST transition spec status from Draft to Approved on user confirmation.
  - **Pre:** Spec exists with status Draft. All open questions resolved.
  - **Post:** Spec status is Approved. Downstream commands (plan, tasks) are unblocked.
  - **Invariant:** Spec content is not modified during status transition.
-->

### From US-{NNN}: {Story Title}

- **FR-{NNN}:** {Requirement — what the system does, not how}
- **FR-{NNN}:** {Requirement}

### From US-{NNN}: {Story Title}

- **FR-{NNN}:** {Requirement}

## 5. Non-Functional Requirements

<!-- GUIDANCE: Performance, security, accessibility, compatibility requirements. Use measurable targets where possible. -->

- **NFR-{NNN}:** {Requirement — measurable where possible}
- **NFR-{NNN}:** {Requirement}

## 6. Acceptance Criteria

<!-- GUIDANCE:
Testable statements that define "done." Every criterion must be verifiable. These are what the review phase checks against.

Encouraged format — EARS (Easy Approach to Requirements Syntax):
  WHEN [condition], THE SYSTEM SHALL [expected behavior].

This format makes criteria machine-verifiable. If you cannot express a criterion as WHEN/SHALL, it may be ambiguous — consider rephrasing.

Example:
- [ ] **AC-001:** WHEN a user submits invalid form data, THE SYSTEM SHALL display validation errors next to relevant fields.
- [ ] **AC-002:** WHEN the spec status is Draft, THE SYSTEM SHALL block downstream commands (plan, tasks, implement).

Freeform criteria are acceptable when WHEN/SHALL doesn't fit naturally.
-->

- [ ] **AC-{NNN}:** WHEN {condition/trigger}, THE SYSTEM SHALL {expected behavior}.
  - **Verifiable by:** {integration_test | compilation | manual}
  - **Test ref:** {test function name or "N/A" for manual}
- [ ] **AC-{NNN}:** WHEN {condition/trigger}, THE SYSTEM SHALL {expected behavior}.
  - **Verifiable by:** {integration_test | compilation | manual}
  - **Test ref:** {test function name or "N/A"}
- [ ] **AC-{NNN}:** {Freeform criterion — when EARS format doesn't fit naturally}

## 6b. Expected Outputs

<!-- GUIDANCE:
Declare the concrete files this feature will create or modify. This table drives:
- scope-guard hook (blocks writes outside this list)
- step-complete hook (verifies all expected files exist)
- review phase (checks all outputs were produced)

Actions: Create (new file), Modify (edit existing), Delete (remove file)
-->

| Action                   | Path          | Description           |
| ------------------------ | ------------- | --------------------- |
| {Create\|Modify\|Delete} | `{file path}` | {what this file does} |
| {Create\|Modify\|Delete} | `{file path}` | {what this file does} |

## 7. Agent Boundaries

<!-- GUIDANCE:
Define the blast radius for AI agent actions during implementation. Three tiers:

**Always (no approval needed):** Safe, reversible operations within the feature's scope.
  Examples: creating new files in the feature directory, modifying files listed in tasks, running tests, reading context.

**Ask First (requires explicit approval):** Operations with broader impact or partial reversibility.
  Examples: modifying shared components used by other features, changing configuration files, modifying build scripts.

**Never (hard stops):** Operations that should never be automated regardless of context.
  Examples: deleting production data, modifying auth/security code without review, pushing to protected branches, modifying the constitution.
-->

### Always

- {Operations the AI can perform without asking}

### Ask First

- {Operations requiring explicit user approval}

### Never

- {Operations the AI must never perform autonomously}

## 8. Changelog Preview

<!-- GUIDANCE:
Force articulation of user-visible outcomes before implementation begins. What will users notice? What will developers notice? This section becomes the basis for the changelog entry generated after review.
-->

### What users will see

- {User-facing change — visible behavior, UI, or experience difference}

### What developers will see

- {Developer-facing change — API, tooling, configuration, or workflow difference}

## 9. Out of Scope

<!-- GUIDANCE: Explicitly what this spec does NOT cover. Prevents scope creep during planning and implementation. -->

- {What is not included and why}

## 10. Assumptions

<!-- GUIDANCE: Implicit assumptions surfaced and documented. Things you believe to be true but haven't verified. Each assumption should be falsifiable — if proven wrong, it changes the spec. -->

- **A-{NNN}:** {Assumption — what you believe to be true and why it matters}

## 11. Open Questions

<!-- GUIDANCE: Unresolved items. If any exist, recommend running /genesis-clarify before planning. -->

- [ ] {Question — context and why it matters}

## 12. Constitution Compliance Check

<!-- GUIDANCE: Verify that nothing in this spec violates constitutional principles. List each relevant section and confirm compliance. -->

| Constitution Section    | Compliance                              | Notes   |
| ----------------------- | --------------------------------------- | ------- |
| Technology Stack        | {Compliant — no tech decisions in spec} | {notes} |
| Architecture Principles | {Compliant\|Concern}                    | {notes} |
| Code Standards          | {N/A — spec level}                      |         |
| Testing Philosophy      | {Addressed in NFRs}                     | {notes} |
| Security & Compliance   | {Compliant\|Concern}                    | {notes} |
| Performance             | {Addressed in NFRs}                     | {notes} |

## 13. Changelog

<!-- GUIDANCE: Track revisions to this spec. Each entry: version, date, what changed, why. -->

| Version | Date   | Change                | Reason |
| ------- | ------ | --------------------- | ------ |
| 1.0     | {Date} | Initial specification | —      |
