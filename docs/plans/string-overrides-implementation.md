# String Overrides — Implementation Plan

> Status: **implemented on feature branches** (2026-07-02): league-mod `feat/string-override-application` (pushed; Phase 2 complete incl. tests) and ltk-manager `feat/apply-string-overrides` (Phase 3 complete). Remaining: manual E2E (§7 step 3) and the release chain (§7 step 4, gated on PR #138 review).
> Closes: ltk-manager [#123](https://github.com/LeagueToolkit/ltk-manager/issues/123), league-mod [#97](https://github.com/LeagueToolkit/league-mod/issues/97).
> Depends on: league-toolkit [PR #138](https://github.com/LeagueToolkit/league-toolkit/pull/138) (`ltk_rst` API rework) — consumed as a **git dependency on the PR branch** while review is pending (head `d033293` as of 2026-07-02), so development is not blocked on the merge/publish.

## 1. Current state (verified 2026-07-02)

**Already done — do not redo:**

| Piece                                              | Where                                                                                                                                                                                                 | Status                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Editor UI (per-layer, per-locale key/value editor) | `src/routes/workshop/$projectName/strings.tsx`                                                                                                                                                        | Done; shows "not applied yet" warning (lines 176–195) |
| Save command + hook                                | `commands/workshop.rs:166` `save_layer_string_overrides`, `useSaveStringOverrides.ts`                                                                                                                 | Done                                                  |
| Project persistence                                | `ltk_mod_project 0.4.1` — `ModProjectLayer.string_overrides: HashMap<locale, HashMap<field, value>>` in `mod.config.json`                                                                             | Done                                                  |
| Ship in `.modpkg`                                  | `ltk_modpkg 0.5.0` — `ModpkgLayerMetadata.string_overrides` (msgpack metadata, schema v2); `ProjectPacker::build_layer_metadata` copies them on pack                                                  | Done                                                  |
| Ship in `.fantome`                                 | `ltk_fantome 0.5.1` — `FantomeLayerInfo.string_overrides` (`META/info.json` → `"StringOverrides"`), writer emits them                                                                                 | Done                                                  |
| Workshop import round-trip                         | `workshop/projects.rs` — both fantome (lines ~304–327) and modpkg (~418–420) importers preserve overrides                                                                                             | Done                                                  |
| Overlay stage plumbing                             | `ltk_overlay::OverlayStage::ApplyingStringOverrides` exists (never emitted); ltk-manager maps it to local `OverlayStage::Strings` (`overlay/mod.rs:107`); frontend maps it in `useOverlayProgress.ts` | Plumbed, dormant                                      |

**Missing — the actual work:**

1. No RST reader/writer in the dependency tree (`ltk_rst` not referenced anywhere).
2. `ltk_overlay 0.3.1` never applies overrides: `collect`/`patch` pipeline ignores `ModProject.layers[].string_overrides` entirely.
3. **Bug:** `ltk_overlay::FantomeContent::mod_project()` (`fantome_content.rs:189–222`) builds `default_layers()` and _discards_ fantome `StringOverrides` — fantome mods lose overrides at build time even though the archive carries them.
4. No locale detection (nothing reads `LeagueClientSettings.yaml`; no YAML crate in `Cargo.lock`).
5. No settings toggle for "apply to all locales".

**Key facts for implementation:**

- Game locale: `C:\Riot Games\League of Legends\Config\LeagueClientSettings.yaml` → `install.globals.locale` (e.g. `"en_US"`). The Config dir is a sibling of `Game/` under the League root.
- Target file: chunk `data/menu/{locale_lower}/lol.stringtable` inside `Game/DATA/FINAL/Localized/Global.{locale}.wad.client` (one WAD per installed locale; verified `Global.en_US.wad.client` on this machine).
- `ltk_rst` (post-#138 API): `Stringtable::from_reader` (defaults = latest format: V5, 38-bit hash/offset split, XXH3 — correct for the live game), `insert_str(key, value)` (lowercases + hashes + masks the key), `insert(hash, value)` (masks a full 64-bit hash), `to_writer` (deterministic, sorted, deduped output). No manual hashing needed.
- CDragon key-name list (for optional UI autocomplete): `https://github.com/CommunityDragon/Data/blob/master/hashes/lol/hashes.rst.xxh3.txt` — ~7 MB, lines of `<16-hex full xxh3> <key_name>`.
- Locale keys in the data model are lowercase (`en_us`, `ko_kr`, …) plus `"default"`; the YAML value is `en_US` — normalize to lowercase when matching, but match WAD filenames case-insensitively.

## 2. Design decisions

**D1 — Application lives in `ltk_overlay`, not ltk-manager.** The overlay builder already owns game-WAD indexing, chunk conflict resolution, parallel patching, and incremental state. ltk-manager only supplies configuration (which locales to patch). This also satisfies league-mod #97 so the CLI benefits too.

**D2 — Two-track dependency strategy** (never local path deps):

- _Development (now):_ consume `ltk_rst` straight from the PR branch as a git dependency in `ltk_overlay`; consume the in-progress `ltk_overlay` in ltk-manager the same way (git dep on the league-mod feature branch). Cargo.lock pins the exact revs; update deliberately with `cargo update -p ltk_rst` / `-p ltk_overlay` when the branches move.
- _Release:_ crates.io rejects git dependencies, so publishing still happens in order — merge PR #138 → publish `ltk_rst 0.2.0` → swap `ltk_overlay`'s git dep for the version → publish `ltk_overlay 0.4.0` → swap ltk-manager's git dep for the version. Git deps are a feature-branch-only state; nothing merges to a `main` with a git dep in it.

The YAML dep (`serde_yaml_ng`) goes only into ltk-manager.

**D3 — Merge/priority semantics** (must mirror chunk-conflict ordering so string conflicts and file conflicts resolve identically):

- Iterate enabled mods in the same order the builder uses for chunk overrides; later/higher-priority wins ("last write wins").
- Within a mod, iterate enabled layers ascending by layer priority.
- Within a layer, apply the `"default"` locale bucket first, then the locale-specific bucket — so locale-specific beats `"default"` _within the same layer_, but a higher-priority mod's `"default"` still beats a lower-priority mod's locale-specific entry (mod priority dominates).

**D4 — Base-table selection.** If an enabled mod ships a literal `lol.stringtable` chunk override for the target WAD, parse the _winning_ mod-provided chunk as the base instead of the game's copy, then apply key-level overrides on top. Otherwise extract + decompress the game's chunk.

**D5 — Locale targeting.** `ltk_overlay` gets a mode enum; ltk-manager computes it from settings + YAML:

- Toggle OFF (default): patch only the detected current locale.
- Toggle ON: patch every installed locale (every `Global.*.wad.client` in `Localized/`).
- Only build a localized WAD when its effective override map is non-empty (or when mods contribute regular chunk overrides to it, as today).

**D6 — Raw-hash key escape hatch (recommended, small).** Accept keys of the form `{hex}` (1–16 hex digits, e.g. `{f772a83b33773223}`) as pre-computed hashes via `Stringtable::insert`, for entries whose plaintext key is unknown. Document in the strings editor.

## 3. Phase 1 — league-toolkit: consume the PR ref now, publish later

Repo: `LeagueToolkit/league-toolkit`, branch `rst-api-rework` (PR #138, open, awaiting review — head `d033293b1bf5e7108615bf00830d49da238c64b5` as of 2026-07-02).

**Interim (unblocks Phase 2 immediately):** depend on the PR branch directly —

```toml
ltk_rst = { git = "https://github.com/LeagueToolkit/league-toolkit.git", branch = "rst-api-rework" }
```

Cargo.lock pins the exact rev; if review pushes new commits (or force-pushes), refresh deliberately with `cargo update -p ltk_rst` and re-run the string tests. Watch the PR for API changes requested in review — anything touching `Stringtable`/`RstFormat` surface ripples into `ltk_overlay/src/strings.rs`.

**Release gate (parallel, not blocking development):**

1. Get PR #138 reviewed and merged (assignee: Crauzer; reviewers DexalGT / alanpq).
2. Bump `crates/ltk_rst/Cargo.toml` version `0.1.0` → `0.2.0` (the PR is a breaking rework of the already-published 0.1.0; the in-branch manifest still says 0.1.0).
3. Publish `ltk_rst 0.2.0` to crates.io, then swap the git dep for the version (see D2).

No code work needed here beyond the release — the API already covers everything this feature needs (read, keyed insert, hash insert, deterministic write, format handling incl. V2 font-config preservation and 40/39/38-bit splits).

## 4. Phase 2 — league-mod: string application engine in `ltk_overlay`

Repo: `X:\dev\league-mod` (sync with origin first — local shows `ltk_overlay 0.3.0`, crates.io is at 0.3.1). Target version: **`ltk_overlay 0.4.0`**.

### 4.1 New module `crates/ltk_overlay/src/strings.rs`

```rust
/// Which locales string overrides are applied to.
pub enum StringOverrideMode {
    /// Skip string patching entirely.
    Disabled,
    /// Patch only these locales (normalized lowercase, e.g. "en_us").
    Locales(Vec<String>),
    /// Patch every locale found in Game/DATA/FINAL/Localized.
    AllInstalled,
}

/// locale -> field key -> value, merged across mods/layers per D3.
pub(crate) fn collect_effective_overrides(
    mods: &mut [EnabledMod],
    target_locales: &[String],
) -> Result<HashMap<String, HashMap<String, String>>>;

/// Parse `original` with ltk_rst, apply `overrides` (incl. `{hex}` raw-hash
/// keys per D6), serialize back. Preserves the table's read format.
pub(crate) fn patch_stringtable(
    original: &[u8],
    overrides: &HashMap<String, String>,
) -> Result<Vec<u8>>;
```

- `Cargo.toml`: add `ltk_rst` as the git dep from Phase 1 (swap to `ltk_rst = "0.2"` before publishing `ltk_overlay` — crates.io rejects git deps).
- `collect_effective_overrides` reads `content.mod_project()` (already exposed by `ModContentProvider`) for each enabled mod, filters to `enabled_layers`, and merges per D3. For each target locale L, effective map = fold over (mod, layer) of `default` bucket then `L` bucket.
- Installed-locale discovery: scan the game dir for `Localized/Global.*.wad.client` (case-insensitive), extract the locale token from the filename.

### 4.2 Builder integration (`crates/ltk_overlay/src/builder/mod.rs`)

- `OverlayBuilder::with_string_overrides(mode: StringOverrideMode)` (default `Disabled` — non-breaking for existing callers).
- In `build()`, after `collect_all_override_metadata`/`resolve_overrides_for_wads` and before `patch_wads_parallel`:
  1. Emit `OverlayStage::ApplyingStringOverrides` (the reserved variant — first real emission; ltk-manager already maps it).
  2. Resolve target locales from the mode; compute effective override maps.
  3. For each locale with a non-empty map:
     - Resolve the game WAD `Global.{locale}.wad.client` via `GameIndex` (verify the index includes the `Localized/` subtree; it should — it lives under `DATA/FINAL`). Missing WAD → `tracing::warn!` and skip.
     - Compute the chunk hash for `data/menu/{locale}/lol.stringtable` (existing path-hash helpers, xxh64-lowercase — do _not_ reuse modpkg's xxh3 helpers).
     - Base bytes per D4 (winning mod chunk override if present, else mount game WAD and decompress the chunk).
     - `patch_stringtable(...)` → register the result as a synthetic override for that WAD/chunk so `partition_wads_from_meta` marks the WAD for building and `build_patched_wad` compresses it like any other override.
  4. Ensure a WAD whose _only_ contribution is string overrides still enters the build partition (today a mod with no file content contributes nothing, so the localized WAD would never be scheduled).

### 4.3 Incremental-rebuild correctness

- Fold into the localized WAD's fingerprint: a stable hash of its effective override map + the mode/locale list. Toggling the all-locales setting, changing the client locale, or editing any override must rebuild exactly the affected localized WADs (and removing all overrides must drop the WAD from the overlay).
- Bump the overlay state schema version → one full rebuild on upgrade (ltk-manager already has force-rebuild-on-version-change from `e7ebe7b`).

### 4.4 Fix `FantomeContent::mod_project()` (`crates/ltk_overlay/src/fantome_content.rs:189–222`)

Parse `META/info.json` layers and map `FantomeLayerInfo.string_overrides` into the returned `ModProjectLayer`s instead of `default_layers()`. Without this, fantome mods never contribute overrides.

### 4.5 Tests (in `ltk_overlay`)

- `patch_stringtable` unit tests against small fixture tables (reuse/borrow the `ltk_rst` test fixtures): keyed override, raw-hash `{hex}` override, untouched entries preserved, deterministic output.
- Merge-semantics tests for D3 (mod priority beats locale specificity; layer priority; `default` vs locale bucket).
- Integration test: fixture game dir with a tiny `Localized/Global.en_us.wad.client` containing a tiny stringtable + one modpkg and one fantome mod with overrides → build → mount output WAD → assert patched values; second build with no changes → WAD reused; toggle mode → rebuild.

### 4.6 Release

Changelog, publish `ltk_overlay 0.4.0`. (No `ltk_modpkg`/`ltk_fantome`/`ltk_mod_project` changes required — their formats already carry the data. Optional upstream nicety, non-blocking: make `ltk_fantome`'s extractor round-trip `Layers` on extract; ltk-manager's own importer already does this itself.)

## 5. Phase 3 — ltk-manager integration

### 5.1 Dependencies (`src-tauri/Cargo.toml`)

- `ltk_overlay` — during development, a git dep on the league-mod feature branch carrying Phase 2 (e.g. `{ git = "https://github.com/LeagueToolkit/league-mod.git", branch = "feat/string-override-application" }`); swap to `ltk_overlay = "0.4"` once published, before merging to main.
- `serde_yaml_ng` (maintained `serde_yaml` fork; upstream `serde_yaml` is archived) — only for reading `LeagueClientSettings.yaml`.

### 5.2 Locale detection — new `src-tauri/src/utils/locale.rs`

```rust
/// Reads install.globals.locale from <league root>/Config/LeagueClientSettings.yaml,
/// where <league root> is the parent of the resolved game dir.
/// Returns the locale lowercased (e.g. "en_us").
pub fn detect_league_locale(game_dir: &Utf8Path) -> Option<String>
```

- Deserialize only the needed nesting (`install.globals.locale`) with permissive structs (`#[serde(default)]` / `Option`s) — the file has many unrelated keys and Riot may add more.
- Fallback chain: YAML missing/unparseable → scan `Localized/` for `Global.*.wad.client`; exactly one → use it; else `"en_us"` + `tracing::warn!`.
- Unit tests: fixture YAML (copy the real structure), missing file, missing key.

### 5.3 Settings toggle

- `state.rs`: add `apply_string_overrides_to_all_locales: bool` to `Settings` with `#[serde(default)]` (default `false`).
- Update the settings TS type (`src/lib/tauri.ts` / generated bindings) and the settings route UI: a `Switch` (from `@/components`), label "Apply string overrides to all installed locales", description explaining default behavior (current locale only).

### 5.4 Overlay wiring (`src-tauri/src/overlay/mod.rs`, `ensure_overlay`)

```rust
let mode = if settings.apply_string_overrides_to_all_locales {
    StringOverrideMode::AllInstalled
} else {
    StringOverrideMode::Locales(vec![
        detect_league_locale(&game_dir).unwrap_or_else(|| "en_us".into()),
    ])
};
// builder = builder.with_string_overrides(mode);
```

- The `ApplyingStringOverrides → OverlayStage::Strings` mapping already exists (`overlay/mod.rs:107`); verify the frontend label for the `Strings` stage in `useOverlayProgress.ts` reads sensibly (e.g. "Applying string overrides").

### 5.5 UI polish (`src/routes/workshop/$projectName/strings.tsx`)

- Remove the "String overrides are not applied yet" `AlertBox` (lines 176–195) and the issue-#123 link.
- Replace with a short info note documenting semantics: `default` applies to all locales; a locale-specific entry beats `default`; `{hex}` keys target raw hashes.
- Optional (small): new command `get_league_locale` (follow the 7-step CLAUDE.md command checklist) so the editor can show "Detected game locale: en_US" and pre-select that locale tab.

### 5.6 Verification pass (no expected code changes)

- `get_enabled_mods_for_overlay` (`mods/library.rs:698–769`) needs no changes — providers already expose `mod_project()`.
- Confirm `with_blocked_wads(...)` never blocks `Localized/Global.*` WADs.
- Confirm workshop pack (modpkg) and fantome export still emit overrides (they do today; regression-check after dep bumps).
- `pnpm check` + `cargo clippy -p ltk-manager`.

## 6. Phase 4 — optional follow-ups (separate PRs, not blocking)

1. **Field-name autocomplete / browse** in the strings editor: download + cache CDragon `hashes.rst.xxh3.txt` (~7 MB) in app data; `Combobox` (from `@/components`) suggesting known keys, optionally showing the current default value by reading the game stringtable via `ltk_rst` (would add a direct `ltk_rst` dep to ltk-manager).
2. **Value preview/diff**: show the original string next to the override for the detected locale.
3. Upstream `ltk_fantome` extractor round-trip of `Layers` (see 4.6).

## 7. Execution order & release checklist

Development starts immediately on git deps (D2); publishing is deferred to the end.

1. [x] league-mod: sync main; feature branch with `ltk_rst` git dep on `rst-api-rework`; implement Phase 2 (strings module, builder integration, fingerprints, fantome fix, tests). _Done: branch `feat/string-override-application`, commit `093541a`. Note: ltk-manager must take **all** league-mod crates that share types across the `ltk_overlay` API (`ltk_modpkg`, `ltk_mod_project`, `ltk_fantome`) from the same git branch — cargo treats git and crates.io copies as distinct crates._
2. [x] ltk-manager: Phase 3 on a feature branch (`feat/apply-string-overrides`) with an `ltk_overlay` git dep on the league-mod feature branch. _Done: locale detection (`utils/locale.rs`), `apply_string_overrides_to_all_locales` setting + Patching-section toggle, builder wiring (`resolve_string_override_mode`), strings.tsx info box._
3. [ ] Manual E2E on this machine (`C:\Riot Games\League of Legends`, locale `en_US`):
   - Workshop project overriding a known key (pick one from the CDragon list, e.g. a champion/item name) → enable → build overlay → launch → verify in game.
   - A `.fantome` mod with `StringOverrides` (covers the FantomeContent fix) and a packed/reimported `.modpkg`.
   - Toggle "all locales" → only localized WADs rebuild; disable mod → overlay drops the localized WAD.
4. [ ] Release chain (once PR #138 review lands): merge #138 → bump + publish `ltk_rst 0.2.0` → swap `ltk_overlay`'s git dep to the version, merge + publish `ltk_overlay 0.4.0` → swap ltk-manager's git dep to the version → merge `feat/apply-string-overrides`.
5. [ ] Close ltk-manager #123 and league-mod #97.

## 8. Risks & edge cases

- **RST format drift**: `RstFormat::LATEST` (V5/38-bit/XXH3) matches the live game; if Riot shifts again, `ltk_rst` has detection/pinning (`Stringtable::reader().detect_hash_bits()`). Patch step should log the parsed format.
- **Hash-algorithm confusion**: RST key hashing (XXH3 since 14.15, masked to 38 bits — `ltk_rst` handles it) is distinct from WAD path hashing (xxh64-lowercase) and modpkg layer/wad hashing (xxh3). Never cross the helpers. (Note: cdragon-rs's xxh64/39-bit is outdated info — trust `ltk_rst`.)
- **Locale casing**: normalize map keys to lowercase; match WAD filenames case-insensitively (`en_US` in filenames vs `en_us` in data).
- **User locale not installed / YAML absent** (PBE, region moves, custom installs): fallback chain in 5.2; never fail the build over locale detection.
- **Mods shipping whole stringtable chunks**: handled by D4; document that key-level overrides always win over a raw shipped table.
- **Large localized WADs**: only rebuilt when overrides exist or change (4.3); otherwise untouched.
- **PR #138 churn**: development tracks the unreviewed branch, so review feedback may change the `ltk_rst` API (or force-push the branch) under us. Cargo.lock pins the rev, so breakage only lands on a deliberate `cargo update -p ltk_rst`; budget for small adaptation in `strings.rs`. The merge + publish is still required before anything ships to main (D2).
