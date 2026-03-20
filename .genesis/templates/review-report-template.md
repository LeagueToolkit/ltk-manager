---
title: "Review Report: {Feature Name}"
type: review
created: "{Date}"
feature: "{feature-name}"
status: Draft
---

## 1. Acceptance Criteria Verification

| #      | Criterion        | Status            | Notes     |
| ------ | ---------------- | ----------------- | --------- |
| AC-001 | {criterion text} | Pass/Fail/Partial | {details} |

**Summary:** {X} of {Y} criteria passed.

<!-- GUIDANCE:
Severity-weighted verdicts — use the requirement strength keyword to determine severity:
- A failing **MUST** requirement → **Fail** verdict (blocks merge)
- A failing **SHOULD** requirement → **Partial** verdict (merge with documented justification)
- A failing **MAY** requirement → **Info** only (does not affect verdict)

If the spec uses MUST/SHOULD/MAY keywords, apply this mapping. If the spec does not use strength keywords, treat all requirements as MUST (backward compatible).
-->

## 2. Contract Verification

<!-- GUIDANCE:
If any functional requirements in the spec declare Pre/Post/Invariant contracts, verify each one here. Skip this section entirely if no contracts are declared.
-->

| FR       | Contract             | Type               | Status    | Notes     |
| -------- | -------------------- | ------------------ | --------- | --------- |
| FR-{NNN} | {contract statement} | Pre/Post/Invariant | Pass/Fail | {details} |

**Summary:** {X} of {Y} contracts verified.

## 3. Constitution Compliance

| Section                 | Status    | Notes                                               |
| ----------------------- | --------- | --------------------------------------------------- |
| Technology Stack        | Pass/Fail | {Are all dependencies within the declared stack?}   |
| Architecture Principles | Pass/Fail | {Do components follow declared patterns?}           |
| Code Standards          | Pass/Fail | {Naming, structure, documentation per constitution} |
| Testing Philosophy      | Pass/Fail | {Coverage meets required levels?}                   |
| Quality Gates           | Pass/Fail | {All quality gates satisfied?}                      |
| Security & Compliance   | Pass/Fail | {Auth, data handling, secrets per constitution}     |
| Documentation           | Pass/Fail | {Required docs present and complete?}               |

## 4. Design Consistency

| Design Document   | Status              | Deviations                      |
| ----------------- | ------------------- | ------------------------------- |
| {design doc name} | Consistent/Deviated | {description of any deviations} |

## 5. Test Quality Assessment

- **Test Count:** {N} tests across {N} files
- **Coverage:** {percentage if available}
- **Edge Cases:** {Covered/Gaps identified}
- **Test Strategy Compliance:** {matches plan's testing strategy?}

## 6. Code Quality

| Check                    | Status        | Details        |
| ------------------------ | ------------- | -------------- |
| TODO/FIXME/HACK comments | {count found} | {locations}    |
| Unused imports/dead code | {count found} | {locations}    |
| Hardcoded values         | {count found} | {locations}    |
| Security concerns        | {count found} | {descriptions} |
| Performance concerns     | {count found} | {descriptions} |

## 7. Issues Found

| #   | Severity                   | Issue         | Location    | Fix Required |
| --- | -------------------------- | ------------- | ----------- | ------------ |
| 1   | {Critical/High/Medium/Low} | {description} | {file:line} | {Yes/No}     |

## 8. Recommendation

<!-- One of: -->
<!-- - All criteria pass. Feature is complete. -->
<!-- - {N} issues found. Create fix tasks and loop back to implementation. -->
<!-- - Major issues found. Requires spec/plan revision. -->

{recommendation}

## 9. Fix Tasks (if applicable)

<!-- Only populate if issues require fixes -->

| Task ID | Title             | Addresses Issue # | Priority          |
| ------- | ----------------- | ----------------- | ----------------- |
| T-{NNN} | {fix description} | #{issue number}   | {High/Medium/Low} |
