//! Mods the manager generates and injects above every other mod, per ADR-0043.

mod baked_meshes;
mod base_skins;
mod character_inking;
mod game_maps;
mod game_skins;
mod loadingscreen;
mod map_decorations;
mod map_skins;
mod mod_skins;
mod overrides;
mod skin_bin;
mod stand_in;
mod ward_skins;

use base_skins::BaseSkins;
use character_inking::CharacterInking;
pub use character_inking::{
    InkingMap, InkingOutline, InkingPreview, InkingSide, inking_maps, outline_values,
    write_inking_preview,
};
use fs_err as fs;
use game_skins::GameSkins;
use loadingscreen::LoadingScreen;
use ltk_manager_base::config::BuiltinModSettings;
use ltk_manager_base::error::{AppResult, Utf8PathExt};
use ltk_manager_base::game_build::GameBuild;
use ltk_manager_base::utils::game::GameDir;
use ltk_overlay::{EnabledMod, FsModContent};
use ltk_wad::PathResolver;
use map_decorations::MapDecorations;
use map_skins::MapSkins;
use overrides::Overrides;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use ward_skins::DefaultWardSkins;

/// The directory under the storage directory holding every built-in mod's project.
pub(crate) const DIR: &str = "builtin";

/// The file beside a built-in mod's project that names the inputs it was generated from.
const STAMP_FILE: &str = "stamp.json";

/// The stamp format. A stamp of another version never matches, so the project regenerates.
const STAMP_VERSION: u32 = 1;

/// A mod the manager generates from the installed game and the mods below it.
trait BuiltinMod {
    /// The project directory's name, and the overlay mod id after `builtin:`.
    fn slug(&self) -> &'static str;

    /// The name a reader sees for the mod.
    fn display_name(&self) -> &'static str;

    /// The chunks the mod overrides, generated against `cx`.
    ///
    /// # Errors
    ///
    /// Fails when the game cannot be read or an override cannot be built.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides>;
}

/// What a built-in mod is generated against.
///
/// One context serves every built-in mod of a build, so the game archives mount once.
struct Context<'a> {
    game_dir: &'a GameDir,
    /// The WAD path tables, which name the chunks the game's archives hold.
    tables: &'a dyn PathResolver,
    /// Every mod below the built-in ones, highest priority first.
    mods: &'a mut [EnabledMod],
    /// Where the mod keeps its caches, a directory writing its overrides leaves alone.
    cache_dir: &'a Path,
    /// Answers `true` once the build is called off.
    called_off: &'a dyn Fn() -> bool,
    /// The champion archives, mounted by the first built-in mod that reads them.
    champions: Option<GameSkins<'a>>,
    /// The map archives, mounted by the first built-in mod that reads them.
    maps: Option<GameSkins<'a>>,
}

/// The answer of a build that is never called off.
fn never() -> bool {
    false
}

impl<'a> Context<'a> {
    /// A context over `game_dir` and `mods` that is never called off, caching in `cache_dir`.
    fn new(
        game_dir: &'a GameDir,
        tables: &'a dyn PathResolver,
        mods: &'a mut [EnabledMod],
        cache_dir: &'a Path,
    ) -> Self {
        Self {
            game_dir,
            tables,
            mods,
            cache_dir,
            called_off: &never,
            champions: None,
            maps: None,
        }
    }
}

/// Fails with [`ltk_overlay::Error::CalledOff`] once `called_off` answers `true`.
///
/// Takes the function rather than the context, so a mod holding the context's archives can
/// still ask.
fn check_called_off(called_off: &dyn Fn() -> bool) -> AppResult<()> {
    if called_off() {
        return Err(ltk_overlay::Error::CalledOff.into());
    }
    Ok(())
}

/// The archives in `slot`, mounted by `mount` on the first call of a build.
///
/// A field of the context rather than a method on it, so a mod can hold the archives beside
/// the context's mods and cache directory.
///
/// # Errors
///
/// Fails when `mount` fails.
fn mounted<'s, 'a>(
    slot: &'s mut Option<GameSkins<'a>>,
    mount: impl FnOnce() -> AppResult<GameSkins<'a>>,
) -> AppResult<&'s mut GameSkins<'a>> {
    let skins = match slot.take() {
        Some(skins) => skins,
        None => mount()?,
    };
    Ok(slot.insert(skins))
}

/// Each built-in mod `settings` turns on, highest priority first.
fn enabled(settings: &BuiltinModSettings) -> Vec<Box<dyn BuiltinMod>> {
    let mut enabled: Vec<Box<dyn BuiltinMod>> = Vec::new();
    if settings.default_ward_skins {
        enabled.push(Box::new(DefaultWardSkins));
    }
    if let Some(base_skins) = BaseSkins::of(settings.base_skins) {
        enabled.push(Box::new(base_skins));
    }
    if let Some(character_inking) = CharacterInking::of(settings) {
        enabled.push(Box::new(character_inking));
    }
    if let Some(map_skins) = MapSkins::of(settings) {
        enabled.push(Box::new(map_skins));
    }
    if let Some(map_decorations) = MapDecorations::of(settings) {
        enabled.push(Box::new(map_decorations));
    }
    if let Some(loading_screen) = LoadingScreen::of(&settings.loading_screen) {
        enabled.push(Box::new(loading_screen));
    }
    enabled
}

/// A map skin every game can be made to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ForcibleMapSkin {
    /// The skin's `name`, which the setting stores.
    pub name: String,
    /// Each map archive holding a whole skin by that name, such as `Map11.wad.client`.
    pub maps: Vec<String>,
}

/// A map decoration a mutator switches, which the map decorations mod can force off or on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MapDecoration {
    /// The mutator whose key switches the decoration, which the setting stores.
    pub mutator: String,
    /// Each map archive with a container holding it, such as `Map11.wad.client`.
    pub maps: Vec<String>,
}

/// Every mutator a map container in `game_dir` switches decorations by, in name order.
///
/// Two spellings of one mutator are one decoration, since the game matches a key without case.
///
/// # Errors
///
/// Fails when the maps directory cannot be listed.
pub fn map_decorations(game_dir: &GameDir) -> AppResult<Vec<MapDecoration>> {
    let mut by_key: BTreeMap<String, MapDecoration> = BTreeMap::new();
    for map in game_maps::read(game_dir)? {
        for (_, controllers) in map_decorations::controllers_of(&map)? {
            for controller in controllers {
                let decoration = by_key
                    .entry(controller.mutator.to_ascii_lowercase())
                    .or_insert_with(|| MapDecoration {
                        mutator: controller.mutator.clone(),
                        maps: Vec::new(),
                    });
                if !decoration.maps.contains(&map.archive) {
                    decoration.maps.push(map.archive.clone());
                }
            }
        }
    }
    Ok(by_key.into_values().collect())
}

/// Every skin other than `Default` that a map in `game_dir` links and holds the geometry and
/// materials of, by name.
///
/// # Errors
///
/// Fails when the maps directory cannot be listed.
pub fn forcible_map_skins(game_dir: &GameDir) -> AppResult<Vec<ForcibleMapSkin>> {
    let mut by_name: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for map in game_maps::read(game_dir)? {
        for skin in map
            .skins
            .iter()
            .filter(|skin| skin.complete && skin.name != "Default")
        {
            let maps = by_name.entry(skin.name.clone()).or_default();
            if !maps.contains(&map.archive) {
                maps.push(map.archive.clone());
            }
        }
    }
    Ok(by_name
        .into_iter()
        .map(|(name, maps)| ForcibleMapSkin { name, maps })
        .collect())
}

/// How many built-in mods `settings` turns on, each one place above every other mod.
pub fn count_enabled(settings: &BuiltinModSettings) -> usize {
    enabled(settings).len()
}

/// Whether a built-in mod's project is generated again when its inputs are unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Regenerate {
    /// Reuse the project whose stamp matches the game build, the settings and the mods.
    IfChanged,
    /// Generate every project.
    Always,
}

/// How long one built-in mod took in a build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltinTiming {
    /// The mod's project directory name.
    pub slug: &'static str,
    pub elapsed: Duration,
    /// Whether the project was reused unchanged rather than generated.
    pub reused: bool,
}

/// What [`inject`] put above the mods, and what it cost.
pub(crate) struct Injected {
    /// The built-in mods turned on, then `mods`.
    pub(crate) mods: Vec<EnabledMod>,
    /// One timing per built-in mod turned on, in priority order.
    pub(crate) timings: Vec<BuiltinTiming>,
}

/// The inputs a built-in mod's project was generated from, kept beside it as [`STAMP_FILE`].
///
/// A project whose stamp equals the stamp of the current inputs is reused. `None` for a mod
/// that cannot fingerprint its content, and for a game whose build cannot be read, so such a
/// build always regenerates.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp {
    version: u32,
    app: String,
    game: String,
    settings: BuiltinModSettings,
    mods: Vec<ModStamp>,
}

/// One mod of a stamp, in priority order.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct ModStamp {
    id: String,
    fingerprint: u64,
}

impl Stamp {
    fn of(
        app_version: &str,
        game_dir: &GameDir,
        settings: &BuiltinModSettings,
        mods: &[EnabledMod],
    ) -> Option<Self> {
        let game = GameBuild::read(game_dir.path())?.to_string();
        let mods = mods
            .iter()
            .map(|m| {
                Some(ModStamp {
                    id: m.id.clone(),
                    fingerprint: m.cache_fingerprint()?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            version: STAMP_VERSION,
            app: app_version.to_owned(),
            game,
            settings: settings.clone(),
            mods,
        })
    }

    /// Whether the project in `dir` was generated from these inputs and still holds its config.
    fn matches(&self, dir: &Path) -> bool {
        if !dir.join("mod.config.json").is_file() {
            return false;
        }
        fs::read(dir.join(STAMP_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Self>(&bytes).ok())
            .is_some_and(|written| written == *self)
    }

    fn write(&self, dir: &Path) -> AppResult<()> {
        fs::write(dir.join(STAMP_FILE), serde_json::to_vec(self)?)?;
        Ok(())
    }
}

/// Removes the stamp in `dir`, so a project that fails to generate is not reused.
fn remove_stamp(dir: &Path) -> AppResult<()> {
    match fs::remove_file(dir.join(STAMP_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Put the built-in mods `settings` turns on above `mods`, writing each one's project first.
///
/// The storage directory keeps the project of each built-in mod turned on and nothing else.
/// `tables` names the chunks of the game in `game_dir`. Under [`Regenerate::IfChanged`], a
/// project generated by `app_version` from the same game build, settings and mods is reused.
/// `report` is called with the display name of each built-in mod before it generates.
///
/// # Errors
///
/// Fails when a project cannot be generated against the game in `game_dir` or written, and
/// with [`ltk_overlay::Error::CalledOff`] once `called_off` answers `true`.
#[expect(
    clippy::too_many_arguments,
    reason = "the inputs of one build, read once at the call site"
)]
pub(crate) fn inject(
    storage_dir: &Path,
    settings: &BuiltinModSettings,
    game_dir: &GameDir,
    tables: &dyn PathResolver,
    mut mods: Vec<EnabledMod>,
    app_version: &str,
    regenerate: Regenerate,
    report: &mut dyn FnMut(&str),
    called_off: &dyn Fn() -> bool,
) -> AppResult<Injected> {
    let root = storage_dir.join(DIR);
    let enabled = enabled(settings);
    remove_all_but(&root, &enabled)?;

    let stamp = match regenerate {
        Regenerate::IfChanged => Stamp::of(app_version, game_dir, settings, &mods),
        Regenerate::Always => None,
    };
    let dirs: Vec<PathBuf> = enabled
        .iter()
        .map(|builtin| root.join(builtin.slug()))
        .collect();
    let mut cx = Context::new(game_dir, tables, &mut mods, &root);
    cx.called_off = called_off;

    let mut injected = Vec::with_capacity(enabled.len() + cx.mods.len());
    let mut timings = Vec::with_capacity(enabled.len());
    for (builtin, dir) in enabled.iter().zip(&dirs) {
        check_called_off(called_off)?;
        report(builtin.display_name());

        let started = Instant::now();
        let reused = stamp.as_ref().is_some_and(|stamp| stamp.matches(dir));
        if !reused {
            remove_stamp(dir)?;
            cx.cache_dir = dir.as_path();
            builtin
                .generate(&mut cx)?
                .write(dir, builtin.slug(), builtin.display_name())?;
            if let Some(stamp) = &stamp {
                stamp.write(dir)?;
            }
        }

        let id = format!("builtin:{}", builtin.slug());
        let elapsed = started.elapsed();
        tracing::info!(
            "Adding built-in mod: id={}, path={}, {} in {:?}",
            id,
            dir.display(),
            if reused { "reused" } else { "generated" },
            elapsed
        );
        timings.push(BuiltinTiming {
            slug: builtin.slug(),
            elapsed,
            reused,
        });
        injected.push(EnabledMod {
            id,
            content: Box::new(FsModContent::new(
                dir.clone().try_into_utf8("built-in mod path")?,
            )),
            enabled_layers: None,
        });
    }
    injected.extend(mods);
    Ok(Injected {
        mods: injected,
        timings,
    })
}

/// Remove each directory in `root` that holds none of `kept`'s projects.
fn remove_all_but(root: &Path, kept: &[Box<dyn BuiltinMod>]) -> AppResult<()> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let path = entry?.path();
        let owned = kept
            .iter()
            .any(|builtin| path.file_name().is_some_and(|name| name == builtin.slug()));
        if !owned && path.is_dir() {
            fs::remove_dir_all(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
