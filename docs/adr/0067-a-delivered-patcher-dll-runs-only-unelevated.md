# ADR-0067: A delivered patcher DLL runs only unelevated

- **Status:** Superseded by [ADR-0074](0074-every-session-runs-a-delivered-patcher-dll.md)
- **Date:** 2026-10-20
- **Crates:** `ltk-manager-runtime`, where `PatcherDelivery` syncs and selects the build, and
  `src-tauri`, which holds the service constants
- **Related:** Extends [ADR-0055](0055-ltk-manager-installs-per-machine.md).

## Context and problem statement

The patcher delivery service offers a signed DLL per channel and manager version range, so the
manager can run a new patcher build without a manager release. The manager runs unelevated and can
write only to directories that the user owns. The host loads the DLL from its own directory, so a
delivered DLL needs a host copy beside it in such a directory.

ADR-0055 requires that a host that runs at high integrity loads only binaries from an
administrator-only directory. A delivered DLL in the app data directory does not meet that rule.

## Decision

**A delivered DLL runs only in an unelevated host.** An unelevated session runs the host copy
and the delivered DLL from `<app data>/patcher/<digest>`. An elevated session runs the bundled
host and DLL from the install directory. The selection hashes the staged DLL at every start and
falls back to the bundled DLL if the digest differs from the signed manifest.

**A revocation applies to the bundled DLL too.** If a cached manifest revokes the bundled DLL and
no delivered DLL replaces it, the patcher does not start.

**A start never waits for the network.** The selection reads only the cached manifests. A sync
runs in the background at startup, at every patcher start and when the channel changes.

## Consequences

**An elevated session runs the bundled build.** An elevated session runs a fixed DLL only after a
manager release bundles it, until the patcher has an installer of its own.

**The first start after an install runs the bundled build.** The first sync runs in the
background, so a delivered build applies from a later start.
