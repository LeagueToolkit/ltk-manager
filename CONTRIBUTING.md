# Contributing to LTK Manager

The [README](README.md) is written for someone who uses the app. This file is for someone who
reports a bug, builds the app, or works on the code.

## Reporting a bug

Open an issue from the [issue templates](https://github.com/LeagueToolkit/ltk-manager/issues/new/choose).
A report is most useful with:

- The app version, from **Settings > About**
- The steps that reproduce it
- The log file, from the path below

| Platform      | Log file                                                        |
| ------------- | --------------------------------------------------------------- |
| Windows       | `%APPDATA%\dev.leaguetoolkit.manager\logs\ltk-manager.log`      |
| Linux / macOS | `~/.local/share/dev.leaguetoolkit.manager/logs/ltk-manager.log` |

Questions and support go to the [Discord](https://discord.gg/yhzDVRyQex) rather than the issue
tracker.

## Building from source

The [Development Guide](docs/DEVELOPMENT.md) covers the prerequisites, the dev and production
builds, the generated files, and the layout of the repository.

## How the project is organized

- `GLOSSARY.md` is the glossary. The words the codebase uses for its own concepts, and the ones it
  deliberately does not.
- `docs/adr/` holds the decisions, one file each.
- `docs/ux/` holds the product reasoning for each screen: what it is for, what it does today, and
  what is planned.
- `docs/releases/` holds the release notes, one file per version, written for whoever installs
  the build.
- `news/notices.json` is the notice banner the app draws on Home. A notice ships by merging a
  pull request, without a release.

## Commits and pull requests

A commit is one conventional-commit subject line, in the codebase's own vocabulary, with no
body. A pull request takes that same subject as its title. `AGENTS.md` holds the rules in full,
with examples.

Before opening a pull request:

```bash
pnpm check                              # typecheck, lint, format check, tests
cargo clippy --all-targets              # Rust lints
cargo fmt --all -- --check              # Rust formatting
```

## Reusing the patcher binaries

The LTK patcher binaries perform the game injection. The app bundles `ltk_patcher_host.exe` and
downloads `ltk_patcher_dll.dll` at runtime. A build from source uses the DLL that an official
install downloaded. The binaries are governed by the
[LTK Patcher License](LTK-PATCHER-LICENSE.md). The short version, for a launcher or tool of your
own:

1. You are free to use, study, modify and redistribute them.
2. Official builds are code-signed by League Toolkit. Unless explicitly permitted, you may not
   ship them under that signature. Strip it, and if you sign, sign with your own certificate.
3. Whatever you distribute is on your name. If it gets a code-signing certificate flagged or
   banned, that certificate must be yours, not ours.

For the full terms, see [LTK-PATCHER-LICENSE.md](LTK-PATCHER-LICENSE.md).

## License

Contributions are licensed under the
[GNU General Public License v3.0 or later](LICENSE), the same as the project.
