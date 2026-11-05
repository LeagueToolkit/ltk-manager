//! The overlay build itself, with nothing else attached.
//!
//! Everything the build needs arrives in [`OverlayBuildInputs`] and everything
//! it learns leaves in [`OverlayBuildOutcome`]. Nothing here reads settings,
//! touches the library index, or announces anything — the caller resolved the
//! inputs and the caller decides what to do with the results. That is what lets
//! a CLI reuse this: it can supply its own mod list and print the offenders
//! instead of persisting them for a badge UI.

use camino::Utf8PathBuf;
use ltk_manager_base::error::AppResult;
use ltk_manager_base::events::{OverlayProgress, OverlayStage};
use ltk_overlay::game_data::GameDataDiagnostic;

/// Everything a build needs, resolved by the caller.
pub struct OverlayBuildInputs {
    /// The `Game/` directory holding the WADs to patch.
    pub game_dir: Utf8PathBuf,
    /// Where patched WADs are written — the prefix the patcher is pointed at.
    pub overlay_root: Utf8PathBuf,
    /// Where the builder keeps its caches (`overlay.json`, `game_index.bin`, …).
    pub state_dir: Utf8PathBuf,
    /// WAD filenames to leave untouched, already expanded and deduped.
    pub blocked_wads: Vec<String>,
    /// Which locales string overrides apply to.
    pub string_override_mode: ltk_overlay::StringOverrideMode,
    /// The class schema of the installed patch, which types game-data property edits.
    pub game_data_schema: Box<dyn ltk_game_data::Schema + Send + Sync>,
    /// Mods to apply, in ascending priority order.
    pub mods: Vec<ltk_overlay::EnabledMod>,
}

/// What a build found, for the caller to persist or report as it sees fit.
pub struct OverlayBuildOutcome {
    /// Per-mod WAD footprints, a byproduct of the same pass.
    pub mod_wad_reports: Vec<ltk_overlay::ModWadReport>,
    /// Chunks whose container claimed a checksum its own bytes do not have.
    ///
    /// Advisory, never fatal: the overlay carries the recomputed value, so the
    /// content reaches the game intact. Upstream ADR-0001.
    pub checksum_mismatches: Vec<ltk_overlay::ChecksumMismatch>,
    /// What the enabled mods' game-data declarations reported, cached builds included.
    ///
    /// Advisory, never fatal: an edit that does not apply leaves its target as the base has it.
    pub game_data_diagnostics: Vec<GameDataDiagnostic>,
}

/// Build the overlay described by `inputs`, reporting progress through `progress`.
///
/// `progress` is invoked once per file during patching, so it must be cheap.
/// `called_off` is polled between the build's stages.
///
/// # Errors
///
/// [`AppError::Overlay`](ltk_manager_base::error::AppError::Overlay) holding
/// [`ltk_overlay::Error::CalledOff`] where `called_off` answers `true`, and the
/// builder's own failures otherwise.
pub fn build_overlay(
    inputs: OverlayBuildInputs,
    progress: impl Fn(OverlayProgress) + Send + Sync + 'static,
    called_off: impl Fn() -> bool + Send + Sync + 'static,
) -> AppResult<OverlayBuildOutcome> {
    let OverlayBuildInputs {
        game_dir,
        overlay_root,
        state_dir,
        blocked_wads,
        string_override_mode,
        game_data_schema,
        mods,
    } = inputs;

    let mut builder = ltk_overlay::OverlayBuilder::new(game_dir, overlay_root, state_dir)
        .with_blocked_wads(blocked_wads)
        .with_string_overrides(string_override_mode)
        .with_game_data_schema(game_data_schema)
        .with_called_off(called_off)
        .with_progress(move |p| {
            if let Some(p) = translate_progress(p) {
                progress(p);
            }
        });

    builder.set_enabled_mods(mods);

    let result = builder.build()?;

    Ok(OverlayBuildOutcome {
        mod_wad_reports: builder.take_mod_wad_reports(),
        checksum_mismatches: result.checksum_mismatches,
        game_data_diagnostics: result.game_data_diagnostics,
    })
}

/// Map the builder's progress into the shape the frontend listens for.
///
/// A stage the manager does not know is not forwarded, and the frontend keeps the last one.
fn translate_progress(progress: ltk_overlay::OverlayProgress) -> Option<OverlayProgress> {
    let stage = match progress.stage {
        ltk_overlay::OverlayStage::Indexing | ltk_overlay::OverlayStage::IndexingObjects => {
            OverlayStage::Indexing
        }
        ltk_overlay::OverlayStage::CollectingOverrides => OverlayStage::Collecting,
        ltk_overlay::OverlayStage::PatchingWad => OverlayStage::Patching,
        ltk_overlay::OverlayStage::ApplyingStringOverrides => OverlayStage::Strings,
        ltk_overlay::OverlayStage::Complete => OverlayStage::Complete,
        _ => return None,
    };
    Some(OverlayProgress {
        stage,
        current_file: progress.current_file,
        current: progress.current,
        total: progress.total,
        step: None,
    })
}
