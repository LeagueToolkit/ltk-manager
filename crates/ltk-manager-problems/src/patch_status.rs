//! Patch information for the forward-looking Problems setting.

use ltk_manager_base::game_build::GameBuild;
use ltk_manager_bin::meta_schema::MetaSchema;
use serde::Serialize;

use crate::rules::bin_property_type::{table, waiting_patch};

/// The newest supported content build and the configured install's patch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct PatchStatus {
    pub known_build: u32,
    pub known_patch: Option<String>,
    pub installed_patch: Option<String>,
    pub install_configured: bool,
    pub waiting_patch: Option<String>,
}

impl PatchStatus {
    /// Compare the schema snapshot with every migration table, without a project scan.
    pub fn new(
        schema: &MetaSchema,
        installed: Option<GameBuild>,
        install_configured: bool,
    ) -> Self {
        let version = schema.version();
        let mut known_build = version.build;
        let mut known_patch = version.patch;
        for table in table::tables() {
            let build = table.build();
            if build.content() > known_build
                || (build.content() == known_build && known_patch.is_none())
            {
                known_build = build.content();
                known_patch = Some(build.patch());
            }
        }
        Self {
            known_build,
            known_patch,
            installed_patch: installed.map(|build| build.patch()),
            install_configured,
            waiting_patch: installed.and_then(waiting_patch).map(|build| build.patch()),
        }
    }
}

#[cfg(test)]
mod tests;
