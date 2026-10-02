//! The handler each service answers through, and the bindings `tauri-specta` generates out of
//! every service's types and the event payloads (ADR-0029, ADR-0059).

use std::collections::BTreeMap;

use tauri::ipc::Invoke;
use tauri::Wry;
use tauri_specta::Builder;

/// The builder the shared bindings are generated from.
#[cfg(test)]
fn builder() -> Builder<Wry> {
    use ltk_manager_core::diagnostics::incident::Incident;
    use ltk_manager_core::events::{
        ExportProgress, ExtractProgress, FantomeImportProgress, GitImportProgress,
        HashtableSyncProgress, HealthSweepProgress, InstallProgress, LayoutMigrationProgress,
        MigrationProgress, ModRepairProgress, ModStorageProgress, OverlayProgress,
    };
    use ltk_manager_core::launcher::{
        LaunchProgress, SessionChanged, SessionEnded, SessionGameRunning, SessionStarted,
    };
    use ltk_manager_core::mods::LayoutMigrationReport;
    use ltk_manager_core::object_index::ReferenceWalkProgress;
    use ltk_manager_core::workshop::LayerFilesChanged;

    use crate::patcher::thread::{
        GameAttachedPayload, GameOverlayPayload, LinkedBinWarningPayload, WadScanFailedPayload,
    };
    use ltk_manager_core::deep_link::{
        DeepLinkInstallRequest, DeepLinkSettingsRequest, ProtocolInstallProgress,
    };

    /* A 64-bit integer crosses as a JS number. None reaches the range where that loses
    a digit, and `JSON.stringify` refuses a `bigint`. */
    Builder::<Wry>::new()
        .types(&crate::services::types())
        // Event payloads, which no command signature reaches.
        .typ::<ExportProgress>()
        .typ::<ExtractProgress>()
        .typ::<FantomeImportProgress>()
        .typ::<GitImportProgress>()
        .typ::<HashtableSyncProgress>()
        .typ::<HealthSweepProgress>()
        .typ::<InstallProgress>()
        .typ::<LayoutMigrationProgress>()
        .typ::<MigrationProgress>()
        .typ::<ModRepairProgress>()
        .typ::<ModStorageProgress>()
        .typ::<OverlayProgress>()
        .typ::<Incident>()
        .typ::<LaunchProgress>()
        .typ::<SessionStarted>()
        .typ::<SessionChanged>()
        .typ::<SessionGameRunning>()
        .typ::<SessionEnded>()
        .typ::<LayoutMigrationReport>()
        .typ::<ReferenceWalkProgress>()
        .typ::<LayerFilesChanged>()
        .typ::<DeepLinkInstallRequest>()
        .typ::<DeepLinkSettingsRequest>()
        .typ::<ProtocolInstallProgress>()
        .typ::<GameAttachedPayload>()
        .typ::<GameOverlayPayload>()
        .typ::<LinkedBinWarningPayload>()
        .typ::<WadScanFailedPayload>()
        .dangerously_cast_bigints_to_number()
}

/// The constant each generated file names its commands' invoke names under.
pub(crate) const COMMAND_NAMES: &str = "commandNames";

/// The name each of `commands` is invoked under, `plugin:<plugin>|<command>`, keyed by its
/// generated function.
pub(crate) fn command_names(plugin: &str, commands: &[&str]) -> BTreeMap<String, String> {
    commands
        .iter()
        .map(|command| (lower_camel(command), format!("plugin:{plugin}|{command}")))
        .collect()
}

/// `get_installed_mods` as `getInstalledMods`, the key `tauri-specta` gives its function, and
/// `app-update` as `appUpdate`.
fn lower_camel(text: &str) -> String {
    let mut parts = text.split(['_', '-']);
    let head = parts.next().unwrap_or_default().to_owned();
    parts.fold(head, |mut name, part| {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            name.extend(first.to_uppercase());
            name.push_str(chars.as_str());
        }
        name
    })
}

/// The handler that answers the commands of `builder`.
pub(crate) fn handler(
    builder: Builder<Wry>,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    /* The handler's type captures the borrow, though its body only clones an `Arc`.
    Leaked rather than held, because the app outlives every scope in `main`. */
    let builder: &'static Builder<Wry> = Box::leak(Box::new(builder));
    builder.invoke_handler()
}

#[cfg(test)]
mod tests;
