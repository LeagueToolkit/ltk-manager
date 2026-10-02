# Backend (Rust) - `src-tauri/src/`

Conventions for the Rust side. Repo-wide guidance lives in the root `AGENTS.md`. This file also
governs `crates/ltk-manager-core/`, whose `AGENTS.md` points here.

## Workspace Crates

| Crate                     | Knows about                       | Depends on                  | License            |
| ------------------------- | --------------------------------- | --------------------------- | ------------------ |
| `crates/ltk-manager-core` | Manager domain logic, UI-agnostic | `ritoclient`                | `GPL-3.0-or-later` |
| `crates/ltk-manager-game` | What League's own classes mean    | core, hexshade              | `GPL-3.0-or-later` |
| `crates/hexshade`         | The game's shaders as GLSL        | `dxbc-spirv-sys`            | `GPL-3.0-or-later` |
| `crates/atlas`            | The game's UI views, for Atlas    | core, game, hexshade        | `GPL-3.0-or-later` |
| `src-tauri`               | Tauri commands, IPC, events       | core, game, hexshade, atlas | `GPL-3.0-or-later` |

`ritoclient` is an external dependency rather than a workspace member, pinned to a git rev in the
root `Cargo.toml` until it ships on crates.io. It is **Apache-2.0**, where this workspace is
GPL-3.0-or-later - not an oversight to tidy. Re-run `pnpm generate:licenses` after any dependency
is added or relicensed.

`hexshade` knows no bin, no asset and no `AppError`. It reaches the shader cache through its own
`ShaderSource` trait, which the game crate implements over `AssetLookup`, and `dxbc-spirv-sys`
is its FFI crate, named for the library it binds.

`ltk-manager-game` sits above core. Core owns the open document, the names and where an asset
lives, and the game crate owns the classes read out of them: the map, material, skin, VFX and
spell reads. Core never calls it, so nothing core holds knows what a `MapContainer` is. The VFX
template catalog stays in core, because a new object of a declared document starts from it. The
game crate reads a bin through what `bin_document` exports for that (`struct_of`, `items`,
`entries`, `struct_entries`, `optional`, `leaf`, `link`, `text`, `boolean`, `float`, `unsigned`,
`vector4` and the rest, `Namer`, `Locator`, `object_at`) and never through `ltk_meta` matches of
its own. The two exceptions read the kind itself: the VFX resolve turns every kind into its tree,
and the spell read reports a field of the wrong kind. A field or class hash is
`hashing::named("…")` wherever its name is known. A type of it that crosses IPC derives under its
own `ts` feature, which takes core's.

`atlas` sits above the game crate and holds the UI editor's backend: a view controller resolved
into its scenes and elements, the sprite manifest, the UI programs and the sheet a mod packs. It
reads a bin the same way the game crate does, and reaches the shader cache through the game
crate's `AssetChunks`.

Dependencies point one way only. `ritoclient` takes plain arguments (`Option<&Path>`) and reports
through its own `LaunchObserver` and `SessionObserver` traits - it must never learn about `Config`,
`EventSink` or `AppError`. `core/src/launcher/` is the seam that adapts between them, and
`launcher/types.rs` mirrors every launch shape that crosses IPC so an upstream rename is a compile
error there rather than a frontend union that quietly disagrees.

Read-only calls to the Riot Client return `Option`, never `Result`: every caller has a fallback,
and "the client didn't answer" is not a failure worth showing a user. Only launching, closing and
building a launcher return `LauncherError`.

## IPC

A service is an inline Tauri plugin, on `tauri-specta` (ADR-0029, ADR-0059). `services/table.rs`
names each service and its commands once, and both `build.rs` and `services/mod.rs` read it. A
command carries `#[tauri::command]` and `#[specta::specta]`, returns `IpcResult<T>`, and joins its
service's row, or the row's `debug:` list when only a debug build registers it. Every command
belongs to a service. An event payload no command reaches is named once with `.typ::<T>()` in
`ipc::builder`.

What more than one service uses lives in `services/shared/`: `off_thread`, the asset and document
reads, the `InFlight` slot and `overtaken` check, and the `Library` and `Workshop` arguments, which
stand in for the states a library or workshop command takes and which a binding leaves out.

A type that crosses IPC derives `specta::Type` under its crate's `ts` feature.
`pnpm generate:types` writes every type to `src/lib/bindings.ts`, and each service's commands to
`src/lib/ipc/<service>.ts`. `src/lib/tauri.ts`
wraps each generated command in the `api` map and re-exports the types, with the serialize half of
a phase-split type under its plain name. A test matches an invoke on `commandNames` from
`src/test/commandNames.ts`, never on a string.

## Filesystem

Filesystem calls go through `fs_err`, aliased per module as `use fs_err as fs;`. The error names
the path and the operation, where `std::fs` reports the OS text alone, and `AppError::Io` carries
that message to a user unchanged. `clippy.toml` holds the list that keeps a bare `std::fs` call,
or the `Path` method that reaches the same syscall, out.

## Tests

Unit tests live in a file of their own. A module keeps `#[cfg(test)] mod tests;` as its last item
and the suite moves next to it - `hashtables.rs` to `hashtables/tests.rs`, `problems/mod.rs` to
`problems/tests.rs`. The module is still a child, so `use super::*` reaches the private items it
always did.

What this buys is a production file that is only production code, and a suite that can grow
without burying it. Leave a test inline only where it is a few lines that read as part of the
thing they check, such as a round-trip beside the conversion it exercises.

## Patcher

`patcher/` owns patcher lifecycle (start/stop/status) and thread management with an
`Arc<AtomicBool>` stop flag. `patcher/injector.rs` spawns and supervises the external
`cslol-host.exe` injection host over a stdin/stdout line protocol (`patcher/host.rs`). The
overlay/prefix dir is sent via a `config prefix` command, **not** as an argv. The host internally
drives `cslol-inj.exe`, and with `--elevate` (auto-enabled when League runs as admin) it bridges to
a high-integrity worker via UAC.

## State

Three Tauri-managed states:

- `SettingsState` - App settings (league path, storage path, theme). Access via `State<SettingsState>`, lock with `.0.lock().clone()`.
- `PatcherState` - Patcher thread handle and stop flag. Access via `State<PatcherState>`.
- `LauncherState` - The one `LeagueLauncher`, built at startup. It holds the session watcher and
  the window hider, which outlive the command that started them, so `save_settings` calls
  `reconfigure` rather than rebuilding it.
