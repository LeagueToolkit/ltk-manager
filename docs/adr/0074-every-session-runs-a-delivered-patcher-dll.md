# ADR-0074: Every session runs a delivered patcher DLL

- **Status:** Accepted (2026-10-31)
- **Date:** 2026-10-31
- **Crates:** `ltk-manager-runtime`, `ltk-manager-core`, `src-tauri`
- **Related:** Supersedes [ADR-0067](0067-a-delivered-patcher-dll-runs-only-unelevated.md).
  Changes the context of [ADR-0055](0055-ltk-manager-installs-per-machine.md).

## Context and problem statement

The install directory held a patcher DLL with its own end of life. A session that could not run a
delivered DLL ran that copy, including every elevated session and the first start after an install.
A copy past its end of life refuses the game build, so those sessions ran without mods while a
newer DLL was available.

## Decision

**The manager bundles the host and no DLL.** Every session runs the host copy and the delivered DLL
from `<app data>/patcher/<digest>`.

**A session runs unelevated.** The start fails if League is set to run as administrator or if the
manager runs as administrator. A high-integrity host must not load a DLL from a directory that the
user can write.

**A session waits for the network only when it has to.** A staged DLL within its end of life runs
at once, and a sync runs in the background. The session thread syncs first if no usable DLL is
staged or if the staged DLL is past its end of life. If that sync fails, a staged DLL still runs and
decides its end of life itself. With no staged DLL, the start fails with the sync failure.

**A beta session falls back to stable** if the beta channel has no usable build.

**A build without an attestation never contacts the service.** It reads the DLLs that an official
install staged under the same data directory.

## Consequences

**League as administrator cannot be patched.** The refusal offers a Fix action that opens an
elevated terminal with the `reg delete` commands for the `RUNASADMIN` layers. The host keeps its
`--elevate` mode, and the manager does not use it.

**A disabled User Account Control refuses every start.** An administrator account then runs every
program elevated, so the reader turns User Account Control on.

**The check reads only compatibility layers.** League started from an elevated Riot Client passes
the check. The DLL then never attaches, and the incident hint names elevation.

**The first start needs the network.** An offline install with no staged DLL cannot patch.

**ADR-0055 no longer protects a binary that runs elevated.** The per-machine install stays, because
the host still runs from the install directory.
