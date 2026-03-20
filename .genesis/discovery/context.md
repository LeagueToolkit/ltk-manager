# Discovery Context — LTK Manager

**Mode:** Brownfield
**Discovered:** 2026-03-20

---

## Project Identity

- **Name:** LTK Manager (LeagueToolkit Mod Manager)
- **Description:** Desktop application for managing League of Legends mods
- **Repository:** https://github.com/LeagueToolkit/ltk-manager
- **Version:** 1.1.0 (292 commits, established project)
- **License:** MIT OR Apache-2.0 (with special license addendum for cslol-dll.dll)
- **Target Platform:** Windows 10+ (macOS/Linux planned)

## Team & Workflow

- **Development model:** Feature branches merged via pull requests
- **Branching convention:** Feature branches (e.g., `005-project-creation-ux`), release branches (`release/v*`)
- **Current contributor focus:** Frontend UI/UX (backend handled by other team members)
- **Release process:** Git tags → GitHub Actions → code-signed Windows builds → auto-updater manifest

## Technology Stack

### Frontend

| Layer            | Technology                 | Version           |
| ---------------- | -------------------------- | ----------------- |
| UI Framework     | React                      | ^19.0.0           |
| Language         | TypeScript (strict)        | ^5.6.0            |
| UI Primitives    | @base-ui/react             | 1.2.0 (pinned)    |
| Routing          | @tanstack/react-router     | ^1.139.11         |
| Server State     | @tanstack/react-query      | ^5.90.20          |
| Forms            | @tanstack/react-form + Zod | ^1.28.0 / ^3.24.0 |
| Client State     | Zustand                    | ^5.0.0            |
| Styling          | Tailwind CSS v4            | ^4.2.1            |
| Build            | Vite                       | ^8.0.0            |
| Pattern Matching | ts-pattern                 | ^5.9.0            |
| Drag & Drop      | @dnd-kit                   | ^6.3.1            |
| Icons            | react-icons                | ^5.5.0            |
| Hotkeys          | react-hotkeys-hook         | ^5.2.4            |

### Backend (Rust)

| Layer          | Technology                   | Version         |
| -------------- | ---------------------------- | --------------- |
| Desktop Shell  | Tauri                        | v2              |
| Async Runtime  | Tokio                        | 1 (full)        |
| Serialization  | Serde + serde_json           | 1               |
| TS Type Gen    | ts-rs                        | 12              |
| Error Handling | thiserror + anyhow           | 2 / 1           |
| HTTP           | reqwest                      | 0.12 (blocking) |
| Logging        | tracing + tracing-subscriber | 0.1 / 0.3       |
| Compression    | zstd, flate2, zip            | —               |
| FFI            | libloading                   | 0.9.0           |

### LeagueToolkit Domain Crates

ltk_modpkg, ltk_mod_project, ltk_mod_core, ltk_fantome, ltk_overlay, ltk_wad, ltk_file

## Architecture

### Frontend Modules (`src/modules/`)

| Module    | Purpose                                                          |
| --------- | ---------------------------------------------------------------- |
| library   | Mod library management (install, enable, disable, reorder)       |
| patcher   | Overlay patcher lifecycle and progress                           |
| settings  | App settings and theming                                         |
| workshop  | Creator tools (project editor, layer management, .modpkg export) |
| migration | Legacy migration support                                         |
| updater   | In-app update flow                                               |
| deep-link | ltk:// protocol install handling                                 |
| shell     | Shell/file open utilities                                        |

### Backend Modules (`src-tauri/src/`)

| Module          | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| commands/       | IPC wrappers (one file per domain)                        |
| mods/           | Mod install/uninstall/toggle, profile CRUD, library index |
| overlay/        | Overlay building, content providers                       |
| patcher/        | Patcher lifecycle, thread management                      |
| legacy_patcher/ | FFI wrapper for cslol-dll.dll                             |
| workshop/       | Workshop project management, packing                      |
| deep_link/      | ltk:// protocol handling                                  |

### Key Patterns

- **IPC:** Rust commands → `IpcResult<T>` → frontend `invokeResult<T>()` → `Result<T, E>` discriminated union
- **Error codes:** `ErrorCode` enum (14 variants, SCREAMING_SNAKE_CASE) with JSON context
- **Component library:** All base-ui primitives wrapped in `src/components/`, imported via barrel exports
- **Type generation:** Rust structs → ts-rs → TypeScript bindings in `src/lib/bindings/`
- **Styling:** Tailwind v4 with HSL accent color system, dark theme default

## Testing

### Frontend

- **Framework:** Vitest ^4.0.18 with jsdom
- **Coverage:** 13 test files covering stores, utils, hooks
- **Libraries:** @testing-library/react, @testing-library/user-event, @testing-library/jest-dom
- **Mocks:** Custom Tauri API mock in `src/test/mocks/tauri.ts`

### Backend

- **Inline tests:** 12 modules with `#[cfg(test)]` blocks
- **Dev deps:** tempfile, assert_matches, filetime

## CI/CD

### GitHub Actions Workflows

- **ci.yml:** Frontend check (pnpm check), cargo check, cargo test, clippy (-D warnings), rustfmt
- **release.yml:** Windows code-signed builds, git-cliff changelog, GitHub release, updater manifest
- **release-prepare.yml:** Release branch preparation

### Pre-commit

- Husky v9 + lint-staged
- ESLint + Prettier for TS/TSX, cargo fmt for Rust

## Documentation

| Document               | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| README.md              | Project overview, features, installation       |
| CLAUDE.md              | AI coding guidance, conventions, module layout |
| DESIGN.md              | Design decisions                               |
| docs/DEVELOPMENT.md    | Dev setup, build matrix, project structure     |
| docs/ERROR_HANDLING.md | Error handling patterns                        |
| specs/                 | Feature specs (001, 003, 004)                  |
| cliff.toml             | Changelog generation config                    |

## Pain Points & Focus Areas

- **Primary focus:** Frontend UI/UX improvements
- **Backend:** Handled by other contributors, not a current concern
- **Approach:** Iterative — work on what feels like it should be improved

## Gap Analysis

| Area                              | Status  | Notes                                                         |
| --------------------------------- | ------- | ------------------------------------------------------------- |
| Unit Testing (Frontend)           | Present | 13 Vitest test files covering stores, utils, hooks            |
| Unit Testing (Backend)            | Present | 12 modules with inline Rust tests                             |
| Integration Testing               | Partial | No end-to-end integration between Rust and React layers       |
| E2E Testing                       | Missing | No Playwright, Cypress, or UI automation                      |
| CI/CD — Build & Release           | Present | Full pipeline: lint, test, build, code-sign, auto-update      |
| CI/CD — Platform Coverage         | Partial | Windows only in release; Linux/macOS configured but not built |
| Documentation — Developer         | Present | Comprehensive DEVELOPMENT.md, ERROR_HANDLING.md, CLAUDE.md    |
| Documentation — Component Library | Partial | Documented in CLAUDE.md; no Storybook or interactive catalog  |
| Contributing Guide                | Partial | README mentions contributions; no CONTRIBUTING.md             |
| Linting & Formatting              | Present | ESLint, Prettier, Clippy, Rustfmt — all enforced              |
| Type Safety                       | Present | TS strict mode, ts-rs bindings, Zod runtime validation        |
| Error Handling                    | Present | Structured Result<T,E> on both sides with error codes         |
| State Management                  | Present | Zustand (client) + TanStack Query (server)                    |
| Component Library                 | Present | 15+ base-ui wrappers with enforced import conventions         |
| Accessibility                     | Missing | No formal a11y audit, testing, or WCAG compliance             |
| Performance Monitoring            | Missing | No web-vitals, bundle analysis, or APM                        |
| Internationalization              | Missing | All UI text hardcoded in English                              |
| Security — Dependency Scanning    | Missing | No Dependabot or Snyk                                         |
| Design System — Component Catalog | Missing | No Storybook or living component docs                         |
| Logging                           | Present | Structured tracing with file output and RUST_LOG control      |

### Priority Convergence (Frontend-focused)

1. **Component documentation** — Storybook or similar for the base-ui wrappers (low urgency, high value for onboarding)
2. **Accessibility** — Automated a11y testing since base-ui provides good primitives
3. **E2E testing** — Playwright for critical user flows (mod install, patching)

## Flags & Observations

- **Untracked files:** Several JS files at root (`src/agents.js`, `src/scaffold.js`, etc.) and `bin/` appear to be Genesis tooling scaffolded but not committed. These don't fit the TS/React convention — should be `.gitignore`d or moved.
- **Modified Tauri schemas:** `desktop-schema.json` and `windows-schema.json` are modified but unstaged (auto-generated, likely intentional).
- **@base-ui/react pinned at 1.2.0:** Exact pin suggests tight coupling to a specific API surface; upgrades need careful testing.
- **Windows-only releases:** macOS/Linux are planned but not yet in CI.
