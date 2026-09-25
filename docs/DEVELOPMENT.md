# Development Guide

This guide covers how to build LTK Manager from source and contribute to the project.

## Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/)
- Platform-specific dependencies (see below)

### Linux

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### Windows / macOS

No additional system dependencies required beyond Rust and Node.js.

## Getting Started

```bash
git clone https://github.com/LeagueToolkit/ltk-manager.git
cd ltk-manager
pnpm install
```

### Development Mode

```bash
# Full dev mode — Rust backend + React frontend with hot reload
pnpm tauri dev

# Frontend only — skips the Rust rebuild, faster for UI iteration
pnpm dev
```

### macOS: build the injection host first

On macOS the patcher is a separate helper binary (`ltk_patcher_host`) built from
the `ltk-patcher-macos` crate and staged as a bundled resource. Build it once
before `pnpm tauri dev` (and again whenever that crate changes):

```bash
pnpm build:mac-host
```

Applying mods reads and writes the game's process memory, which needs root, so
the host asks for your administrator password once per app run (via a system
prompt). See `crates/ltk-patcher-macos/README.md` for how it works, its
limitations, and attribution. `pnpm build:mac-host` builds a universal binary
when both `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets are
installed (`rustup target add …`), otherwise the host architecture only.

### Verbose Backend Logging

```bash
RUST_LOG=ltk_manager=trace,tauri=info pnpm tauri dev
```

## Code Quality

```bash
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
pnpm format           # Prettier (auto-fix)
pnpm check            # All three (typecheck + lint + format:check)

# Rust
cargo clippy -p ltk-manager
cargo fmt -p ltk-manager
```

## Generated Files

Three artefacts are checked in and regenerated deliberately rather than at build time.

```bash
pnpm generate:types          # TypeScript bindings for the Tauri commands
pnpm generate:licenses       # public/third-party-licenses.json, needs cargo-about on PATH
pnpm generate:meta-schema    # the embedded meta schema snapshot
```

`generate:licenses` also runs from the pre-commit hook whenever `Cargo.lock` changes.

`generate:meta-schema` goes to the network, so it stays out of the hook. It writes nothing when the
snapshot already matches what the publisher serves, and it takes `--check` and `--force`, both
described in the script's own header. It reads the database out of the meta wiki's own repository
rather than from the API that serves the same bytes, because the API sits behind a bot check a CI
runner cannot pass - see `docs/research/meta-api-reachability-from-ci.md`. The runtime still reads
the API.

The release workflow refreshes the snapshot alongside the licenses manifest, because a snapshot
older than the installed game build stands the `bin/property-type` check down for the offline user
it exists to serve. That user is the one this matters for: the app syncs the schema itself before a
health sweep, so a machine that has synced is already past whatever the snapshot says.

## Production Build

```bash
pnpm tauri build
```

Output is written to `src-tauri/target/release/bundle/`:

| Platform | Path                                     | Format             |
| -------- | ---------------------------------------- | ------------------ |
| Windows  | `bundle/nsis/LTK Manager_*-setup.exe`    | NSIS installer     |
| macOS    | `bundle/dmg/LTK Manager_*.dmg`           | DMG disk image     |
| macOS    | `bundle/macos/LTK Manager.app`           | Application bundle |
| Linux    | `bundle/deb/ltk-manager_*.deb`           | Debian package     |
| Linux    | `bundle/appimage/ltk-manager_*.AppImage` | AppImage           |

`bundle.targets` in `src-tauri/tauri.conf.json` names the NSIS installer alone, per ADR-0039.
To build another format:

```bash
pnpm tauri build --bundles msi    # Windows MSI, which no release ships
pnpm tauri build --bundles dmg    # macOS DMG only
pnpm tauri build --bundles deb    # Linux Debian only
```

For faster unoptimized builds during development:

```bash
pnpm tauri build --debug
```

## Project Structure

```
ltk-manager/
├── src/                        # React frontend
│   ├── components/             # Shared UI components (wrapping base-ui)
│   ├── modules/                # Feature modules
│   │   ├── library/            # Mod library management
│   │   ├── patcher/            # Overlay patcher
│   │   ├── settings/           # App settings and theming
│   │   └── workshop/           # Creator tools
│   ├── routes/                 # File-based routing (TanStack Router)
│   ├── lib/                    # Tauri bindings and utilities
│   ├── stores/                 # Zustand client-side stores
│   └── styles/                 # Tailwind CSS + theme variables
├── src-tauri/                  # Rust backend (Tauri v2)
│   └── src/
│       ├── main.rs             # App setup, command registration
│       ├── commands/           # IPC command handlers
│       ├── mods/               # Mod install/uninstall/toggle logic
│       ├── overlay/            # Overlay building
│       ├── patcher/            # Patcher lifecycle + external injection host (ltk_patcher_host.exe)
│       ├── state.rs            # App state and settings
│       └── error.rs            # Error types and IPC result helpers
├── docs/                       # Documentation
├── .github/workflows/          # CI and release pipelines
├── package.json
└── vite.config.ts
```

## Tech Stack

| Layer             | Technology                             |
| ----------------- | -------------------------------------- |
| Desktop framework | Tauri v2                               |
| Backend           | Rust                                   |
| Frontend          | React 19, TypeScript, Vite             |
| Styling           | Tailwind CSS v4                        |
| Routing           | TanStack Router (file-based)           |
| Server state      | TanStack Query                         |
| Client state      | Zustand                                |
| Forms             | TanStack Form + Zod                    |
| UI primitives     | base-ui (wrapped in `src/components/`) |

## Log Files

Logs are written to disk automatically and are useful for debugging:

- **Windows:** `%APPDATA%\dev.leaguetoolkit.manager\logs\ltk-manager.log`
- **Linux / macOS:** `~/.local/share/dev.leaguetoolkit.manager/logs/ltk-manager.log`
