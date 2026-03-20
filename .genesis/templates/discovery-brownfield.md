---
title: "Brownfield Discovery Guide"
type: discovery
mode: brownfield
---

<!-- GUIDANCE: Brownfield discovery has two parts: automated codebase scan and human context. Run the scan first, then use findings to guide the conversation. -->

## Scan Exclusions

Before scanning, check for `.genesisignore` in the project root. This file uses gitignore syntax to exclude directories or files from the brownfield scan. Common exclusions:

- Build output directories (`dist/`, `build/`, `.next/`)
- Dependency directories (`node_modules/`, `vendor/`, `.venv/`)
- Generated files (`*.min.js`, `*.map`)
- Large binary assets

If `.genesisignore` doesn't exist, apply sensible defaults: skip `node_modules`, `vendor`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `coverage`, `.genesis`.

## Part 1: Automated Codebase Scan

Run the following analysis and document findings (respecting `.genesisignore` exclusions):

### 1.1 Languages & Frameworks

- Scan file extensions to identify languages
- Check config files: `package.json`, `requirements.txt`, `Gemfile`, `go.mod`, `Cargo.toml`, etc.
- Identify frameworks from dependencies and config files
- Note language/framework versions where detectable

### 1.2 Directory Structure

- Map the top-level directory layout
- Identify source code locations, test locations, documentation
- Note any non-standard or confusing organization
- Count total files by type

### 1.3 Test State

- Identify test framework(s) in use
- Count test files vs. source files
- Check for test configuration (jest.config, pytest.ini, etc.)
- Detect coverage configuration if present
- Note: do NOT run tests during scan, just assess their presence

### 1.4 Dependency Health

- List major dependencies and their versions
- Flag obviously outdated major versions
- Check for known vulnerability advisories if lockfile present
- Note dependency count (are there too many?)

### 1.5 Configuration & Infrastructure

- CI/CD files (.github/workflows, .gitlab-ci.yml, Jenkinsfile, etc.)
- Docker/container files
- Linting/formatting config (.eslintrc, .prettierrc, ruff.toml, etc.)
- Environment config (.env.example, config files)
- Deployment configuration

### 1.6 Git History

- Total commits, timespan
- Active branches
- Commit message patterns (are they consistent?)
- Recent activity level
- Contributor count

### 1.7 Documentation State

- README quality (exists? comprehensive? outdated?)
- Inline documentation density
- Separate documentation files
- API documentation
- Architecture decision records (ADRs)

---

## Part 2: Human Context

### 2.1 Project History

- How long has this project been in development?
- What were the major phases or pivotal decisions?
- How many people have worked on it?
- What was the original vision vs. what it became?

### 2.2 Current Development Practices

- How are builds done? (Manual? CI/CD?)
- How are tests run? How often? By whom?
- What does the deployment process look like?
- Is there a code review process?

### 2.3 Pain Points

- What is the hardest thing about working on this codebase?
- What takes longer than it should?
- What breaks frequently?
- What confuses new team members?

### 2.4 Technical Debt

- What specific areas need modernization?
- Are there known architectural problems?
- What would you refactor if you had unlimited time?
- Are there deprecated dependencies or patterns?

### 2.5 What Works Well

- What parts of the system are reliable and well-designed?
- What processes are working? Don't fix what isn't broken.
- What conventions has the team naturally adopted?

### 2.6 Improvement Priorities

- If you could fix three things, what would they be?
- What's blocking the team's productivity?
- Are there features waiting to be built that depend on structural improvements?

---

## Part 3: Gap Analysis

<!-- GUIDANCE: Generate this automatically by comparing scan results against what a greenfield project at this stage would have. -->

### What a Greenfield Project Would Have

- [ ] Constitution / documented principles
- [ ] Design documentation (architecture, data model, API contracts)
- [ ] Feature specifications for all implemented features
- [ ] Consistent test coverage meeting a defined threshold
- [ ] CI/CD pipeline with automated testing
- [ ] Linting and formatting enforced
- [ ] Up-to-date dependencies
- [ ] Comprehensive README and documentation
- [ ] Consistent commit messages and branching strategy
- [ ] Security practices documented and enforced

### Current State Assessment

| Area                   | Status                      | Notes     |
| ---------------------- | --------------------------- | --------- |
| Documented principles  | {Missing\|Partial\|Present} | {details} |
| Design documentation   | {Missing\|Partial\|Present} | {details} |
| Feature specifications | {Missing\|Partial\|Present} | {details} |
| Test coverage          | {Missing\|Partial\|Present} | {details} |
| CI/CD                  | {Missing\|Partial\|Present} | {details} |
| Code quality tools     | {Missing\|Partial\|Present} | {details} |
| Dependency health      | {Good\|Fair\|Poor}          | {details} |
| Documentation          | {Missing\|Partial\|Present} | {details} |
| Git practices          | {Missing\|Partial\|Present} | {details} |
| Security               | {Missing\|Partial\|Present} | {details} |

### Convergence Plan

Priority-ordered list of gaps to close to achieve greenfield parity:

1. {Highest priority gap}
2. {Second priority}
3. {Continue...}
