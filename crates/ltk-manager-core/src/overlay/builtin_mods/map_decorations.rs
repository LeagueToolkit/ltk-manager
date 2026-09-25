//! The built-in mod that forces map decorations a mutator switches off or on, per ADR-0053.

use super::baked_meshes::{material_name, move_under};
use super::game_maps::{self, MapArchive, MapBin};
use super::overrides::{Overrides, quoted};
use super::{BuiltinMod, Context};
use crate::config::{BuiltinModSettings, MapDecorationMode};
use crate::error::AppResult;
use fs_err as fs;
use ltk_hash::BinHash;
use ltk_meta::{Bin, PropertyValueEnum};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The controller class whose predicate is whether the game applied its `MutatorName`.
const MUTATOR_CONTROLLER: &str = "MutatorMapVisibilityController";

const MUTATOR_NAME: &str = "MutatorName";

/// A key no mutator expansion applies, so a controller naming it is never visible.
const NEVER_APPLIED: &str = "LTK_MapDecorationHidden";

/// A key the `Default` mutator group assigns in every game, so a controller naming it is always
/// visible. The controller reads whether a key was applied, never its value.
const ALWAYS_APPLIED: &str = "HudSkin";

/// Decorations a map also bakes into meshes with no controller, by mutator lowercased, with the
/// lowercased material name prefix of those meshes. Hiding the decoration moves them under its
/// controller. The prefix is Riot's naming, not something the data declares.
const BAKED: &[(&str, &str)] = &[("sr_hall_of_legends", "hol_")];

/// The directory under the project holding each rewritten `.mapgeo`, by source checksum.
const MAPGEO_CACHE: &str = "mapgeo-cache";

/// Changes when the rewrite changes, so a cached `.mapgeo` from an older rewrite is not reused.
const MAPGEO_REWRITE: u32 = 1;

/// `.mapgeo` bytes with the meshes a lowercased material name prefix names moved under a
/// controller, and none when no mesh moves.
type RewriteFn = fn(&[u8], u32, &str) -> AppResult<Option<Vec<u8>>>;

/// Each mutator controller of a map container is renamed to a key whose answer is fixed.
#[derive(Debug, Clone)]
pub(super) struct MapDecorations {
    /// What each decoration does, by its mutator's name lowercased.
    modes: BTreeMap<String, MapDecorationMode>,
    rewrite: RewriteFn,
}

/// The rewrite the game gets: baked meshes moved by `ltk_mapgeo`.
fn move_baked(bytes: &[u8], controller: u32, prefix: &str) -> AppResult<Option<Vec<u8>>> {
    move_under(bytes, controller, |material| {
        material_name(material)
            .to_ascii_lowercase()
            .starts_with(prefix)
    })
}

/// One `MutatorMapVisibilityController` in a container's materials bin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MutatorController {
    /// `0x` and the object's eight hexadecimal digits, which is how a declaration names it.
    pub(super) entry: String,
    pub(super) hash: BinHash,
    pub(super) mutator: String,
}

impl MapDecorations {
    /// The mod `settings` turn on, and none when every decoration follows the game.
    pub(super) fn of(settings: &BuiltinModSettings) -> Option<Self> {
        if settings.map_decorations.is_empty() {
            return None;
        }

        let modes = settings
            .map_decorations
            .iter()
            .map(|(mutator, mode)| (mutator.to_ascii_lowercase(), *mode))
            .collect();
        Some(Self {
            modes,
            rewrite: move_baked,
        })
    }
}

impl BuiltinMod for MapDecorations {
    fn slug(&self) -> &'static str {
        "map-decorations"
    }

    fn display_name(&self) -> &'static str {
        "Map decorations"
    }

    /// On every container of every map, each mutator controller with a mode set, renamed to the
    /// key that fixes its answer. A hidden decoration with baked meshes also has those meshes
    /// moved under its controller in the container's `.mapgeo`.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let mut overrides = Overrides::default();
        let cache = cx.cache_dir.join(MAPGEO_CACHE);
        let mut cached = BTreeSet::new();
        for map in game_maps::read(cx.game_dir)? {
            let mut archive: Option<MapArchive> = None;
            for (materials, controllers) in controllers_of(&map)? {
                for controller in controllers {
                    let mutator = controller.mutator.to_ascii_lowercase();
                    let Some(mode) = self.modes.get(&mutator) else {
                        continue;
                    };

                    let key = match mode {
                        MapDecorationMode::Hide => NEVER_APPLIED,
                        MapDecorationMode::Show => ALWAYS_APPLIED,
                    };
                    overrides.declare(&materials, &controller.entry, MUTATOR_NAME, quoted(key));

                    let baked = BAKED.iter().find(|(name, _)| *name == mutator);
                    if let (MapDecorationMode::Hide, Some((_, prefix))) = (mode, baked) {
                        let archive = match &mut archive {
                            Some(archive) => archive,
                            None => archive.insert(map.open()?),
                        };
                        let mapgeo = mapgeo_of(&materials);
                        let rewrite = Rewrite {
                            mapgeo: &mapgeo,
                            controller: controller.hash,
                            prefix,
                        };
                        if let Some(file) = rewrite.cached(archive, &cache, &self.rewrite)? {
                            overrides.insert_copy(&map.archive, &mapgeo, file.clone());
                            cached.insert(file);
                        }
                    }
                }
            }
        }
        remove_stale(&cache, &cached)?;
        Ok(overrides)
    }
}

/// One container `.mapgeo` with the meshes a prefix names moved under a controller.
struct Rewrite<'a> {
    mapgeo: &'a str,
    controller: BinHash,
    /// The lowercased material name prefix of the meshes to move.
    prefix: &'a str,
}

impl Rewrite<'_> {
    /// The rewritten file in `cache`, made on the first build that needs it, and none where the
    /// archive holds no such `.mapgeo`, no mesh moves, or the rewrite fails.
    ///
    /// A source with no mesh to move, or one the rewrite fails on, leaves an empty marker, so it
    /// is not read again. A failure is logged rather than failing the build, since the
    /// declarations still hide what names the controller.
    fn cached(
        &self,
        archive: &mut MapArchive,
        cache: &Path,
        rewrite: &RewriteFn,
    ) -> AppResult<Option<PathBuf>> {
        let Some(checksum) = archive.checksum(self.mapgeo) else {
            return Ok(None);
        };

        let file = cache.join(format!(
            "{checksum:016x}-{:08x}-{}-v{MAPGEO_REWRITE}.mapgeo",
            self.controller.0, self.prefix
        ));
        if let Ok(metadata) = fs::metadata(&file) {
            return Ok((metadata.len() > 0).then_some(file));
        }

        let Some(bytes) = archive.read(self.mapgeo)? else {
            return Ok(None);
        };
        let moved = rewrite(&bytes, self.controller.0, self.prefix).unwrap_or_else(|e| {
            tracing::warn!("Built-in mods: leaving {} as it ships: {e}", self.mapgeo);
            None
        });

        fs::create_dir_all(cache)?;
        let partial = file.with_extension("partial");
        fs::write(&partial, moved.as_deref().unwrap_or_default())?;
        fs::rename(&partial, &file)?;
        if moved.is_none() {
            tracing::info!("Built-in mods: no baked mesh to move in {}", self.mapgeo);
        }
        Ok(moved.map(|_| file))
    }
}

/// `data/<container>.mapgeo` of `data/<container>.materials.bin`.
fn mapgeo_of(materials: &str) -> String {
    let container = materials
        .strip_suffix(".materials.bin")
        .unwrap_or(materials);
    format!("{container}.mapgeo")
}

/// Remove each file in `cache` this build did not use, markers of an unchanged source aside.
fn remove_stale(cache: &Path, used: &BTreeSet<PathBuf>) -> AppResult<()> {
    let entries = match fs::read_dir(cache) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let path = entry?.path();
        let is_marker = fs::metadata(&path).is_ok_and(|metadata| metadata.len() == 0);
        if !used.contains(&path) && !is_marker {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// Each container materials bin `map` draws with, and the mutator controllers it holds.
///
/// # Errors
///
/// Fails when the map archive cannot be opened.
pub(super) fn controllers_of(map: &MapBin) -> AppResult<Vec<(String, Vec<MutatorController>)>> {
    let materials = map.materials();
    Ok(map
        .read_bins(&materials)?
        .into_iter()
        .map(|(path, bin)| (path, mutator_controllers(&bin)))
        .collect())
}

/// Each mutator controller `bin` defines, in the bin's order.
pub(super) fn mutator_controllers(bin: &Bin) -> Vec<MutatorController> {
    let class = BinHash::from(MUTATOR_CONTROLLER);
    bin.objects
        .values()
        .filter(|object| object.class_hash == class)
        .filter_map(
            |object| match object.properties.get(&BinHash::from(MUTATOR_NAME)) {
                Some(PropertyValueEnum::String(name)) if !name.value.is_empty() => {
                    Some(MutatorController {
                        entry: format!("0x{:08x}", object.path_hash.0),
                        hash: object.path_hash,
                        mutator: name.value.clone(),
                    })
                }
                _ => None,
            },
        )
        .collect()
}

#[cfg(test)]
mod tests;
