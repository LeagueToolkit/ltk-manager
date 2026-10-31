# Backend (Rust) - `src-tauri/src/`

Conventions for the Rust side. Repo-wide guidance lives in the root `AGENTS.md`. This file also
governs the `crates/ltk-manager-*` crates, whose `AGENTS.md` files point here.

## Workspace Crates

| Crate                         | Knows about                                             | Depends on                  | License             |
| ----------------------------- | ------------------------------------------------------- | --------------------------- | ------------------- |
| `crates/ltk-manager-base`     | Settings, `AppError`, events and shared helpers         | none of the workspace       | `GPL-3.0-or-later`  |
| `crates/ltk-manager-runtime`  | The patcher host, the launcher and the diagnostics      | base, `ritoclient`          | `GPL-3.0-or-later`  |
| `crates/ltk-manager-assets`   | Game archives, hash tables and asset previews           | base                        | `GPL-3.0-or-later`  |
| `crates/ltk-manager-audio`    | Wwise banks, the sound lookup and WEM decoding          | base, assets                | `GPL-3.0-or-later`  |
| `crates/ltk-manager-workshop` | A mod project on disk                                   | base, assets                | `GPL-3.0-or-later`  |
| `crates/ltk-manager-bin`      | Bin documents, the object index and the meta schema     | base, assets, workshop      | `GPL-3.0-or-later`  |
| `crates/ltk-manager-problems` | The Problems rules and their repairs                    | base, assets, audio, workshop, bin | `GPL-3.0-or-later`  |
| `crates/ltk-manager-library`  | The mod library and the overlay built from it           | problems and what it takes  | `GPL-3.0-or-later`  |
| `crates/ltk-manager-core`     | A patching session, install links and the release feeds | library, runtime            | `GPL-3.0-or-later`  |
| `crates/ltk-manager-runeforge` | The RuneForge API client and the token store          | base                        | `GPL-3.0-or-later`  |
| `crates/ltk-manager-game`     | What League's own classes mean                          | bin, assets, base, hexshade | `GPL-3.0-or-later`  |
| `crates/hexshade`             | The game's shaders as GLSL                              | `dxbc-spirv-sys`            | `GPL-3.0-or-later`  |
| `crates/atlas`                | The game's UI views, for Atlas                          | game, bin, assets, hexshade | `GPL-3.0-or-later`  |
| `src-tauri`                   | Tauri commands, IPC, events                             | every crate above           | `GPL-3.0-or-later`  |

Dependencies point down this table and never up. A type two crates share lives in the lower one:
`AppError`, `BackendEvent` and every event payload are in base, so no crate names another to
report a failure or announce a change. A domain error stays in its own crate and converts to
`AppError::Domain`, which holds it without naming its type, and the shell reads it back with
`AppError::domain`.

A fixture another crate's tests need is behind the owning crate's `test-util` feature, which
that crate's `dev-dependencies` turn on. `ltk-manager-assets` holds the archive and bin builders
in `test_util`.

`ritoclient` is an external dependency rather than a workspace member, pinned to a git rev in the
root `Cargo.toml` until it ships on crates.io. It is **Apache-2.0**, where this workspace is
GPL-3.0-or-later - not an oversight to tidy. Re-run `pnpm generate:licenses` after any dependency
is added or relicensed.

`hexshade` knows no bin, no asset and no `AppError`. It reaches the shader cache through its own
`ShaderSource` trait, which the game crate implements over `AssetLookup`, and `dxbc-spirv-sys`
is its FFI crate, named for the library it binds.

`ltk-manager-game` sits above the bin crate. The bin crate owns the open document and the names,
the assets crate where an asset lives, and the game crate the classes read out of them: the map,
material, skin, VFX and spell reads. Neither calls it, so nothing they hold knows what a
`MapContainer` is. The VFX template catalog stays in the bin crate, because a new object of a
declared document starts from it. The game crate reads a bin through what `bin_document` exports
for that (`struct_of`, `items`,
`entries`, `struct_entries`, `optional`, `leaf`, `link`, `text`, `boolean`, `float`, `unsigned`,
`vector4` and the rest, `Namer`, `Locator`, `object_at`) and never through `ltk_meta` matches of
its own. The two exceptions read the kind itself: the VFX resolve turns every kind into its tree,
and the spell read reports a field of the wrong kind. A field or class hash is
`hashing::named("…")` wherever its name is known. A type of it that crosses IPC derives under its
own `ts` feature, which takes that of the crates below it.

`atlas` sits above the game crate and holds the UI editor's backend: a view controller resolved
into its scenes and elements, the sprite manifest, the UI programs and the sheet a mod packs. It
reads a bin the same way the game crate does, and reaches the shader cache through the game
crate's `AssetChunks`.

Dependencies point one way only. `ritoclient` takes plain arguments (`Option<&Path>`) and reports
through its own `LaunchObserver` and `SessionObserver` traits - it must never learn about `Config`,
`EventSink` or `AppError`. `ltk-manager-runtime/src/launcher/` is the seam that adapts between
them. `launcher/types.rs` and the launch payloads in base's `events` mirror every launch shape that
crosses IPC, so an upstream rename is a compile error there rather than a frontend union that
quietly disagrees.

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

A command that shows, hides, focuses or minimizes a window is `async`. Tauri runs a sync plugin
command on the main thread while it holds the plugin store's lock, and the window event the call
raises waits for that same lock, so the app hangs.

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
and the suite moves next to it - `hashtables.rs` to `hashtables/tests.rs`, a crate's `lib.rs` to
`tests.rs`. The module is still a child, so `use super::*` reaches the private items it
always did.

What this buys is a production file that is only production code, and a suite that can grow
without burying it. Leave a test inline only where it is a few lines that read as part of the
thing they check, such as a round-trip beside the conversion it exercises.

## Patcher

`ltk-manager-runtime/src/patcher/` owns the patcher lifecycle (start/stop/status) and its state,
and `ltk-manager-core/src/patching/` the session thread with its `Arc<AtomicBool>` stop flag,
because the thread builds the overlay from the library. `patcher/injector.rs` spawns and
supervises the external `cslol-host.exe` injection host over a stdin/stdout line protocol
(`patcher/host.rs`). The overlay/prefix dir is sent via a `config prefix` command, **not** as an
argv. The host internally drives `cslol-inj.exe`. A session runs the delivered DLL in an unelevated
host, and the start is refused if League or the manager runs as administrator (ADR-0074).

## State

Three Tauri-managed states:

- `SettingsState` - App settings (league path, storage path, theme). Access via `State<SettingsState>`, lock with `.0.lock().clone()`.
- `PatcherState` - Patcher thread handle and stop flag. Access via `State<PatcherState>`.
- `LauncherState` - The one `LeagueLauncher`, built at startup. It holds the session watcher and
  the window hider, which outlive the command that started them, so `save_settings` calls
  `reconfigure` rather than rebuilding it.
