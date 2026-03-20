---
title: "Tasks: {Feature Name}"
type: tasks
created: "{Date}"
updated: "{Date}"
feature: "{feature-name}"
branch: "genesis/{NNN}-{feature-name}"
references:
  - ".genesis/features/{feature-name}/plan.md"
  - ".genesis/features/{feature-name}/spec.md"
progress: "0 of {total} complete"
---

## Summary

- **Total Tasks:** {count}
- **Complexity:** {N} Small, {N} Medium, {N} Large
- **Critical Path:** T-{NNN} → T-{NNN} → T-{NNN}
- **Progress:** {0} of {total} complete

## Dependency Graph

```
{ASCII dependency visualization}

Example:
T-001 (Setup) ──► T-002 (Models) ──► T-004 (Services)
                         │                    │
                         ▼                    ▼
                  T-003 (Schema)       T-005 (API) ──► T-007 (Integration Tests)
                                              │
                                       T-006 (UI) ──► T-008 (E2E Tests)
```

---

## Task Files

<!-- GUIDANCE: This index file contains NO individual task definitions. Task definitions live in per-group files.
Each group file stays under 500 lines to comply with size-guard.mjs. -->

- **T-001–{NNN}:** See `tasks-g1.md` ({group 1 name})
- **T-{NNN}–{NNN}:** See `tasks-g2.md` ({group 2 name})
- ... (one file per implementation group from the plan)

---

<!-- GUIDANCE: The sections below are templates for the GROUP FILES (tasks-g{N}.md), not for this index.
Each group file should use this structure for its tasks. -->

### T-001: {Title}

**Status:** Pending | In Progress | Complete | Blocked
**Complexity:** Small | Medium | Large
**Dependencies:** None
**Parallel:** {[P] if parallelizable}

#### Objective

{What this task produces — one to two sentences}

#### Acceptance Criteria

- [ ] {Testable criterion 1}
- [ ] {Testable criterion 2}

#### File Paths

- Creates: `{path}`
- Modifies: `{path}`

#### Context Package

<!-- GUIDANCE:
The Context Package tells /genesis-implement exactly what to load for this task — no more, no less.
This replaces loading the entire artifact tree with precise, per-task context scoping.

- **Spec Requirements:** List specific FR-xxx, AC-xxx IDs this task satisfies (not "all requirements")
- **Plan Sections:** List specific plan section numbers/titles referenced
- **Constitution Fragments:** List fragment names (e.g., backend, frontend, testing) — only those whose file_patterns match this task's files. If using unified constitution, write "All"
- **Design Docs:** List specific design doc paths relevant to this task
- **Shared Components:** List files used by other features, annotated (read-only) or (read-write)
- **Agent Boundary:** Always | Ask First | Never — from the spec's Agent Boundaries section
-->

- **Spec Requirements:** {FR-xxx, AC-xxx}
- **Plan Sections:** {Section numbers/titles}
- **Constitution Fragments:** {fragment names or "All"}
- **Design Docs:** {paths}
- **Shared Components:** {file (read-only|read-write)} or "None"
- **Agent Boundary:** {Always|Ask First|Never}

#### Commit Message

`{type}({scope}): {description}`

---

## Group 2: Core Logic

<!-- GUIDANCE: The main business logic and data layer tasks. -->

### T-002: {Title}

**Status:** Pending
**Complexity:** Medium
**Dependencies:** T-001

<!-- Continue pattern for each task -->

---

## Group 3: Integration

<!-- GUIDANCE: API endpoints, UI components, connecting pieces together. -->

---

## Group 4: Testing

<!-- GUIDANCE: Dedicated testing tasks beyond the tests written alongside implementation. -->

---

## Group 5: Polish

<!-- GUIDANCE: Documentation, cleanup, final touches. -->

### T-{NNN}: Update Studio documentation (MANDATORY)

**Status:** Pending
**Complexity:** Small
**Dependencies:** All implementation tasks
**Blocking:** Yes — this task MUST be completed before the pass/feature can be marked complete.

#### Objective

Review and update all Studio documentation sections affected by this pass/feature. Documentation sections declare which Genesis commands/features they cover — use those declarations to determine which sections need review.

#### Acceptance Criteria

- [ ] All documentation sections affected by changed commands/features have been reviewed
- [ ] New commands, changed behaviors, and updated templates are reflected in documentation
- [ ] Version-specific information is accurate for the current Genesis version
- [ ] No stale content remains in affected sections

#### File Paths

- Modifies: Affected files in `Genesis/src/lib/components/docs/sections/`
- Modifies: `Genesis/src/lib/services/docsSearchService.ts` (if new searchable entries needed)

#### Context Package

- **Spec Requirements:** FR-014, FR-016
- **Plan Sections:** N/A (determined per-pass)
- **Constitution Fragments:** All
- **Design Docs:** None
- **Shared Components:** Documentation section components (read-write)
- **Agent Boundary:** Always

#### Commit Message

`genesis: update documentation for {feature-name}`

---

## Convergence Milestone

**After Task:** T-{NNN}
**Description:** At this point, the project achieves structural parity with a greenfield project. All subsequent tasks operate as standard feature development.
**Criteria:**

- [ ] {Convergence criterion 1}
- [ ] {Convergence criterion 2}

## Coverage Verification

### Functional Requirements → Tasks

| Requirement | Covered By |
| ----------- | ---------- |
| FR-{NNN}    | T-{NNN}    |

### Acceptance Criteria → Task Criteria

| Spec AC  | Task AC               |
| -------- | --------------------- |
| AC-{NNN} | T-{NNN} criterion {N} |

### Testing Strategy → Test Tasks

| Plan Test          | Task    |
| ------------------ | ------- |
| {Test description} | T-{NNN} |
