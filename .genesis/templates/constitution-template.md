---
title: "Constitution: {Project Name}"
type: constitution
established: "{Date}"
mode: "{Greenfield|Brownfield|Lowfield}"
last_amended: "{Date or Never}"
---

## 1. Project Mission

<!-- GUIDANCE: One clear paragraph defining what this project exists to do. This is the "north star" — every decision should trace back to this mission. -->

{Project mission statement}

## 2. Technology Stack

<!-- GUIDANCE: Explicit declaration of every language, framework, database, infrastructure component, and key library. This is LAW. No plan or task may introduce tools outside this stack without a formal constitutional amendment. -->

### Languages

- {Language}: {version constraint}

### Frameworks

- {Framework}: {version constraint}

### Databases

- {Database}: {version or "latest stable"}

### Infrastructure

- {Hosting/cloud provider}
- {Container runtime if applicable}
- {CI/CD platform}

### Key Libraries

- {Library}: {purpose}

<!-- IF: Lowfield — rename this section to "Tools & Formats" -->

### Tools & Formats

- **Primary Format:** {e.g., Markdown, LaTeX}
- **Editor/Platform:** {e.g., Obsidian, VS Code}
- **Export Targets:** {e.g., PDF, EPUB, HTML}
- **Version Control:** Git
<!-- ENDIF -->

## 3. Architecture Principles

<!-- GUIDANCE: Define modularity approach, dependency direction, state management philosophy, API patterns, error handling strategy. -->
<!-- IF: Lowfield — rename to "Organizational Principles" and define hierarchy, naming, categorization, cross-referencing rules. -->

- {Principle 1}: {explanation}
- {Principle 2}: {explanation}
- {Principle 3}: {explanation}

## 4. Code Standards

<!-- GUIDANCE: Naming conventions, file structure, import organization, documentation requirements. -->
<!-- IF: Lowfield — rename to "Content Standards" and define voice, tone, style guide, formatting rules, terminology. -->

### Naming Conventions

- {Convention}: {rule}

### File Structure

- {Pattern}: {description}

### Documentation

- {Requirement}: {standard}

## 5. Testing Philosophy

<!-- GUIDANCE: Required coverage levels, testing approach (TDD, BDD, integration-first), what must be tested vs. optional. -->
<!-- IF: Lowfield — rename to "Quality Standards" and define accuracy, completeness, consistency, review process. -->

- **Approach:** {TDD|BDD|Integration-first|Other}
- **Minimum Coverage:** {percentage or "N/A"}
- **Required Tests:** {what must always be tested}
- **Optional Tests:** {what can be skipped}

## 6. Quality Gates

<!-- GUIDANCE: What must be true before code is considered complete. Linting, type safety, test passage, review requirements. -->
<!-- IF: Lowfield — rename to "Completion Criteria" and define what makes a content entry "done". -->

- [ ] {Gate 1}
- [ ] {Gate 2}
- [ ] {Gate 3}

## 7. Security & Compliance

<!-- GUIDANCE: Data handling rules, authentication/authorization patterns, regulatory constraints, secrets management. -->

- **Authentication:** {pattern}
- **Authorization:** {pattern}
- **Data Handling:** {rules}
- **Secrets Management:** {approach}
- **Regulatory:** {constraints or "None"}

## 8. Performance Expectations

<!-- GUIDANCE: Response time targets, bundle size limits, resource constraints, scaling approach. -->

- **Response Time:** {target}
- **Bundle Size:** {limit or "N/A"}
- **Scaling:** {approach}

## 9. Documentation Requirements

<!-- GUIDANCE: What must be documented, where it lives, minimum standard of quality. -->

- **Inline Documentation:** {standard}
- **External Documentation:** {where and what}
- **API Documentation:** {standard}

## 10. Version Control Strategy

<!-- GUIDANCE: Branching model, commit message format, merge strategy, release process. -->

- **Branching Model:** {feature branches|trunk-based|GitFlow|other}
- **Branch Naming:** {pattern}
- **Commit Format:** {conventional commits|other}
- **Merge Strategy:** {squash|rebase|merge commits}
- **Release Process:** {description}

## 11. Amendment Process

### Amendment Tiers

| Tier             | Sections                                      | Requirements                                        |
| ---------------- | --------------------------------------------- | --------------------------------------------------- |
| **Foundational** | 1 (Mission), 2 (Tech Stack), 3 (Architecture) | Full impact analysis, review all existing artifacts |
| **Standard**     | 4-8, 10                                       | Impact analysis, spot-check recent artifacts        |
| **Advisory**     | 9 (Documentation), 11 (Amendments)            | Justification only                                  |

### Amendment Procedure

To amend this constitution:

1. The user must explicitly request the amendment (or use `/genesis-amend`)
2. The amendment tier determines the review depth required
3. The rationale must be documented
4. Impact on existing artifacts must be assessed (per tier)
5. The user must approve the amendment
6. The amendment is logged below with date, rationale, and what changed
7. Precedents affected by the amendment should be reviewed (see `.genesis/design/precedents.md`)

### Review Schedule

**Review after every:** {N} completed features
**Last reviewed:** Never
**Next review due:** After feature #{N}

### Amendment Log

| #   | Date | Section | Tier | Change | Rationale |
| --- | ---- | ------- | ---- | ------ | --------- |
| —   | —    | —       | —    | —      | —         |

## 12. Legacy Handling

<!-- GUIDANCE: How to treat existing code that doesn't meet the constitution. For each area, choose: Immediate refactor, Progressive migration (refactor when touched + deadline), or Grandfather clause (accepted as-is with optional sunset). -->

| Area   | Strategy                              | Deadline         | Notes   |
| ------ | ------------------------------------- | ---------------- | ------- |
| {area} | {Immediate\|Progressive\|Grandfather} | {date or "None"} | {notes} |
