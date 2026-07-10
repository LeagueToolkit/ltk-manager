use crate::error::{AppError, AppResult, Utf8PathExt};
use crate::mods::{LinkedBinState, ModLibrary, WadReportState};
use crate::state::{Settings, WadBlocklistEntry};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{BufWriter, Read, Seek, SeekFrom, Write},
};
use tauri::{Emitter, Manager};

const SCRIPTS_WAD: &str = "scripts.wad.client";
const TFT_WAD: &str = "map22.wad.client";
#[cfg(target_os = "macos")]
const WAD_V3_SIGNATURE_OFFSET: u64 = 4;
#[cfg(target_os = "macos")]
const WAD_V3_SIGNATURE_SIZE: usize = 256;
#[cfg(target_os = "macos")]
const WAD_V3_CHECKSUM_OFFSET: u64 = 4 + 256;

// Never overlay-patch the macOS platform WADs: cross-WAD chunk distribution
// can match mod chunk hashes into Metal shader / platform-bootstrap WADs,
// corrupting them and crashing the game at the loading screen.
const MACOS_PLATFORM_WADS: &[&str] = &[
    "bootstrap.macos.wad.client",
    "shadercache.metal.wad.client",
    "shaders.wad.client",
];

#[derive(Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum OverlayStage {
    Indexing,
    Collecting,
    Patching,
    Strings,
    Complete,
}

/// Progress event emitted during overlay building.
#[derive(Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OverlayProgress {
    pub stage: OverlayStage,
    pub current_file: Option<String>,
    pub current: u32,
    pub total: u32,
}

impl ModLibrary {
    /// Ensure the overlay exists and is up-to-date for the current enabled mod set.
    ///
    /// Returns the overlay root directory (the prefix passed to the legacy patcher)
    /// and the number of mods whose property-bins reference linked dependencies that
    /// don't resolve against the overlay WADs they land in (0 when everything
    /// resolves). The offenders themselves are recorded into [`LinkedBinState`] and
    /// announced via the `linked-bins-updated` event so the library badges can refresh.
    ///
    /// Workshop project paths (if any) are loaded via `FsModContent` and prepended
    /// to the enabled mod list so they take highest priority.
    pub fn ensure_overlay(
        &self,
        settings: &Settings,
        workshop_project_paths: &[PathBuf],
        force_rebuild: bool,
    ) -> AppResult<(PathBuf, usize)> {
        let storage_dir = self.storage_dir(settings)?;

        Self::flush_overlays_if_app_version_changed(&storage_dir);

        let game_dir = crate::utils::game::resolve_game_dir(settings)?;
        let (profile_slug, enabled_mods) = self.get_enabled_mods_for_overlay(settings)?;

        let profile_dir = storage_dir.join("profiles").join(profile_slug.as_str());
        let overlay_root = profile_dir.join("overlay");

        // A manual rebuild discards this profile's cached overlay state so the
        // builder regenerates every WAD from scratch instead of reusing files.
        if force_rebuild {
            tracing::info!("Overlay: force rebuild requested, purging cached overlay state");
            Self::purge_overlay_artifacts(&profile_dir, true);
        }

        tracing::info!("Overlay: storage_dir={}", storage_dir.display());
        tracing::info!("Overlay: profile_slug={}", profile_slug);
        tracing::info!("Overlay: overlay_root={}", overlay_root.display());
        tracing::info!("Overlay: game_dir={}", game_dir.display());

        let enabled_ids = enabled_mods
            .iter()
            .map(|m| m.id.clone())
            .collect::<Vec<_>>();
        tracing::info!(
            "Overlay: enabled_mods={} ids=[{}]",
            enabled_ids.len(),
            enabled_ids.join(", ")
        );

        let utf8_game_dir = game_dir.clone().try_into_utf8("game directory")?;
        let utf8_overlay_root = overlay_root.clone().try_into_utf8("overlay root")?;
        let utf8_state_dir = profile_dir.try_into_utf8("profile directory")?;

        let available_wads = crate::utils::game::list_game_wads(&game_dir).unwrap_or_else(|e| {
            tracing::warn!(
                "Failed to enumerate game WADs for regex expansion: {}; \
                 regex blocklist entries will match nothing",
                e
            );
            Vec::new()
        });
        let blocked_wads = resolve_blocked_wads(settings, &available_wads);
        tracing::info!("Overlay: blocked_wads count={}", blocked_wads.len());

        let string_override_mode = resolve_string_override_mode(settings, &game_dir);
        tracing::info!("Overlay: string_override_mode={:?}", string_override_mode);

        Self::clean_corrupt_overlay_state(&utf8_state_dir);

        let app_handle_clone = self.app_handle().clone();
        let mut builder =
            ltk_overlay::OverlayBuilder::new(utf8_game_dir, utf8_overlay_root, utf8_state_dir)
                .with_blocked_wads(blocked_wads.clone())
                .with_string_overrides(string_override_mode)
                .with_progress(move |progress| {
                    let stage = match progress.stage {
                        ltk_overlay::OverlayStage::Indexing => OverlayStage::Indexing,
                        ltk_overlay::OverlayStage::CollectingOverrides => OverlayStage::Collecting,
                        ltk_overlay::OverlayStage::PatchingWad => OverlayStage::Patching,
                        ltk_overlay::OverlayStage::ApplyingStringOverrides => OverlayStage::Strings,
                        ltk_overlay::OverlayStage::Complete => OverlayStage::Complete,
                    };
                    let _ = app_handle_clone.emit(
                        "overlay-progress",
                        OverlayProgress {
                            stage,
                            current_file: progress.current_file,
                            current: progress.current,
                            total: progress.total,
                        },
                    );
                });

        let mut all_mods = Vec::new();
        for project_path in workshop_project_paths {
            let utf8_path = project_path
                .clone()
                .try_into_utf8("workshop project path")?;
            let dir_name = project_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let id = format!("workshop:{}", dir_name);
            tracing::info!("Adding workshop project: id={}, path={}", id, utf8_path);
            all_mods.push(ltk_overlay::EnabledMod {
                id,
                content: Box::new(ltk_overlay::FsModContent::new(utf8_path)),
                enabled_layers: None,
            });
        }
        all_mods.extend(enabled_mods);
        builder.set_enabled_mods(all_mods);

        builder
            .build()
            .map_err(|e| AppError::Other(format!("Overlay build failed: {}", e)))?;

        // The builder's own sweep_unexpected_overlay_files runs inside build()
        // and removes the blocked-WAD passthrough symlinks from the previous
        // run, so the macOS pass must come after build() to recreate them.
        #[cfg(target_os = "macos")]
        prepare_macos_overlay_wads(&overlay_root, &game_dir, &blocked_wads)?;

        let linked_bin_offenders = builder.take_linked_bin_offenders();
        let offender_count = linked_bin_offenders.len();

        // Record offenders as a byproduct of this single build (no separate
        // pre-flight). The library badges and the reachable warning dialog read
        // them via `get_linked_bin_offenders`; the event tells the frontend the
        // snapshot changed. Failure here must not fail the patch.
        if let Some(state) = self.app_handle().try_state::<LinkedBinState>() {
            if let Err(e) = state.record(linked_bin_offenders) {
                tracing::warn!("Failed to record linked-bin offenders: {}", e);
            } else {
                let _ = self.app_handle().emit("linked-bins-updated", ());
            }
        }

        // Capture per-mod WAD reports for the library badge UI. Failure to
        // persist must not fail the patch — log and continue.
        //
        // Note: `OverlayBuilder::build()` emits its own `Complete` progress event
        // *before* returning, so the frontend may see that event before the reports
        // are persisted. We emit a dedicated `wad-reports-updated` event after
        // persisting so the frontend knows the cache is ready to query.
        let reports = builder.take_mod_wad_reports();
        if !reports.is_empty() {
            if let Some(state) = self.app_handle().try_state::<WadReportState>() {
                if let Err(e) = state.record_reports(reports) {
                    tracing::warn!("Failed to persist per-mod WAD reports: {}", e);
                } else {
                    let _ = self.app_handle().emit("wad-reports-updated", ());
                }
            }
        }

        Ok((overlay_root, offender_count))
    }

    /// Force a full rebuild of the active profile's overlay.
    ///
    /// Discards the profile's cached overlay state (patched WADs, `overlay.json`,
    /// metadata and game-index caches) so the builder regenerates everything from
    /// scratch. This is the escape hatch for the case where the incremental builder
    /// would otherwise reuse a stale or incorrectly-built overlay WAD — its reuse
    /// decision keys on the mod set and content, not on the overlay's actual bytes
    /// or the builder version.
    pub fn rebuild_overlay(&self, settings: &Settings) -> AppResult<(PathBuf, usize)> {
        self.ensure_overlay(settings, &[], true)
    }

    /// Wipe every profile's cached overlay artifacts when the app version changed
    /// since the overlays were last built.
    ///
    /// The overlay builder keys its reuse/skip decisions on the mod set, mod
    /// content, game fingerprint and a state *schema* version — none of which move
    /// when the overlay-building *logic* changes between releases. So a build-logic
    /// fix would otherwise never reach users who already have an overlay on disk.
    /// Gating on the app version forces one clean rebuild after each update.
    ///
    /// Best-effort: a marker file under `storage_dir` records the version that last
    /// built overlays. Failures are logged, never fatal.
    fn flush_overlays_if_app_version_changed(storage_dir: &Path) {
        const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
        let marker = storage_dir.join(".overlay-build-version");

        let up_to_date = std::fs::read_to_string(&marker)
            .ok()
            .is_some_and(|v| v.trim() == APP_VERSION);
        if up_to_date {
            return;
        }

        let profiles_dir = storage_dir.join("profiles");
        if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    Self::purge_overlay_artifacts(&path, false);
                }
            }
        }

        let _ = std::fs::create_dir_all(storage_dir);
        match std::fs::write(&marker, APP_VERSION) {
            Ok(()) => tracing::info!(
                "Flushed cached overlays for app version {} (overlay build logic may have changed)",
                APP_VERSION
            ),
            Err(e) => tracing::warn!(
                "Failed to write overlay build-version marker {}: {}",
                marker.display(),
                e
            ),
        }
    }

    /// Remove a profile's cached overlay artifacts so the next build starts clean.
    ///
    /// Always removes the patched-WAD `overlay/` tree, the `overlay.json` state
    /// file, and the `override_meta.bin` metadata cache. The `game_index.bin` cache
    /// is only removed when `include_game_index` is set — it is expensive to rebuild
    /// and is independently validated by the game fingerprint, so the version flush
    /// keeps it and only a manual full rebuild drops it.
    fn purge_overlay_artifacts(profile_dir: &Path, include_game_index: bool) {
        let overlay_dir = profile_dir.join("overlay");
        if overlay_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&overlay_dir) {
                tracing::warn!(
                    "Failed to remove overlay directory {}: {}",
                    overlay_dir.display(),
                    e
                );
            }
        }

        let mut files = vec![
            profile_dir.join("overlay.json"),
            profile_dir.join("override_meta.bin"),
        ];
        if include_game_index {
            files.push(profile_dir.join("game_index.bin"));
        }
        for file in files {
            if file.exists() {
                if let Err(e) = std::fs::remove_file(&file) {
                    tracing::warn!(
                        "Failed to remove overlay artifact {}: {}",
                        file.display(),
                        e
                    );
                }
            }
        }
    }

    /// Scan `state_dir` for top-level JSON files that are empty or contain invalid
    /// JSON and remove them so `ltk_overlay` does not fail to parse stale/corrupt
    /// state files written by a previous run that was interrupted mid-write.
    fn clean_corrupt_overlay_state(state_dir: &camino::Utf8Path) {
        let entries = match std::fs::read_dir(state_dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let contents = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if contents.trim().is_empty()
                || serde_json::from_str::<serde_json::Value>(&contents).is_err()
            {
                tracing::warn!(
                    "Removing corrupt overlay state file before build: {}",
                    path.display()
                );
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn prepare_macos_overlay_wads(
    overlay_root: &Path,
    game_dir: &Path,
    blocked_wads: &[String],
) -> AppResult<()> {
    let passthroughs = create_blocked_wad_passthroughs(overlay_root, game_dir, blocked_wads)?;
    let data_dir = overlay_root.join("DATA");
    if !data_dir.exists() {
        return Ok(());
    }

    let mut restored = 0;
    let mut stripped = 0;
    let mut tex_repaired = 0;
    let mut repathed = 0;
    let mut reverted = 0;
    let mut repacked = 0;
    let mut repaired = 0;
    let mut locale_passthroughs = 0;
    for entry in walkdir::WalkDir::new(&data_dir).follow_links(false) {
        let entry = entry.map_err(|error| {
            AppError::Other(format!("Failed to scan macOS overlay WADs: {}", error))
        })?;
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if file_name.ends_with(".wad") || file_name.ends_with(".wad.client") {
            let source_path = game_dir.join("DATA").join(
                entry
                    .path()
                    .strip_prefix(&data_dir)
                    .map_err(|error| AppError::Other(error.to_string()))?,
            );
            // Locale WADs (`*.<xx_xx>.wad.client`) hold only routed voice-over
            // audio, and the macOS client rejects *any* rewritten locale WAD at
            // mount (ALE-18967994 Inconsistent) — even one whose chunk contents
            // are byte-for-byte vanilla. Empirically the base champion WAD
            // tolerates our repack but a locale WAD does not: the client
            // validates the locale WAD's header against a value we can't
            // reproduce (no xxh/xxh3 formula over the TOC matches Riot's
            // original), so a repacked copy always fails. A mod's VO therefore
            // cannot be served on macOS at all; symlink the overlay entry back
            // to the pristine game WAD so the original mounts. The visual mod
            // lives in the base champion WAD and is unaffected (vanilla VO).
            if is_locale_wad(&file_name) {
                if link_overlay_passthrough(entry.path(), &source_path)? {
                    locale_passthroughs += 1;
                }
                continue;
            }
            // Revert any cross-WAD overrides that clobbered a subchunk entry in
            // this WAD with a standalone (non-subchunked) chunk — the Aatrox
            // crash root cause. ltk_overlay 0.5.2's cross-WAD routing fix
            // (route_targets) only changed *which* WADs receive a chunk; its
            // writer still emits overrides as standalone entries
            // (frame_count = 0, start_frame = 0), so a subchunked TOC entry is
            // still clobbered and macOS rejects the WAD at mount
            // (ALE-18967994 Inconsistent). Always run this *before*
            // canonicalize so canonicalize sees the restored subchunk and
            // treats it correctly.
            if restore_subchunk_overrides(entry.path(), &source_path)? {
                restored += 1;
            }
            // A mod that ships its voice-over under the *base* WAD directory
            // (e.g. `WAD/Vayne.wad.client/assets/sounds/.../vo/en_us/...`) makes
            // ltk_overlay add those locale chunks to the base WAD. Their path
            // hashes collide with the untouched locale WAD, so the game finds
            // the same file in two WADs with different content and rejects the
            // locale WAD at mount (ALE-18967994 Inconsistent) — the crash even
            // a pristine locale passthrough can't cure, because the conflict
            // lives in the base WAD. Collect the sibling locale WADs' chunk
            // hashes so the sanitize pass can repath (or drop) the duplicates.
            let locale_collisions = locale_sibling_chunk_hashes(&source_path)?;
            // Sanitize mod chunks the macOS game can't ingest:
            //
            // * banks whose BKHD generator version doesn't match the exact
            //   game bank they override — Wwise refuses wrong-version banks;
            //   on Windows that only mutes the mod's audio, but on macOS the
            //   failed bank load crashes the game during the loading screen;
            // * block-compressed `.tex` textures with non-power-of-two
            //   dimensions and a mip chain. The engine's mip-offset math
            //   assumes power-of-two dimensions, so such a chain makes the
            //   loader read out of bounds — silent garbage on Windows, a
            //   fatal segfault on macOS mid champion-load (this, not its
            //   36 MB soundbank, is what crashed the silvervayne Vayne skin).
            //   Repaired by stripping the chain down to the full-res level.
            let sanitized = sanitize_mod_chunks(entry.path(), &source_path, &locale_collisions)?;
            if sanitized.repaired_textures > 0 {
                tex_repaired += 1;
            }
            if sanitized.repathed > 0 {
                repathed += 1;
            }
            if !sanitized.dropped.is_empty() {
                stripped += 1;
                // The BIN/PTCH files that the mod ships as overrides still
                // reference the just-dropped audio paths by hash. When the game
                // looks them up it gets `AudioManager: Failed to load Bank for
                // Wwise (...)` and then crashes shortly after. Revert any
                // mod-overridden BIN that points at a dropped chunk so the
                // game loads its original audio config instead.
                if revert_audio_referring_overrides(entry.path(), &source_path, &sanitized.dropped)?
                {
                    reverted += 1;
                }
            }
            if canonicalize_macos_wad(entry.path(), &source_path)? {
                repacked += 1;
            } else if repair_macos_wad_header(entry.path(), &source_path)? {
                repaired += 1;
            }
        }
    }

    tracing::info!(
        "Overlay: restored subchunks in {} WAD(s), dropped incompatible audio in {} WAD(s), repaired NPOT mipped textures in {} WAD(s), repathed locale audio in {} WAD(s), reverted dangling-audio BIN overrides in {} WAD(s), canonicalized {} macOS WAD(s), repaired headers for {} WAD(s), passed through {} locale WAD(s), linked {} blocked WAD passthrough(s)",
        restored,
        stripped,
        tex_repaired,
        repathed,
        reverted,
        repacked,
        repaired,
        locale_passthroughs,
        passthroughs
    );
    Ok(())
}

/// Whether a WAD filename is a locale variant (`*.<xx_xx>.wad.client`, e.g.
/// `vayne.en_us.wad.client`). `file_name` must already be lowercased. These
/// WADs carry only routed voice-over audio.
#[cfg(target_os = "macos")]
fn is_locale_wad(file_name: &str) -> bool {
    let Some(stem) = file_name.strip_suffix(".wad.client") else {
        return false;
    };
    let Some((_, locale)) = stem.rsplit_once('.') else {
        return false;
    };
    let bytes = locale.as_bytes();
    bytes.len() == 5
        && bytes[2] == b'_'
        && bytes[..2].iter().all(u8::is_ascii_lowercase)
        && bytes[3..].iter().all(u8::is_ascii_lowercase)
}

/// Collect the chunk path-hashes of every sibling locale WAD of a base
/// champion WAD. For `.../Champions/Vayne.wad.client` this scans the same
/// directory for `Vayne.<xx_xx>.wad.client` and unions their TOC hashes.
///
/// Used to detect a mod's voice-over that was shipped under the base WAD and
/// therefore routed into it: such chunks share a path-hash with the locale WAD
/// and make the macOS client reject the locale WAD at mount. Returns an empty
/// set for locale WADs themselves or when the WAD has no locale siblings.
#[cfg(target_os = "macos")]
fn locale_sibling_chunk_hashes(source_path: &Path) -> AppResult<HashSet<u64>> {
    let mut hashes = HashSet::new();
    let file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let Some(stem) = file_name.strip_suffix(".wad.client") else {
        return Ok(hashes);
    };
    // Only base champion WADs have locale siblings; skip locale WADs.
    if is_locale_wad(&file_name) {
        return Ok(hashes);
    }
    let Some(dir) = source_path.parent() else {
        return Ok(hashes);
    };
    let prefix = format!("{stem}.");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(hashes);
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name == file_name || !name.starts_with(&prefix) || !is_locale_wad(&name) {
            continue;
        }
        let Ok(file) = File::open(entry.path()) else {
            continue;
        };
        if let Ok(wad) = ltk_wad::Wad::mount(file) {
            hashes.extend(wad.chunks().iter().map(|c| c.path_hash));
        }
    }
    Ok(hashes)
}

/// Replace an overlay WAD with a symlink to the pristine game WAD so the game
/// mounts the original file instead of our rewritten copy. Returns `false`
/// (without touching anything) when the source is missing or the correct
/// symlink is already in place. Mirrors [`create_blocked_wad_passthroughs`].
#[cfg(target_os = "macos")]
fn link_overlay_passthrough(overlay_path: &Path, source_path: &Path) -> AppResult<bool> {
    if !source_path.exists() {
        return Ok(false);
    }
    match fs::read_link(overlay_path) {
        Ok(existing) if existing == source_path => return Ok(false),
        Ok(_) => fs::remove_file(overlay_path)?,
        Err(_) if overlay_path.exists() => fs::remove_file(overlay_path)?,
        Err(_) => {}
    }
    std::os::unix::fs::symlink(source_path, overlay_path)?;
    Ok(true)
}

/// Result of [`sanitize_mod_chunks`] for one overlay WAD.
#[cfg(target_os = "macos")]
#[derive(Default)]
struct SanitizeOutcome {
    /// Path hashes of new (not-in-source) audio entries dropped from the WAD.
    dropped: HashSet<u64>,
    /// Number of NPOT mipped textures rewritten without their mip chain.
    repaired_textures: usize,
    /// Number of locale-colliding entries re-added under a mutated path hash.
    repathed: usize,
}

/// Rewrite a block-compressed League `.tex` with non-power-of-two dimensions
/// and a mip chain so it carries only its full-resolution level, or `None`
/// when `data` isn't such a texture (wrong magic, POT dimensions, no mip
/// flag, non-BC format, or a payload too short to contain the full level).
///
/// The engine's mip-offset math assumes power-of-two dimensions; an NPOT
/// chain (e.g. 1028×1028 → 514 → 257 …) makes it read past the buffer.
/// Windows survives the out-of-bounds read by allocator luck, the macOS
/// client segfaults during champion load with nothing in `r3dlog`. Riot's
/// own textures are always POT, so only broken mod exports match.
///
/// `.tex` layout: a 12-byte header (`"TEX\0"`, u16 width, u16 height, u8
/// unused, u8 format, u8 resource type, u8 flags with bit 0 = has mip chain)
/// followed by the mip levels stored smallest-first — the full-resolution
/// level 0 is the *last* `ceil(w/4)·ceil(h/4)·block_size` bytes.
#[cfg(target_os = "macos")]
fn strip_npot_tex_mips(data: &[u8]) -> Option<Vec<u8>> {
    const TEX_HEADER_LEN: usize = 12;
    if data.len() < TEX_HEADER_LEN || &data[..4] != b"TEX\0" {
        return None;
    }
    let width = u16::from_le_bytes(data[4..6].try_into().unwrap()) as usize;
    let height = u16::from_le_bytes(data[6..8].try_into().unwrap()) as usize;
    let format = data[9];
    let flags = data[11];
    if flags & 1 == 0 || width == 0 || height == 0 {
        return None;
    }
    if width.is_power_of_two() && height.is_power_of_two() {
        return None;
    }
    let block_bytes: usize = match format {
        0x0a => 8,  // BC1 / DXT1
        0x0c => 16, // BC3 / DXT5
        _ => return None,
    };
    let level0_len = width.div_ceil(4) * height.div_ceil(4) * block_bytes;
    if data.len() < TEX_HEADER_LEN + level0_len {
        return None;
    }
    let mut fixed = Vec::with_capacity(TEX_HEADER_LEN + level0_len);
    fixed.extend_from_slice(&data[..TEX_HEADER_LEN]);
    fixed[11] &= !1;
    fixed.extend_from_slice(&data[data.len() - level0_len..]);
    Some(fixed)
}

/// Offset of the two-letter locale directory (`/xx_xx/`) inside a lowercased
/// path, pointing at the first letter after the slash.
#[cfg(target_os = "macos")]
fn locale_component_offset(lower_path: &[u8]) -> Option<usize> {
    lower_path
        .windows(7)
        .position(|w| {
            w[0] == b'/'
                && w[6] == b'/'
                && w[3] == b'_'
                && w[1].is_ascii_lowercase()
                && w[2].is_ascii_lowercase()
                && w[4].is_ascii_lowercase()
                && w[5].is_ascii_lowercase()
        })
        .map(|pos| pos + 1)
}

/// Rewrite every `.bnk`/`.wpk` path string in a PROP/PTCH `bin` whose
/// lowercase xxh64 equals `hash` so its locale directory (`/xx_xx/`) becomes
/// `/zz_zz/` (case pattern preserved, length unchanged — no PROP surgery
/// needed). Returns the mutated bin and the mutated path's hash, or `None`
/// when the bin holds no such reference.
///
/// `zz_zz` is never a real locale, so the new hash can never collide with a
/// locale WAD again, and the mutation is deterministic: every mod bin
/// referencing the same path converges on the same new hash.
#[cfg(target_os = "macos")]
fn repath_locale_reference(bin: &[u8], hash: u64) -> Option<(Vec<u8>, u64)> {
    use xxhash_rust::xxh64::xxh64;

    let mut mutated: Option<(Vec<u8>, u64)> = None;
    let mut i = 0;
    while i + 4 <= bin.len() {
        let window = &bin[i..i + 4];
        if window != b".bnk" && window != b".wpk" {
            i += 1;
            continue;
        }
        // Walk backwards over the path string. Wwise paths are URL-safe
        // ASCII: letters, digits, `/`, `.`, `_`, `-`.
        let mut start = i;
        while start > 0 {
            let c = bin[start - 1];
            let is_path_char =
                c.is_ascii_alphanumeric() || c == b'/' || c == b'.' || c == b'_' || c == b'-';
            if !is_path_char {
                break;
            }
            start -= 1;
        }
        let end = i + 4;
        i += 4;
        let path = &bin[start..end];
        if path.len() < 5 || xxh64(&path.to_ascii_lowercase(), 0) != hash {
            continue;
        }
        let Some(locale_at) = locale_component_offset(&path.to_ascii_lowercase()) else {
            continue;
        };
        let (out, _) = mutated.get_or_insert_with(|| (bin.to_vec(), 0));
        for offset in [0_usize, 1, 3, 4] {
            let byte = &mut out[start + locale_at + offset];
            *byte = if byte.is_ascii_uppercase() {
                b'Z'
            } else {
                b'z'
            };
        }
        let new_hash = xxh64(&out[start..end].to_ascii_lowercase(), 0);
        mutated.as_mut().expect("just inserted").1 = new_hash;
    }
    mutated
}

/// Decompressed leading bytes of a chunk, or `None` for compression schemes
/// we don't inspect (subchunked entries are never audio).
#[cfg(target_os = "macos")]
fn load_inspectable_chunk(
    wad: &mut ltk_wad::Wad<File>,
    chunk: &ltk_wad::WadChunk,
) -> Option<Box<[u8]>> {
    use ltk_wad::WadChunkCompression;

    match chunk.compression_type {
        WadChunkCompression::None => wad.load_chunk_raw(chunk).ok(),
        WadChunkCompression::Zstd => wad.load_chunk_decompressed(chunk).ok(),
        _ => None,
    }
}

/// Remove or repair mod chunk entries the macOS game can't ingest:
///
/// * new (not-in-source) chunks whose path hash appears in `locale_collisions`
///   — a mod's voice-over shipped under the base WAD directory and routed into
///   it, colliding with the pristine locale WAD. The macOS client rejects the
///   locale WAD at mount over the conflicting duplicate. When a mod bin
///   references the chunk by path, both are REPATHED (locale directory →
///   `zz_zz`, [`repath_locale_reference`]) so the collision disappears and the
///   mod's voice-over still plays; unreferenced chunks are dropped;
/// * block-compressed `.tex` entries with NPOT dimensions and a mip chain are
///   rewritten without the chain ([`strip_npot_tex_mips`]) — the chain makes
///   the loader read out of bounds, which segfaults the macOS client during
///   champion load.
///
/// Returns the dropped path hashes (for [`revert_audio_referring_overrides`])
/// and the number of reverted overrides / repaired textures.
///
/// Locale WADs never reach here — they are passed through to the pristine game
/// file in [`prepare_macos_overlay_wads`], because the macOS client rejects
/// any rewritten locale WAD at mount regardless of content.
#[cfg(target_os = "macos")]
fn sanitize_mod_chunks(
    path: &Path,
    source_path: &Path,
    locale_collisions: &HashSet<u64>,
) -> AppResult<SanitizeOutcome> {
    use byteorder::{WriteBytesExt as _, LE};
    use ltk_wad::{WadChunk, WadChunkCompression};
    use xxhash_rust::xxh3::xxh3_64;

    let mut overlay_wad = ltk_wad::Wad::mount(File::open(path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read overlay WAD {}: {}",
            path.display(),
            error
        ))
    })?;
    let overlay_chunks = overlay_wad.chunks().clone();

    let source_wad = if source_path.exists() {
        Some(
            ltk_wad::Wad::mount(File::open(source_path)?).map_err(|error| {
                AppError::Other(format!(
                    "Failed to read source WAD {}: {}",
                    source_path.display(),
                    error
                ))
            })?,
        )
    } else {
        None
    };
    let source_chunks = source_wad.as_ref().map(|wad| wad.chunks().clone());

    let mut drop_hashes: HashSet<u64> = HashSet::new();
    let mut replace: HashMap<u64, Vec<u8>> = HashMap::new();
    let mut collisions: Vec<u64> = Vec::new();
    let mut bins: Vec<(u64, Box<[u8]>)> = Vec::new();
    let mut repaired_textures = 0;
    for chunk in &overlay_chunks {
        let source_chunk = source_chunks
            .as_ref()
            .and_then(|chunks| chunks.get(chunk.path_hash))
            .copied();
        if let Some(source_chunk) = &source_chunk {
            if source_chunk.checksum == chunk.checksum {
                continue; // Pass-through chunk, untouched by mods.
            }
        }

        // A brand-new chunk that also lives in a sibling locale WAD is the
        // mod's voice-over misrouted into the base WAD. It is not part of the
        // vanilla base WAD (source_chunk is None) and its duplicate in the
        // untouched locale WAD makes the client reject that locale WAD at
        // mount. Collect it; the pass below tries to save it under a mutated
        // path before falling back to dropping it.
        if source_chunk.is_none() && locale_collisions.contains(&chunk.path_hash) {
            collisions.push(chunk.path_hash);
            continue;
        }

        let Some(data) = load_inspectable_chunk(&mut overlay_wad, chunk) else {
            continue;
        };

        // Remember mod-provided bins: the locale-collision repair pass below
        // scans them for the strings that reference the colliding chunks.
        if data.starts_with(b"PROP") || data.starts_with(b"PTCH") {
            bins.push((chunk.path_hash, data));
            continue;
        }

        if let Some(fixed) = strip_npot_tex_mips(&data) {
            tracing::info!(
                "Overlay: stripping mip chain from NPOT texture {:016x} ({} -> {} bytes) in {}",
                chunk.path_hash,
                data.len(),
                fixed.len(),
                path.display()
            );
            replace.insert(chunk.path_hash, fixed);
            repaired_textures += 1;
            continue;
        }

        // Mod banks are never version- or size-checked: the macOS client
        // loads banks of any BKHD generation (the game itself ships mixed
        // v134/v145 banks) and any size (a 36 MB mod bank loads fine, verified
        // in-game). Both were early theories for the Vayne/Aatrox load crash
        // and both were wrong — the real cause was an NPOT mipped texture,
        // handled above. Reverting a bank only silences the mod's audio.
    }

    // Save each misrouted locale chunk instead of dropping it when possible:
    // rewrite the bin string that references it so its locale directory reads
    // `zz_zz` (same length, never a real locale) and re-add the chunk under
    // the mutated path's hash. The base WAD then carries the voice-over at a
    // path no locale WAD contains — no cross-WAD duplicate, the locale WAD
    // mounts, and the mod's VO plays (verified in-game with silvervayne).
    // A chunk no bin references can't be repathed; dropping it is harmless
    // because nothing looks it up.
    let mut rehash: HashMap<u64, u64> = HashMap::new();
    if !collisions.is_empty() {
        let mut taken: HashSet<u64> = overlay_chunks.iter().map(|c| c.path_hash).collect();
        if let Some(chunks) = &source_chunks {
            taken.extend(chunks.iter().map(|c| c.path_hash));
        }
        taken.extend(locale_collisions.iter().copied());
        for old_hash in collisions {
            let new_hash = bins.iter().find_map(|(bin_hash, data)| {
                let current = replace
                    .get(bin_hash)
                    .map(Vec::as_slice)
                    .unwrap_or(data.as_ref());
                repath_locale_reference(current, old_hash).map(|(_, new_hash)| new_hash)
            });
            match new_hash {
                Some(new_hash) if !taken.contains(&new_hash) => {
                    for (bin_hash, data) in &bins {
                        let current = replace
                            .get(bin_hash)
                            .map(Vec::as_slice)
                            .unwrap_or(data.as_ref());
                        if let Some((mutated, _)) = repath_locale_reference(current, old_hash) {
                            replace.insert(*bin_hash, mutated);
                        }
                    }
                    tracing::info!(
                        "Overlay: repathing misrouted locale chunk {:016x} -> {:016x} in {} (collides with a locale WAD)",
                        old_hash,
                        new_hash,
                        path.display()
                    );
                    taken.insert(new_hash);
                    rehash.insert(old_hash, new_hash);
                }
                _ => {
                    tracing::info!(
                        "Overlay: dropping misrouted locale chunk {:016x} from {} (collides with a locale WAD, no repathable reference)",
                        old_hash,
                        path.display()
                    );
                    drop_hashes.insert(old_hash);
                }
            }
        }
    }

    if drop_hashes.is_empty() && replace.is_empty() && rehash.is_empty() {
        return Ok(SanitizeOutcome::default());
    }

    let mut signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    let signature_source = if source_path.exists() {
        source_path
    } else {
        path
    };
    let mut source = File::open(signature_source)?;
    source.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    source.read_exact(&mut signature)?;

    let kept: Vec<&WadChunk> = overlay_chunks
        .iter()
        .filter(|chunk| !drop_hashes.contains(&chunk.path_hash))
        .collect();

    let temporary_path = path.with_extension("ltk-strip-tmp");
    let result = (|| -> AppResult<()> {
        let mut writer = BufWriter::new(File::create(&temporary_path)?);
        let version = [b'R', b'W', 3, 4];
        writer.write_all(&version)?;
        writer.write_all(&signature)?;
        writer.write_u64::<LE>(0)?;
        writer.write_u32::<LE>(kept.len() as u32)?;
        let toc_offset = writer.stream_position()?;
        writer.write_all(&vec![0_u8; kept.len() * 32])?;

        let mut final_chunks: Vec<WadChunk> = Vec::with_capacity(kept.len());
        for chunk in &kept {
            let out_hash = rehash
                .get(&chunk.path_hash)
                .copied()
                .unwrap_or(chunk.path_hash);
            let final_chunk = if let Some(replacement) = replace.get(&chunk.path_hash) {
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(replacement)?;
                WadChunk {
                    path_hash: out_hash,
                    data_offset,
                    compressed_size: replacement.len(),
                    uncompressed_size: replacement.len(),
                    compression_type: WadChunkCompression::None,
                    is_duplicated: false,
                    frame_count: 0,
                    start_frame: 0,
                    checksum: xxh3_64(replacement),
                }
            } else {
                let raw = overlay_wad.load_chunk_raw(chunk).map_err(|error| {
                    AppError::Other(format!(
                        "Failed to read overlay chunk {:016x} from {}: {}",
                        chunk.path_hash,
                        path.display(),
                        error
                    ))
                })?;
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                WadChunk {
                    path_hash: out_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    ..**chunk
                }
            };
            final_chunks.push(final_chunk);
        }

        // Repathed entries break the mount-order sort; the game binary-searches
        // the TOC, so it must stay sorted by path hash.
        final_chunks.sort_by_key(|chunk| chunk.path_hash);

        writer.seek(SeekFrom::Start(toc_offset))?;
        for chunk in &final_chunks {
            chunk.write_v3_4(&mut writer).map_err(|error| {
                AppError::Other(format!(
                    "Failed to write chunk table for {}: {}",
                    path.display(),
                    error
                ))
            })?;
        }
        writer.flush()?;
        drop(writer);
        std::fs::rename(&temporary_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result?;
    Ok(SanitizeOutcome {
        dropped: drop_hashes,
        repaired_textures,
        repathed: rehash.len(),
    })
}

/// Path hashes of the champion's skin/character *definition* bins for the WAD
/// at `path` (derived from its filename, e.g. `Vayne.wad.client` → `vayne`):
/// `data/characters/<champ>/<champ>.bin`, `.../skins/root.bin`, and
/// `.../skins/skin<N>.bin` for a generous range of slots.
///
/// These bins define the model, materials and VFX (not just audio), so
/// [`revert_audio_referring_overrides`] must never revert them — doing so
/// throws away the visual mod. A stranded audio reference inside one only
/// costs that skin its custom sound, not its appearance.
#[cfg(target_os = "macos")]
fn skin_definition_bin_hashes(path: &Path) -> HashSet<u64> {
    use xxhash_rust::xxh64::xxh64;

    let mut hashes = HashSet::new();
    let Some(champ) = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.split('.').next())
        .map(str::to_ascii_lowercase)
    else {
        return hashes;
    };
    if champ.is_empty() {
        return hashes;
    }
    let mut add = |p: String| {
        hashes.insert(xxh64(p.as_bytes(), 0));
    };
    add(format!("data/characters/{champ}/{champ}.bin"));
    add(format!("data/characters/{champ}/skins/root.bin"));
    for slot in 0..=255 {
        add(format!("data/characters/{champ}/skins/skin{slot}.bin"));
    }
    hashes
}

/// After stripping audio chunks, find any override BIN file (PROP/PTCH) whose
/// path references a stripped chunk's hash and revert it to the source. This
/// stops the game from issuing dead lookups like `Failed to load Bank for
/// Wwise (Vayne_SFX_audio.bnk)` that crash the audio engine downstream when
/// it tries to play an event from the missing bank. Returns `true` if any
/// override was reverted.
///
/// We compute `xxh64(lowercase(path), 0)` for every printable `.bnk`/`.wpk`
/// path string inside each Zstd-compressed override and compare against the
/// stripped set. That's the same hashing convention League uses internally
/// for WAD path lookups.
///
/// Skin/character *definition* bins ([`skin_definition_bin_hashes`]) are
/// exempt: they carry the model/material/VFX setup, so reverting them to
/// vanilla would erase the visual mod. They keep their (now-stranded) audio
/// reference, which merely mutes that skin's custom sound.
#[cfg(target_os = "macos")]
fn revert_audio_referring_overrides(
    path: &Path,
    source_path: &Path,
    stripped_hashes: &HashSet<u64>,
) -> AppResult<bool> {
    use byteorder::{WriteBytesExt as _, LE};
    use ltk_wad::{WadChunk, WadChunkCompression};
    use xxhash_rust::xxh64::xxh64;

    if stripped_hashes.is_empty() || !source_path.exists() {
        return Ok(false);
    }

    let protected = skin_definition_bin_hashes(path);

    let mut overlay_wad = ltk_wad::Wad::mount(File::open(path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read overlay WAD {}: {}",
            path.display(),
            error
        ))
    })?;
    let mut source_wad = ltk_wad::Wad::mount(File::open(source_path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read source WAD {}: {}",
            source_path.display(),
            error
        ))
    })?;

    let overlay_chunks = overlay_wad.chunks().clone();
    let source_chunks = source_wad.chunks().clone();

    let mut to_revert: HashMap<u64, WadChunk> = HashMap::new();
    for chunk in &overlay_chunks {
        if protected.contains(&chunk.path_hash) {
            continue; // Never revert a skin/character definition bin.
        }
        let Some(source_chunk) = source_chunks.get(chunk.path_hash) else {
            continue;
        };
        if source_chunk.checksum == chunk.checksum {
            continue; // Not an override.
        }
        if chunk.compression_type != WadChunkCompression::Zstd {
            continue; // BINs are always Zstd-compressed in practice.
        }
        let decompressed = match overlay_wad.load_chunk_decompressed(chunk) {
            Ok(data) => data,
            Err(_) => continue,
        };
        if !(decompressed.starts_with(b"PROP") || decompressed.starts_with(b"PTCH")) {
            continue; // Only inspect property-bin chunks.
        }
        if bin_references_stripped_audio(&decompressed, stripped_hashes, &xxh64) {
            to_revert.insert(chunk.path_hash, *source_chunk);
        }
    }

    if to_revert.is_empty() {
        return Ok(false);
    }

    tracing::info!(
        "Overlay: reverting {} BIN override(s) referencing stripped audio in {}",
        to_revert.len(),
        path.display()
    );

    let mut signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    let mut source = File::open(source_path)?;
    source.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    source.read_exact(&mut signature)?;

    let temporary_path = path.with_extension("ltk-bin-revert-tmp");
    let result = (|| -> AppResult<()> {
        let mut writer = BufWriter::new(File::create(&temporary_path)?);
        let version = [b'R', b'W', 3, 4];
        writer.write_all(&version)?;
        writer.write_all(&signature)?;
        writer.write_u64::<LE>(0)?;
        writer.write_u32::<LE>(overlay_chunks.len() as u32)?;
        let toc_offset = writer.stream_position()?;
        writer.write_all(&vec![0_u8; overlay_chunks.len() * 32])?;

        let mut final_chunks: Vec<WadChunk> = Vec::with_capacity(overlay_chunks.len());
        for chunk in &overlay_chunks {
            let final_chunk = if let Some(source_chunk) = to_revert.get(&chunk.path_hash) {
                let raw = source_wad.load_chunk_raw(source_chunk).map_err(|error| {
                    AppError::Other(format!(
                        "Failed to read source chunk {:016x} from {}: {}",
                        chunk.path_hash,
                        source_path.display(),
                        error
                    ))
                })?;
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    uncompressed_size: source_chunk.uncompressed_size,
                    compression_type: source_chunk.compression_type,
                    is_duplicated: false,
                    frame_count: source_chunk.frame_count,
                    start_frame: source_chunk.start_frame,
                    checksum: source_chunk.checksum,
                }
            } else {
                let raw = overlay_wad.load_chunk_raw(chunk).map_err(|error| {
                    AppError::Other(format!(
                        "Failed to read overlay chunk {:016x} from {}: {}",
                        chunk.path_hash,
                        path.display(),
                        error
                    ))
                })?;
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    ..*chunk
                }
            };
            final_chunks.push(final_chunk);
        }

        writer.seek(SeekFrom::Start(toc_offset))?;
        for chunk in &final_chunks {
            chunk.write_v3_4(&mut writer).map_err(|error| {
                AppError::Other(format!(
                    "Failed to write chunk table for {}: {}",
                    path.display(),
                    error
                ))
            })?;
        }
        writer.flush()?;
        drop(writer);
        std::fs::rename(&temporary_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result?;
    Ok(true)
}

/// Scan a decompressed PROP/PTCH BIN for `.bnk` / `.wpk` path strings; return
/// `true` as soon as one of them hashes to any entry in `stripped_hashes`.
#[cfg(target_os = "macos")]
fn bin_references_stripped_audio(
    data: &[u8],
    stripped_hashes: &HashSet<u64>,
    hash_fn: &impl Fn(&[u8], u64) -> u64,
) -> bool {
    let mut i = 0;
    while i + 4 <= data.len() {
        let window = &data[i..i + 4];
        if window == b".bnk" || window == b".wpk" {
            // Walk backwards over the path string. Wwise paths are URL-safe
            // ASCII: letters, digits, `/`, `.`, `_`, `-`.
            let mut start = i;
            while start > 0 {
                let c = data[start - 1];
                let is_path_char =
                    c.is_ascii_alphanumeric() || c == b'/' || c == b'.' || c == b'_' || c == b'-';
                if !is_path_char {
                    break;
                }
                start -= 1;
            }
            let path = &data[start..i + 4];
            if path.len() >= 5 {
                let lower: Vec<u8> = path.iter().map(|c| c.to_ascii_lowercase()).collect();
                if stripped_hashes.contains(&hash_fn(&lower, 0)) {
                    return true;
                }
            }
            i += 4;
        } else {
            i += 1;
        }
    }
    false
}

/// Walk the overlay WAD and detect entries whose original (source) WAD has
/// subchunked metadata (frame_count > 1 or start_frame > 0 on a ZstdMulti
/// chunk) that the overlay no longer carries — i.e. a cross-WAD mod override
/// landed on top of a subchunk entry. For those entries, copy the original
/// chunk bytes from `source_path` into a new overlay WAD that keeps every
/// other entry untouched. Returns `true` if anything was restored.
#[cfg(target_os = "macos")]
fn restore_subchunk_overrides(path: &Path, source_path: &Path) -> AppResult<bool> {
    use byteorder::{WriteBytesExt as _, LE};
    use ltk_wad::{WadChunk, WadChunkCompression};

    if !source_path.exists() {
        return Ok(false);
    }

    let mut overlay_wad = ltk_wad::Wad::mount(File::open(path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read overlay WAD {}: {}",
            path.display(),
            error
        ))
    })?;
    let mut source_wad = ltk_wad::Wad::mount(File::open(source_path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read source WAD {}: {}",
            source_path.display(),
            error
        ))
    })?;

    let overlay_chunks = overlay_wad.chunks().clone();
    let source_chunks = source_wad.chunks().clone();

    // Walk overlay chunks; if the source has the same path_hash and it's a
    // subchunk over there but isn't here, plan to restore.
    let mut to_restore: HashMap<u64, WadChunk> = HashMap::new();
    for chunk in &overlay_chunks {
        let Some(source_chunk) = source_chunks.get(chunk.path_hash) else {
            continue;
        };
        let source_is_subchunk = source_chunk.compression_type == WadChunkCompression::ZstdMulti
            && (source_chunk.frame_count > 1 || source_chunk.start_frame != 0);
        if !source_is_subchunk {
            continue;
        }
        let overlay_still_matches = chunk.compression_type == source_chunk.compression_type
            && chunk.frame_count == source_chunk.frame_count
            && chunk.start_frame == source_chunk.start_frame
            && chunk.uncompressed_size == source_chunk.uncompressed_size;
        if overlay_still_matches {
            continue;
        }
        to_restore.insert(chunk.path_hash, *source_chunk);
    }

    if to_restore.is_empty() {
        return Ok(false);
    }

    tracing::info!(
        "Overlay: restoring {} subchunk entry/entries in {} from {}",
        to_restore.len(),
        path.display(),
        source_path.display()
    );

    let mut signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    let mut source = File::open(source_path)?;
    source.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    source.read_exact(&mut signature)?;

    let temporary_path = path.with_extension("ltk-restore-tmp");
    let result = (|| -> AppResult<()> {
        let mut writer = BufWriter::new(File::create(&temporary_path)?);
        let version = [b'R', b'W', 3, 4];
        writer.write_all(&version)?;
        writer.write_all(&signature)?;
        writer.write_u64::<LE>(0)?;
        writer.write_u32::<LE>(overlay_chunks.len() as u32)?;
        let toc_offset = writer.stream_position()?;
        writer.write_all(&vec![0_u8; overlay_chunks.len() * 32])?;

        let mut final_chunks: Vec<WadChunk> = Vec::with_capacity(overlay_chunks.len());
        for chunk in &overlay_chunks {
            let final_chunk = if let Some(source_chunk) = to_restore.get(&chunk.path_hash) {
                // Copy bytes straight from the source WAD using the source
                // chunk's compressed_size/data_offset; rewrite the TOC entry
                // with the source's subchunk metadata.
                let raw = source_wad.load_chunk_raw(source_chunk).map_err(|error| {
                    AppError::Other(format!(
                        "Failed to read source chunk {:016x} from {}: {}",
                        chunk.path_hash,
                        source_path.display(),
                        error
                    ))
                })?;
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    uncompressed_size: source_chunk.uncompressed_size,
                    compression_type: source_chunk.compression_type,
                    is_duplicated: false,
                    frame_count: source_chunk.frame_count,
                    start_frame: source_chunk.start_frame,
                    checksum: source_chunk.checksum,
                }
            } else {
                let raw = overlay_wad.load_chunk_raw(chunk).map_err(|error| {
                    AppError::Other(format!(
                        "Failed to read overlay chunk {:016x} from {}: {}",
                        chunk.path_hash,
                        path.display(),
                        error
                    ))
                })?;
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    ..*chunk
                }
            };
            final_chunks.push(final_chunk);
        }

        writer.seek(SeekFrom::Start(toc_offset))?;
        for chunk in &final_chunks {
            chunk.write_v3_4(&mut writer).map_err(|error| {
                AppError::Other(format!(
                    "Failed to write chunk table for {}: {}",
                    path.display(),
                    error
                ))
            })?;
        }
        writer.flush()?;
        drop(writer);
        std::fs::rename(&temporary_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result?;
    Ok(true)
}

/// Symlink every blocked WAD in the overlay back to the pristine game WAD.
///
/// The injected fopen hook redirects every `.client` open into the overlay
/// prefix and only falls back when the overlay open fails — a stale patched
/// copy of a now-blocked WAD left by an earlier incremental build would still
/// be served. The symlink guarantees the original wins.
#[cfg(target_os = "macos")]
fn create_blocked_wad_passthroughs(
    overlay_root: &Path,
    game_dir: &Path,
    blocked_wads: &[String],
) -> AppResult<usize> {
    let blocked: HashSet<String> = blocked_wads
        .iter()
        .map(|wad| wad.to_ascii_lowercase())
        .collect();
    if blocked.is_empty() {
        return Ok(0);
    }

    let game_data_dir = game_dir.join("DATA");
    let overlay_data_dir = overlay_root.join("DATA");
    if !game_data_dir.exists() {
        return Ok(0);
    }

    let mut linked = 0;
    for entry in walkdir::WalkDir::new(&game_data_dir).follow_links(false) {
        let entry = entry.map_err(|error| {
            AppError::Other(format!("Failed to scan blocked macOS WADs: {}", error))
        })?;
        if !entry.file_type().is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !blocked.contains(&file_name) {
            continue;
        }

        let relative_path = entry
            .path()
            .strip_prefix(&game_data_dir)
            .map_err(|error| AppError::Other(error.to_string()))?;
        let target_path = overlay_data_dir.join(relative_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let replace = match fs::read_link(&target_path) {
            Ok(existing) => existing != entry.path(),
            Err(_) => target_path.exists(),
        };
        if replace {
            if target_path.is_dir() {
                fs::remove_dir_all(&target_path)?;
            } else {
                fs::remove_file(&target_path)?;
            }
        }
        if replace || !target_path.exists() {
            std::os::unix::fs::symlink(entry.path(), &target_path)?;
            linked += 1;
        }
    }

    Ok(linked)
}

#[cfg(target_os = "macos")]
fn canonicalize_macos_wad(path: &Path, source_path: &Path) -> AppResult<bool> {
    use byteorder::{WriteBytesExt as _, LE};
    use ltk_wad::{WadChunk, WadChunkCompression};
    use xxhash_rust::xxh3::{xxh3_64, Xxh3};

    let mut wad = ltk_wad::Wad::mount(File::open(path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read overlay WAD {}: {}",
            path.display(),
            error
        ))
    })?;
    let chunks = wad.chunks().clone();
    let mut seen_checksums = HashMap::new();
    let needs_repack = chunks.iter().any(|chunk| {
        chunk.compression_type == WadChunkCompression::ZstdMulti
            || seen_checksums
                .insert(chunk.checksum, chunk.data_offset)
                .is_some_and(|offset| offset != chunk.data_offset)
    });
    if !needs_repack {
        return Ok(false);
    }

    let mut signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    let mut source = File::open(source_path)?;
    source.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    source.read_exact(&mut signature)?;

    let temporary_path = path.with_extension("ltk-tmp");
    let result = (|| -> AppResult<()> {
        let mut writer = BufWriter::new(File::create(&temporary_path)?);
        let version = [b'R', b'W', 3, 4];
        writer.write_all(&version)?;
        writer.write_all(&signature)?;
        writer.write_u64::<LE>(0)?;
        writer.write_u32::<LE>(chunks.len() as u32)?;
        let toc_offset = writer.stream_position()?;
        writer.write_all(&vec![0_u8; chunks.len() * 32])?;

        let mut locations = HashMap::<u64, WadChunk>::new();
        let mut final_chunks = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            // A ZstdMulti chunk with frame_count > 1 or a non-zero start_frame is
            // a *subchunk* inside a shared multi-frame zstd stream — multiple TOC
            // entries point at the same compressed bytes but each reads a
            // different frame range. Decompressing and re-encoding as Zstd here
            // (the original codex path) collapses every subchunk to the data of
            // frame 0, which is exactly what crashed Aatrox/Vayne: their WADs
            // ship hundreds of these (audio, scripts, vfx). Pass these through
            // raw and let the dedup below merge identical streams while
            // preserving each entry's own subchunk metadata.
            let is_subchunked = chunk.compression_type == WadChunkCompression::ZstdMulti
                && (chunk.frame_count > 1 || chunk.start_frame != 0);
            let (raw, compression_type, uncompressed_size, frame_count, start_frame, checksum) =
                if chunk.compression_type == WadChunkCompression::ZstdMulti && !is_subchunked {
                    let decompressed = wad.load_chunk_decompressed(chunk).map_err(|error| {
                        AppError::Other(format!(
                            "Failed to decompress multi-frame chunk {:016x} in {}: {}",
                            chunk.path_hash,
                            path.display(),
                            error
                        ))
                    })?;
                    let compressed = zstd::stream::encode_all(&decompressed[..], 3)?;
                    let checksum = xxh3_64(&compressed);
                    (
                        compressed,
                        WadChunkCompression::Zstd,
                        decompressed.len(),
                        0,
                        0,
                        checksum,
                    )
                } else {
                    (
                        wad.load_chunk_raw(chunk)
                            .map_err(|error| {
                                AppError::Other(format!(
                                    "Failed to read chunk {:016x} in {}: {}",
                                    chunk.path_hash,
                                    path.display(),
                                    error
                                ))
                            })?
                            .into_vec(),
                        chunk.compression_type,
                        chunk.uncompressed_size,
                        chunk.frame_count,
                        chunk.start_frame,
                        chunk.checksum,
                    )
                };

            let final_chunk = if let Some(existing) = locations.get(&checksum) {
                // Share the same on-disk bytes with an earlier entry, but keep
                // *this* chunk's subchunk metadata (frame_count, start_frame,
                // uncompressed_size). Without this, subchunks all collapse to
                // the first entry's frame and the game reads the wrong slice.
                WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset: existing.data_offset,
                    compressed_size: existing.compressed_size,
                    uncompressed_size,
                    compression_type,
                    is_duplicated: false,
                    frame_count,
                    start_frame,
                    checksum: existing.checksum,
                }
            } else {
                let data_offset = writer.stream_position()? as usize;
                writer.write_all(&raw)?;
                let final_chunk = WadChunk {
                    path_hash: chunk.path_hash,
                    data_offset,
                    compressed_size: raw.len(),
                    uncompressed_size,
                    compression_type,
                    is_duplicated: false,
                    frame_count,
                    start_frame,
                    checksum,
                };
                locations.insert(checksum, final_chunk);
                final_chunk
            };
            final_chunks.push(final_chunk);
        }

        writer.seek(SeekFrom::Start(toc_offset))?;
        for chunk in &final_chunks {
            chunk.write_v3_4(&mut writer).map_err(|error| {
                AppError::Other(format!(
                    "Failed to write chunk table for {}: {}",
                    path.display(),
                    error
                ))
            })?;
        }

        let mut hasher = Xxh3::new();
        hasher.update(&version);
        for chunk in &final_chunks {
            hasher.update(&chunk.path_hash.to_le_bytes());
            hasher.update(&chunk.checksum.to_le_bytes());
        }
        writer.seek(SeekFrom::Start(WAD_V3_CHECKSUM_OFFSET))?;
        writer.write_u64::<LE>(hasher.digest())?;
        writer.flush()?;
        drop(writer);
        std::fs::rename(&temporary_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result?;
    Ok(true)
}

/// Rewrite a WAD v3 header so macOS mount validation accepts it: copy the
/// 256-byte signature block from the original game WAD and recompute the
/// TOC checksum (xxh3 over the version bytes plus each chunk's
/// path_hash/checksum pair). `ltk_overlay`'s writer copies the *original*
/// WAD's checksum verbatim, which no longer matches the patched TOC; the
/// strip/revert/restore rewrites above leave a zero placeholder. This is the
/// terminal fixup that makes the header consistent.
#[cfg(target_os = "macos")]
fn repair_macos_wad_header(path: &Path, source_path: &Path) -> AppResult<bool> {
    use byteorder::{ReadBytesExt as _, WriteBytesExt as _, LE};
    use xxhash_rust::xxh3::Xxh3;

    let mut version = [0_u8; 4];
    File::open(path)?.read_exact(&mut version)?;
    if version[0..2] != [b'R', b'W'] || version[2] != 3 {
        return Ok(false);
    }

    let wad = ltk_wad::Wad::mount(File::open(path)?).map_err(|error| {
        AppError::Other(format!(
            "Failed to read overlay WAD {}: {}",
            path.display(),
            error
        ))
    })?;
    let mut hasher = Xxh3::new();
    hasher.update(&version);
    for chunk in wad.chunks() {
        hasher.update(&chunk.path_hash.to_le_bytes());
        hasher.update(&chunk.checksum.to_le_bytes());
    }
    let checksum = hasher.digest();

    let mut signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    let mut source = File::open(source_path)?;
    source.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    source.read_exact(&mut signature)?;

    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    file.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
    let mut current_signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
    file.read_exact(&mut current_signature)?;
    file.seek(SeekFrom::Start(WAD_V3_CHECKSUM_OFFSET))?;
    let current_checksum = file.read_u64::<LE>()?;
    if current_signature == signature && current_checksum == checksum {
        return Ok(false);
    }

    if current_signature != signature {
        file.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))?;
        file.write_all(&signature)?;
    }
    file.seek(SeekFrom::Start(WAD_V3_CHECKSUM_OFFSET))?;
    file.write_u64::<LE>(checksum)?;
    Ok(true)
}

/// Resolve which locales mods' string overrides should be applied to.
///
/// With the "all locales" setting on, every installed locale is patched.
/// Otherwise only the locale the League client is configured to use — read
/// from `LeagueClientSettings.yaml`, falling back to the sole installed locale
/// and finally to `en_us` so string overrides still apply on unusual installs.
pub(crate) fn resolve_string_override_mode(
    settings: &Settings,
    game_dir: &Path,
) -> ltk_overlay::StringOverrideMode {
    if settings.apply_string_overrides_to_all_locales {
        return ltk_overlay::StringOverrideMode::AllInstalled;
    }

    let locale = crate::utils::locale::detect_league_locale(game_dir).unwrap_or_else(|| {
        tracing::warn!("Falling back to 'en_us' for string overrides");
        "en_us".to_string()
    });
    ltk_overlay::StringOverrideMode::Locales(vec![locale])
}

/// Resolve the user's blocklist settings into a concrete, deduped list of WAD
/// filenames to hand to `ltk_overlay::OverlayBuilder::with_blocked_wads`.
///
/// - `Exact` entries are lowercased and passed through as-is.
/// - `Regex` entries are compiled case-insensitively and expanded against
///   `available_wads`; invalid patterns are logged and skipped so one bad entry
///   can't break the whole patch.
/// - `block_scripts_wad` and `!patch_tft` add their respective WADs.
///
/// `available_wads` should come from `crate::utils::game::list_game_wads`; pass an empty slice if
/// enumeration failed (regex entries then match nothing).
pub(crate) fn resolve_blocked_wads(settings: &Settings, available_wads: &[String]) -> Vec<String> {
    let mut blocked: Vec<String> = Vec::new();

    for entry in &settings.wad_blocklist {
        match entry {
            WadBlocklistEntry::Exact { value } => {
                blocked.push(value.to_lowercase());
            }
            WadBlocklistEntry::Regex { value } => {
                match regex::Regex::new(&format!("(?i){}", value)) {
                    Ok(re) => {
                        for wad in available_wads {
                            if re.is_match(wad) {
                                blocked.push(wad.clone());
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Invalid regex in wad_blocklist {:?}: {}", value, e);
                    }
                }
            }
        }
    }

    if settings.block_scripts_wad {
        blocked.push(SCRIPTS_WAD.to_string());
    }
    if !settings.patch_tft {
        blocked.push(TFT_WAD.to_string());
    }

    // Runtime check (not cfg) so the function stays testable cross-platform.
    if cfg!(target_os = "macos") {
        for wad in MACOS_PLATFORM_WADS {
            blocked.push(wad.to_string());
        }
    }

    blocked.sort();
    blocked.dedup();
    blocked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_blocked_wads_exact_lowercased_and_scripts_added_by_default() {
        let settings = Settings {
            wad_blocklist: vec![WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string(),
            }],
            ..Settings::default()
        };
        let result = resolve_blocked_wads(&settings, &[]);
        assert!(result.contains(&"aatrox.wad.client".to_string()));
        assert!(result.contains(&"scripts.wad.client".to_string()));
        assert!(result.contains(&"map22.wad.client".to_string()));
    }

    #[test]
    fn resolve_blocked_wads_regex_expanded_against_available() {
        let settings = Settings {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![WadBlocklistEntry::Regex {
                value: r"^map\d+\.en_us\.wad\.client$".to_string(),
            }],
            ..Settings::default()
        };
        let available = vec![
            "map11.en_us.wad.client".to_string(),
            "map12.wad.client".to_string(),
            "map22.en_us.wad.client".to_string(),
            "aatrox.wad.client".to_string(),
        ];
        let result = resolve_blocked_wads(&settings, &available);
        assert!(result.contains(&"map11.en_us.wad.client".to_string()));
        assert!(result.contains(&"map22.en_us.wad.client".to_string()));
        assert!(!result.contains(&"map12.wad.client".to_string()));
        assert!(!result.contains(&"aatrox.wad.client".to_string()));
    }

    #[test]
    fn resolve_blocked_wads_invalid_regex_skipped_and_others_kept() {
        let settings = Settings {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Regex {
                    value: "[bad(".to_string(),
                },
                WadBlocklistEntry::Exact {
                    value: "keeper.wad.client".to_string(),
                },
            ],
            ..Settings::default()
        };
        let result = resolve_blocked_wads(&settings, &[]);
        assert!(result.contains(&"keeper.wad.client".to_string()));
    }

    #[test]
    fn resolve_blocked_wads_dedupes_overlapping_entries() {
        let settings = Settings {
            block_scripts_wad: true,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Exact {
                    value: "Scripts.wad.client".to_string(),
                },
                WadBlocklistEntry::Regex {
                    value: "^scripts".to_string(),
                },
            ],
            ..Settings::default()
        };
        let available = vec!["scripts.wad.client".to_string()];
        let result = resolve_blocked_wads(&settings, &available);
        assert!(result.contains(&"scripts.wad.client".to_string()));
        let scripts_count = result.iter().filter(|w| *w == "scripts.wad.client").count();
        assert_eq!(scripts_count, 1);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolve_blocked_wads_includes_macos_platform_wads() {
        let settings = Settings {
            block_scripts_wad: false,
            patch_tft: true,
            ..Settings::default()
        };
        let result = resolve_blocked_wads(&settings, &[]);
        assert!(result.contains(&"bootstrap.macos.wad.client".to_string()));
        assert!(result.contains(&"shadercache.metal.wad.client".to_string()));
        assert!(result.contains(&"shaders.wad.client".to_string()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_wad_header_matches_reference_algorithm() {
        use byteorder::{ReadBytesExt as _, LE};
        use ltk_wad::{WadBuilder, WadChunkBuilder};
        use std::io::Write;

        let temp = tempfile::tempdir().unwrap();
        let wad_path = temp.path().join("Vayne.wad.client");
        let source_path = temp.path().join("Vayne.original.wad.client");
        let builder = WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(20))
            .with_chunk(WadChunkBuilder::default().with_hash(10));
        let mut output = File::create(&wad_path).unwrap();
        builder
            .build_to_writer(&mut output, |path_hash, cursor| {
                cursor.write_all(&path_hash.to_le_bytes())?;
                Ok(())
            })
            .unwrap();
        drop(output);

        std::fs::copy(&wad_path, &source_path).unwrap();
        let expected_signature = [0xA5_u8; WAD_V3_SIGNATURE_SIZE];
        let mut source = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&source_path)
            .unwrap();
        source
            .seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET))
            .unwrap();
        source.write_all(&expected_signature).unwrap();

        assert!(repair_macos_wad_header(&wad_path, &source_path).unwrap());
        assert!(!repair_macos_wad_header(&wad_path, &source_path).unwrap());

        let wad = ltk_wad::Wad::mount(File::open(&wad_path).unwrap()).unwrap();
        let mut checksum_input = vec![b'R', b'W', 3, 4];
        for chunk in wad.chunks() {
            checksum_input.extend_from_slice(&chunk.path_hash.to_le_bytes());
            checksum_input.extend_from_slice(&chunk.checksum.to_le_bytes());
        }
        let expected = xxhash_rust::xxh3::xxh3_64(&checksum_input);

        let mut file = File::open(&wad_path).unwrap();
        file.seek(SeekFrom::Start(WAD_V3_SIGNATURE_OFFSET)).unwrap();
        let mut actual_signature = [0_u8; WAD_V3_SIGNATURE_SIZE];
        file.read_exact(&mut actual_signature).unwrap();
        assert_eq!(actual_signature, expected_signature);
        file.seek(SeekFrom::Start(WAD_V3_CHECKSUM_OFFSET)).unwrap();
        assert_eq!(file.read_u64::<LE>().unwrap(), expected);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_wad_canonicalization_converts_multiframe_and_deduplicates() {
        use ltk_wad::{WadBuilder, WadChunkBuilder, WadChunkCompression};
        use std::io::Write;

        let temp = tempfile::tempdir().unwrap();
        let wad_path = temp.path().join("Aatrox.wad.client");
        let source_path = temp.path().join("Aatrox.original.wad.client");
        let builder = WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(10))
            .with_chunk(WadChunkBuilder::default().with_hash(20));
        let mut output = File::create(&wad_path).unwrap();
        builder
            .build_to_writer(&mut output, |_path_hash, cursor| {
                cursor.write_all(b"shared chunk data")?;
                Ok(())
            })
            .unwrap();
        drop(output);
        std::fs::copy(&wad_path, &source_path).unwrap();

        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&wad_path)
            .unwrap();
        for index in 0..2 {
            file.seek(SeekFrom::Start(272 + index * 32 + 20)).unwrap();
            file.write_all(&[0x14]).unwrap();
        }
        drop(file);

        assert!(canonicalize_macos_wad(&wad_path, &source_path).unwrap());
        assert!(!canonicalize_macos_wad(&wad_path, &source_path).unwrap());

        let wad = ltk_wad::Wad::mount(File::open(&wad_path).unwrap()).unwrap();
        let chunks = wad.chunks().as_slice();
        assert_eq!(chunks.len(), 2);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.compression_type == WadChunkCompression::Zstd));
        assert_eq!(chunks[0].data_offset, chunks[1].data_offset);
        assert_eq!(chunks[0].checksum, chunks[1].checksum);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sanitize_drops_new_chunks_that_collide_with_a_locale_wad() {
        use ltk_wad::{WadBuilder, WadChunkBuilder};
        use std::io::Write;

        // Base WAD chunk hashes: one real (in source) and one the mod added
        // that also lives in the sibling locale WAD (misrouted VO).
        const REAL: u64 = 10;
        const MISROUTED_VO: u64 = 0xf95d9c644e994f74;

        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("game");
        let overlay_dir = temp.path().join("overlay");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&overlay_dir).unwrap();
        let source_path = source_dir.join("Vayne.wad.client");
        let wad_path = overlay_dir.join("Vayne.wad.client");

        // Source base WAD has only the real chunk.
        let mut output = File::create(&source_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .build_to_writer(&mut output, |_h, c| {
                c.write_all(b"real base chunk")?;
                Ok(())
            })
            .unwrap();
        drop(output);

        // Overlay base WAD gained the misrouted VO chunk.
        let mut output = File::create(&wad_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .with_chunk(WadChunkBuilder::default().with_hash(MISROUTED_VO))
            .build_to_writer(&mut output, |h, c| {
                match h {
                    MISROUTED_VO => c.write_all(b"mod voice-over bytes")?,
                    _ => c.write_all(b"real base chunk")?,
                }
                Ok(())
            })
            .unwrap();
        drop(output);

        let collisions = HashSet::from([MISROUTED_VO]);
        let outcome = sanitize_mod_chunks(&wad_path, &source_path, &collisions).unwrap();
        assert_eq!(outcome.dropped, HashSet::from([MISROUTED_VO]));
        assert_eq!(outcome.repathed, 0);

        let wad = ltk_wad::Wad::mount(File::open(&wad_path).unwrap()).unwrap();
        assert!(!wad.chunks().contains(MISROUTED_VO));
        assert!(wad.chunks().contains(REAL));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn repath_locale_reference_mutates_every_matching_path() {
        use xxhash_rust::xxh64::xxh64;

        let path = b"ASSETS/Sounds/Wwise2016/VO/en_US/Characters/Vayne/Skins/Base/Vayne_Base_VO_events.bnk";
        let other =
            b"ASSETS/Sounds/Wwise2016/VO/en_US/Characters/Vayne/Skins/Base/Vayne_Base_VO_audio.wpk";
        let hash = xxh64(&path.to_ascii_lowercase(), 0);

        // Bin with the target path twice and an unrelated VO path once.
        let mut bin = b"PROP\x00\x00".to_vec();
        bin.extend_from_slice(path);
        bin.extend_from_slice(b"\x00\x01");
        bin.extend_from_slice(other);
        bin.extend_from_slice(b"\x00\x02");
        bin.extend_from_slice(path);
        bin.push(0);

        let (mutated, new_hash) = repath_locale_reference(&bin, hash).unwrap();
        assert_eq!(mutated.len(), bin.len());
        let expected = b"ASSETS/Sounds/Wwise2016/VO/zz_ZZ/Characters/Vayne/Skins/Base/Vayne_Base_VO_events.bnk";
        assert_eq!(new_hash, xxh64(&expected.to_ascii_lowercase(), 0));
        // Both occurrences mutated, the unrelated path untouched.
        assert_eq!(count_occurrences(&mutated, expected), 2);
        assert_eq!(count_occurrences(&mutated, other), 1);
        assert_eq!(count_occurrences(&mutated, path), 0);

        // A bin without the reference yields nothing.
        assert!(repath_locale_reference(b"PROP no audio here", hash).is_none());
        // A referenced path without a locale directory yields nothing.
        let no_locale = b"ASSETS/Sounds/Wwise2016/SFX/Vayne_Base_SFX_events.bnk";
        let mut bin = b"PROP\x00".to_vec();
        bin.extend_from_slice(no_locale);
        bin.push(0);
        assert!(repath_locale_reference(&bin, xxh64(&no_locale.to_ascii_lowercase(), 0)).is_none());
    }

    #[cfg(target_os = "macos")]
    fn count_occurrences(haystack: &[u8], needle: &[u8]) -> usize {
        haystack
            .windows(needle.len())
            .filter(|w| *w == needle)
            .count()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sanitize_repathes_locale_collisions_referenced_by_bins() {
        use ltk_wad::{WadBuilder, WadChunkBuilder, WadChunkCompression};
        use std::io::Write;
        use xxhash_rust::xxh64::xxh64;

        const REAL: u64 = 10;
        const BIN: u64 = 30;
        let vo_path =
            b"ASSETS/Sounds/Wwise2016/VO/en_US/Characters/Vayne/Skins/Base/Vayne_Base_VO_events.bnk";
        let misrouted_vo = xxh64(&vo_path.to_ascii_lowercase(), 0);
        let expected_path =
            b"ASSETS/Sounds/Wwise2016/VO/zz_ZZ/Characters/Vayne/Skins/Base/Vayne_Base_VO_events.bnk";
        let expected_hash = xxh64(&expected_path.to_ascii_lowercase(), 0);

        let mut bin = b"PROP\x00\x00\x00\x00".to_vec();
        bin.extend_from_slice(vo_path);
        bin.push(0);

        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("game");
        let overlay_dir = temp.path().join("overlay");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&overlay_dir).unwrap();
        let source_path = source_dir.join("Vayne.wad.client");
        let wad_path = overlay_dir.join("Vayne.wad.client");

        let mut output = File::create(&source_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .build_to_writer(&mut output, |_h, c| {
                c.write_all(b"real base chunk")?;
                Ok(())
            })
            .unwrap();
        drop(output);

        // Overlay gained the misrouted VO chunk and a mod bin referencing it.
        let mut output = File::create(&wad_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .with_chunk(
                WadChunkBuilder::default()
                    .with_hash(misrouted_vo)
                    .with_force_compression(WadChunkCompression::None),
            )
            .with_chunk(
                WadChunkBuilder::default()
                    .with_hash(BIN)
                    .with_force_compression(WadChunkCompression::None),
            )
            .build_to_writer(&mut output, |h, c| {
                if h == misrouted_vo {
                    c.write_all(b"mod voice-over bytes")?;
                } else if h == BIN {
                    c.write_all(&bin)?;
                } else {
                    c.write_all(b"real base chunk")?;
                }
                Ok(())
            })
            .unwrap();
        drop(output);

        let collisions = HashSet::from([misrouted_vo]);
        let outcome = sanitize_mod_chunks(&wad_path, &source_path, &collisions).unwrap();
        assert!(outcome.dropped.is_empty());
        assert_eq!(outcome.repathed, 1);

        // The VO chunk now lives under the mutated hash with the same bytes,
        // and the bin references the mutated path.
        let mut wad = ltk_wad::Wad::mount(File::open(&wad_path).unwrap()).unwrap();
        let chunks = wad.chunks().clone();
        assert!(!chunks.contains(misrouted_vo));
        let moved = *chunks.get(expected_hash).unwrap();
        assert_eq!(
            &*wad.load_chunk_raw(&moved).unwrap(),
            b"mod voice-over bytes"
        );
        let rewritten_bin = *chunks.get(BIN).unwrap();
        let bin_data = wad.load_chunk_raw(&rewritten_bin).unwrap();
        assert_eq!(count_occurrences(&bin_data, expected_path), 1);
        assert_eq!(count_occurrences(&bin_data, vo_path), 0);

        // A second pass is a no-op: the mutated path no longer collides.
        let outcome = sanitize_mod_chunks(&wad_path, &source_path, &collisions).unwrap();
        assert_eq!(outcome.repathed, 0);
        assert!(outcome.dropped.is_empty());
    }

    /// Synthetic `.tex`: 12-byte header + mip levels stored smallest-first
    /// (level 0 last), each level filled with `level + 1` bytes so the test
    /// can tell which level survived.
    #[cfg(target_os = "macos")]
    fn synthetic_tex(width: u16, height: u16, format: u8, mips: bool) -> Vec<u8> {
        let block_bytes: usize = if format == 0x0a { 8 } else { 16 };
        let mut data = b"TEX\0".to_vec();
        data.extend_from_slice(&width.to_le_bytes());
        data.extend_from_slice(&height.to_le_bytes());
        data.extend_from_slice(&[1, format, 0, u8::from(mips)]);
        let levels = if mips {
            usize::BITS as usize - (width.max(height) as usize).leading_zeros() as usize
        } else {
            1
        };
        for level in (0..levels).rev() {
            let w = ((width as usize) >> level).max(1);
            let h = ((height as usize) >> level).max(1);
            let len = w.div_ceil(4) * h.div_ceil(4) * block_bytes;
            data.extend(std::iter::repeat_n(level as u8 + 1, len));
        }
        data
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn strip_npot_tex_mips_keeps_trailing_level0_and_clears_flag() {
        // 40x24 BC1 with mips: NPOT, so the chain must be stripped. Level 0
        // is the last 10*6*8 bytes, filled with 0x01 by `synthetic_tex`.
        let tex = synthetic_tex(40, 24, 0x0a, true);
        let fixed = strip_npot_tex_mips(&tex).unwrap();
        let level0_len = 10 * 6 * 8;
        assert_eq!(fixed.len(), 12 + level0_len);
        assert_eq!(&fixed[..4], b"TEX\0");
        assert_eq!(fixed[11] & 1, 0);
        assert!(fixed[12..].iter().all(|&b| b == 1));

        // POT with mips, NPOT without mips, and non-BC formats are left alone.
        assert!(strip_npot_tex_mips(&synthetic_tex(64, 64, 0x0c, true)).is_none());
        assert!(strip_npot_tex_mips(&synthetic_tex(40, 24, 0x0a, false)).is_none());
        assert!(strip_npot_tex_mips(&synthetic_tex(40, 24, 0x14, true)).is_none());
        // A payload shorter than its own level 0 is left alone.
        assert!(strip_npot_tex_mips(&tex[..40]).is_none());
        // Non-texture data is left alone.
        assert!(strip_npot_tex_mips(b"PROP\x00\x00\x00\x00blah").is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sanitize_strips_mips_from_npot_textures() {
        use ltk_wad::{WadBuilder, WadChunkBuilder, WadChunkCompression};
        use std::io::Write;

        const REAL: u64 = 10;
        const NPOT_TEXTURE: u64 = 20;

        // 1028x1028 BC3 with a mip chain — the exact shape that crashed the
        // macOS client during champion load (silvervayne's W_Ring_2.tex).
        let bad_tex = synthetic_tex(1028, 1028, 0x0c, true);

        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("game");
        let overlay_dir = temp.path().join("overlay");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&overlay_dir).unwrap();
        let source_path = source_dir.join("Vayne.wad.client");
        let wad_path = overlay_dir.join("Vayne.wad.client");

        // Source has only the real chunk (the NPOT texture is mod-new).
        let mut out = File::create(&source_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .build_to_writer(&mut out, |_h, c| {
                c.write_all(b"real")?;
                Ok(())
            })
            .unwrap();
        drop(out);

        let mut out = File::create(&wad_path).unwrap();
        WadBuilder::default()
            .with_chunk(WadChunkBuilder::default().with_hash(REAL))
            .with_chunk(
                WadChunkBuilder::default()
                    .with_hash(NPOT_TEXTURE)
                    .with_force_compression(WadChunkCompression::None),
            )
            .build_to_writer(&mut out, |h, c| {
                match h {
                    NPOT_TEXTURE => c.write_all(&bad_tex)?,
                    _ => c.write_all(b"real")?,
                }
                Ok(())
            })
            .unwrap();
        drop(out);

        let outcome = sanitize_mod_chunks(&wad_path, &source_path, &HashSet::new()).unwrap();
        assert!(outcome.dropped.is_empty());
        assert_eq!(outcome.repaired_textures, 1);

        // The texture is still present but now carries only level 0.
        let mut wad = ltk_wad::Wad::mount(File::open(&wad_path).unwrap()).unwrap();
        assert!(wad.chunks().contains(NPOT_TEXTURE));
        let fixed_chunk = *wad.chunks().get(NPOT_TEXTURE).unwrap();
        let fixed = wad.load_chunk_raw(&fixed_chunk).unwrap();
        assert_eq!(fixed.len(), 12 + 257 * 257 * 16);
        assert_eq!(fixed[11] & 1, 0);
        assert!(fixed[12..].iter().all(|&b| b == 1));

        // A second pass is a no-op.
        let outcome = sanitize_mod_chunks(&wad_path, &source_path, &HashSet::new()).unwrap();
        assert_eq!(outcome.repaired_textures, 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn locale_sibling_chunk_hashes_unions_locale_wads_only() {
        use ltk_wad::{WadBuilder, WadChunkBuilder};
        use std::io::Write;

        const LOCALE_CHUNK: u64 = 0xabcdef;
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let write_wad = |name: &str, hash: u64| {
            let mut f = File::create(dir.join(name)).unwrap();
            WadBuilder::default()
                .with_chunk(WadChunkBuilder::default().with_hash(hash))
                .build_to_writer(&mut f, |_h, c| {
                    c.write_all(b"data")?;
                    Ok(())
                })
                .unwrap();
        };
        write_wad("Vayne.wad.client", 1);
        write_wad("Vayne.en_US.wad.client", LOCALE_CHUNK);
        write_wad("Vayne.ko_KR.wad.client", 0x123456);
        write_wad("Vaystone.wad.client", 999); // different champion, must be ignored

        let hashes = locale_sibling_chunk_hashes(&dir.join("Vayne.wad.client")).unwrap();
        assert!(hashes.contains(&LOCALE_CHUNK));
        assert!(hashes.contains(&0x123456));
        assert!(!hashes.contains(&999));
        assert!(!hashes.contains(&1));

        // A locale WAD has no siblings of its own.
        assert!(
            locale_sibling_chunk_hashes(&dir.join("Vayne.en_US.wad.client"))
                .unwrap()
                .is_empty()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn skin_definition_bins_are_protected_from_audio_revert() {
        use xxhash_rust::xxh64::xxh64;
        let h = skin_definition_bin_hashes(std::path::Path::new(
            "/game/DATA/FINAL/Champions/Vayne.wad.client",
        ));
        // The champion root, skin slots, and skins/root bins are protected.
        assert!(h.contains(&xxh64(b"data/characters/vayne/vayne.bin", 0)));
        assert!(h.contains(&xxh64(b"data/characters/vayne/skins/skin0.bin", 0)));
        assert!(h.contains(&xxh64(b"data/characters/vayne/skins/skin8.bin", 0)));
        assert!(h.contains(&xxh64(b"data/characters/vayne/skins/root.bin", 0)));
        // An audio bank-unit bin at the WAD root is NOT protected.
        assert!(!h.contains(&xxh64(b"data/vayne_skins_skin0_skins_skin1.bin", 0)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn link_overlay_passthrough_replaces_rewritten_copy_with_symlink() {
        // Separate dirs — a case-insensitive filesystem (default on macOS)
        // would alias two paths differing only in case.
        let temp = tempfile::tempdir().unwrap();
        let source_dir = temp.path().join("game");
        let overlay_dir = temp.path().join("overlay");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&overlay_dir).unwrap();
        let source_path = source_dir.join("Vayne.en_US.wad.client");
        let overlay_path = overlay_dir.join("Vayne.en_US.wad.client");
        std::fs::write(&source_path, b"PRISTINE GAME WAD").unwrap();
        std::fs::write(&overlay_path, b"rewritten overlay copy").unwrap();

        assert!(link_overlay_passthrough(&overlay_path, &source_path).unwrap());
        assert_eq!(std::fs::read_link(&overlay_path).unwrap(), source_path);
        assert_eq!(std::fs::read(&overlay_path).unwrap(), b"PRISTINE GAME WAD");

        // Idempotent: the correct symlink is already in place.
        assert!(!link_overlay_passthrough(&overlay_path, &source_path).unwrap());

        // Missing source is a no-op rather than an error.
        let absent = source_dir.join("Missing.en_US.wad.client");
        let other = overlay_dir.join("Missing.en_US.wad.client");
        std::fs::write(&other, b"x").unwrap();
        assert!(!link_overlay_passthrough(&other, &absent).unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn is_locale_wad_matches_only_locale_variants() {
        assert!(is_locale_wad("vayne.en_us.wad.client"));
        assert!(is_locale_wad("map11.ko_kr.wad.client"));
        assert!(!is_locale_wad("vayne.wad.client"));
        assert!(!is_locale_wad("global.wad.client"));
        assert!(!is_locale_wad("vayne.en_us.wad"));
    }

    #[test]
    fn overlay_stage_serialization() {
        assert_eq!(
            serde_json::to_string(&OverlayStage::Indexing).unwrap(),
            "\"indexing\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Collecting).unwrap(),
            "\"collecting\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Patching).unwrap(),
            "\"patching\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Strings).unwrap(),
            "\"strings\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Complete).unwrap(),
            "\"complete\""
        );
    }

    #[test]
    fn overlay_progress_serialization() {
        let progress = OverlayProgress {
            stage: OverlayStage::Patching,
            current_file: Some("test.wad.client".to_string()),
            current: 5,
            total: 10,
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["stage"], "patching");
        assert_eq!(json["currentFile"], "test.wad.client");
        assert_eq!(json["current"], 5);
        assert_eq!(json["total"], 10);
    }
}
