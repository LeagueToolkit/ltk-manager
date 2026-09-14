# ltk-patcher-macos

The macOS injection host for LTK Manager. It builds the `ltk_patcher_host`
binary the manager spawns on macOS, in place of the Windows
`ltk_patcher_host.exe` + `ltk_patcher_dll.dll` pair.

It speaks the exact same stdin/stdout line protocol as the Windows host (see
`ltk-manager-core::patcher::host::protocol`), so the injector, session, and
event machinery in `ltk-manager-core` drive it unchanged.

## How it works

Windows injects a DLL that hooks the game from the inside. macOS has no such
DLL; instead this host patches the game process's memory directly:

1. Find the running `LeagueofLegends` process and open its task port
   (`task_for_pid`, which needs root — see elevation below).
2. Parse the game's on-disk Mach-O to locate `__text`, the `wad_verify` call
   site, and the lazy-bound `fopen` import and its `__stubs` entry.
3. Overwrite `wad_verify` with a "return true" prologue so modded WADs pass the
   signature check, and redirect the `fopen` import stub through a small
   shellcode trampoline that rewrites any `*.wad.client` path to sit under the
   overlay prefix.

### Elevation

`task_for_pid` on another process requires root. Rather than run the whole
manager elevated, the host re-launches itself as root once — through a single
`osascript … with administrator privileges` prompt — and relays the protocol to
that root worker over a private Unix socket (`--elevate` → relay, `--worker` →
root worker). Because the manager keeps the host alive across patching sessions,
the password is asked once per app run. If the manager is already root, the
spawned host inherits root and skips the prompt.

### Not supported on macOS

The Windows DLL also runs an anti-skinhack ("AH v1") WAD scan. That logic lives
only in the DLL, so the `OPT_OUT_AH_V1` / `FULL_WAD_SCAN` hook flags have no
effect here; the host reports this rather than silently ignoring them.

## Attribution

The Mach-O reader, the `wad_verify` / `fopen` patch, and the trampoline
shellcode are ported from LeagueToolkit's
[`cslol-manager`](https://github.com/LeagueToolkit/cslol-manager)
(`cslol-tools/lib/lol/patcher/patcher_macos_{arm64,amd64}.cpp`,
`utility/macho.hpp`, `utility/process_macos.cpp`), which is licensed under
GPL-3.0. This crate is likewise GPL-3.0-or-later. The shellcode assembly under
`shellcode/` is taken verbatim from those sources.

## Building

```bash
pnpm build:mac-host          # release, staged into src-tauri/resources/
bash scripts/build-macos-host.sh --debug
```

The script builds a universal binary when both `aarch64-apple-darwin` and
`x86_64-apple-darwin` Rust targets are installed, and stages it at
`src-tauri/resources/ltk_patcher_host` for both `tauri dev` and `tauri build`.
