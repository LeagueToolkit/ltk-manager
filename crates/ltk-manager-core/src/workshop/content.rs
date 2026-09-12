use super::ignore_rules::project_relative;
use super::layer;
use super::{ProjectDir, Workshop};
use crate::bin_document::hex;
use crate::error::{AppResult, Utf8PathRefExt};
use crate::hashtables::{BinHashTables, HashtableCache};
use crate::object_index::{Declaration, for_each_declaration};
use camino::{Utf8Path, Utf8PathBuf};
use fs_err as fs;
use ltk_file::LeagueFileKind;
use ltk_hash::BinHash;
use ltk_mod_project::{ModIgnore, ModIgnoreMatch};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufReader;
use std::path::Path;
use walkdir::WalkDir;

/// A project's content directory as a flat per-layer listing.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ContentTree {
    pub layers: Vec<LayerContent>,
}

/// The files inside a single layer directory.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LayerContent {
    pub name: String,
    pub file_count: usize,
    pub total_size_bytes: u64,
    pub entries: Vec<ContentEntry>,
    /// The directories a rule leaves out, which no entry of its own names.
    pub ignored_directories: Vec<IgnoredDirectory>,
}

/// A directory the rules leave out, along with everything under it.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct IgnoredDirectory {
    /// Path relative to the layer root, always POSIX-style (`/`).
    pub relative_path: String,
    pub ignored_by: IgnoreMatch,
}

/// The `.modignore` line that keeps an entry out of a package.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct IgnoreMatch {
    /// The pattern as written, its trailing `/` included.
    pub pattern: String,
    /// The `.modignore` holding the pattern, relative to the project.
    pub source: String,
    /// One-based line of the pattern, null where it cannot be recovered.
    pub line: Option<u32>,
}

/// A single file entry in a layer's content directory.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ContentEntry {
    /// Path relative to the layer root, always POSIX-style (`/`).
    pub relative_path: String,
    pub size_bytes: u64,
    pub kind: WorkshopFileKind,
    /// The objects a `.bin` declares, and empty for any other file.
    pub objects: Vec<ContentObject>,
    /// What leaves the file out of a package, null for one that ships.
    pub ignored_by: Option<IgnoreMatch>,
}

/// One object a layer's `.bin` declares.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ContentObject {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash when no table names it.
    pub path: String,
    /// The class the object declares, or its hash when no table names it.
    pub class: String,
    /// The class hash, as `0x` and eight hex digits.
    pub class_hash: String,
}

/// Mirror of [`ltk_file::LeagueFileKind`] with `ts-rs` bindings. Kept in sync
/// manually — the upstream enum is small and stable, and mirroring lets us
/// export a TypeScript union without fighting external crate attributes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "snake_case")]
pub enum WorkshopFileKind {
    Animation,
    Jpeg,
    LightGrid,
    LuaObj,
    MapGeometry,
    Png,
    Tga,
    Preload,
    PropertyBin,
    PropertyBinOverride,
    RiotStringTable,
    SimpleSkin,
    Skeleton,
    StaticMeshAscii,
    StaticMeshBinary,
    Svg,
    Texture,
    TextureDds,
    Unknown,
    WorldGeometry,
    WwiseBank,
    WwisePackage,
}

impl From<LeagueFileKind> for WorkshopFileKind {
    fn from(value: LeagueFileKind) -> Self {
        match value {
            LeagueFileKind::Animation => Self::Animation,
            LeagueFileKind::Jpeg => Self::Jpeg,
            LeagueFileKind::LightGrid => Self::LightGrid,
            LeagueFileKind::LuaObj => Self::LuaObj,
            LeagueFileKind::MapGeometry => Self::MapGeometry,
            LeagueFileKind::Png => Self::Png,
            LeagueFileKind::Tga => Self::Tga,
            LeagueFileKind::Preload => Self::Preload,
            LeagueFileKind::PropertyBin => Self::PropertyBin,
            LeagueFileKind::PropertyBinOverride => Self::PropertyBinOverride,
            LeagueFileKind::RiotStringTable => Self::RiotStringTable,
            LeagueFileKind::SimpleSkin => Self::SimpleSkin,
            LeagueFileKind::Skeleton => Self::Skeleton,
            LeagueFileKind::StaticMeshAscii => Self::StaticMeshAscii,
            LeagueFileKind::StaticMeshBinary => Self::StaticMeshBinary,
            LeagueFileKind::Svg => Self::Svg,
            LeagueFileKind::Texture => Self::Texture,
            LeagueFileKind::TextureDds => Self::TextureDds,
            LeagueFileKind::Unknown => Self::Unknown,
            LeagueFileKind::WorldGeometry => Self::WorldGeometry,
            LeagueFileKind::WwiseBank => Self::WwiseBank,
            LeagueFileKind::WwisePackage => Self::WwisePackage,
        }
    }
}

impl From<WorkshopFileKind> for LeagueFileKind {
    fn from(value: WorkshopFileKind) -> Self {
        match value {
            WorkshopFileKind::Animation => Self::Animation,
            WorkshopFileKind::Jpeg => Self::Jpeg,
            WorkshopFileKind::LightGrid => Self::LightGrid,
            WorkshopFileKind::LuaObj => Self::LuaObj,
            WorkshopFileKind::MapGeometry => Self::MapGeometry,
            WorkshopFileKind::Png => Self::Png,
            WorkshopFileKind::Tga => Self::Tga,
            WorkshopFileKind::Preload => Self::Preload,
            WorkshopFileKind::PropertyBin => Self::PropertyBin,
            WorkshopFileKind::PropertyBinOverride => Self::PropertyBinOverride,
            WorkshopFileKind::RiotStringTable => Self::RiotStringTable,
            WorkshopFileKind::SimpleSkin => Self::SimpleSkin,
            WorkshopFileKind::Skeleton => Self::Skeleton,
            WorkshopFileKind::StaticMeshAscii => Self::StaticMeshAscii,
            WorkshopFileKind::StaticMeshBinary => Self::StaticMeshBinary,
            WorkshopFileKind::Svg => Self::Svg,
            WorkshopFileKind::Texture => Self::Texture,
            WorkshopFileKind::TextureDds => Self::TextureDds,
            WorkshopFileKind::Unknown => Self::Unknown,
            WorkshopFileKind::WorldGeometry => Self::WorldGeometry,
            WorkshopFileKind::WwiseBank => Self::WwiseBank,
            WorkshopFileKind::WwisePackage => Self::WwisePackage,
        }
    }
}

impl Workshop {
    /// Walk the project's `content/` directory and return the per-layer file
    /// listing. Symlinks are skipped. The frontend virtualizes rendering, so we
    /// return every file the project contains, each carrying what a pack would
    /// leave out - per "Ignore rules" in docs/ux/PROJECT_EDITOR.md.
    pub fn get_project_content_tree(&self, project_path: &str) -> AppResult<ContentTree> {
        let project = ProjectDir::open(project_path)?;

        let content_dir = project.path().join("content");
        if !content_dir.exists() {
            return Ok(ContentTree { layers: Vec::new() });
        }

        let layer_dirs = layer::dirs_in(&content_dir)?;

        /* A project whose rules do not compile still lists its files. The
        refusal is the document's to report and the pack's to refuse on, and a
        tree that failed with them would take the editor down with one typo. */
        let rules = project.ignore_filter().inspect_err(|e| {
            tracing::warn!("Listing {project_path} with no ignore state: {e}");
        });
        let project_root = project.path().try_as_utf8("project path").ok();
        let filter = rules
            .as_ref()
            .ok()
            .zip(project_root)
            .map(|(rules, project_root)| IgnoreFilter {
                rules,
                project_root,
            });

        let mut scanned = Vec::with_capacity(layer_dirs.len());
        for layer_dir in &layer_dirs {
            let name = layer_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            scanned.push(scan_layer(layer_dir, &name, filter.as_ref())?);
        }

        let names = ResolvedNames::resolve(&scanned);
        Ok(ContentTree {
            layers: scanned
                .into_iter()
                .map(|layer| layer.named(&names))
                .collect(),
        })
    }
}

/// One file as the walk read it.
#[derive(Debug)]
struct ScannedEntry {
    relative_path: String,
    size_bytes: u64,
    kind: WorkshopFileKind,
    declared: Vec<Declaration>,
    ignored_by: Option<IgnoreMatch>,
}

/// A layer as the walk read it, its objects still hashes.
#[derive(Debug)]
struct ScannedLayer {
    name: String,
    entries: Vec<ScannedEntry>,
    ignored_directories: Vec<IgnoredDirectory>,
}

/// A project's rules, as one scan of its layers reads them.
struct IgnoreFilter<'a> {
    rules: &'a ModIgnore,
    /// Names a matched rule's file the way the creator knows it.
    project_root: &'a Utf8Path,
}

impl IgnoreFilter<'_> {
    /// What leaves `relative_path`, under `layer`, out of a package.
    ///
    /// Parents are consulted, because the scan lists what a pack prunes rather
    /// than pruning it, so a row under an excluded directory is reached.
    fn matched(&self, layer: &str, relative_path: &str, is_dir: bool) -> Option<IgnoreMatch> {
        let in_content = Utf8PathBuf::from(layer).join(relative_path);
        let ModIgnoreMatch::Ignore(rule) = self.rules.matched_with_parents(&in_content, is_dir)
        else {
            return None;
        };

        Some(IgnoreMatch {
            pattern: rule.pattern().to_string(),
            source: project_relative(rule.source(), self.project_root),
            line: rule.line_number().and_then(|line| u32::try_from(line).ok()),
        })
    }
}

impl ScannedLayer {
    /// The layer as the frontend lists it, every object named through `names`.
    fn named(self, names: &ResolvedNames) -> LayerContent {
        let file_count = self.entries.len();
        let total_size_bytes = self.entries.iter().map(|entry| entry.size_bytes).sum();
        let entries = self
            .entries
            .into_iter()
            .map(|entry| ContentEntry {
                relative_path: entry.relative_path,
                size_bytes: entry.size_bytes,
                kind: entry.kind,
                objects: entry
                    .declared
                    .iter()
                    .map(|declared| names.object(*declared))
                    .collect(),
                ignored_by: entry.ignored_by,
            })
            .collect();

        LayerContent {
            name: self.name,
            file_count,
            total_size_bytes,
            entries,
            ignored_directories: self.ignored_directories,
        }
    }
}

/// The names the shared tables hold for what a scan declared.
#[derive(Debug, Default)]
struct ResolvedNames {
    objects: HashMap<BinHash, String>,
    classes: HashMap<BinHash, String>,
}

impl ResolvedNames {
    /// Every object and class name the tables hold for `scanned`, in one batch.
    ///
    /// A machine whose cache is missing or never synced names nothing, and
    /// every object then reads as its hex.
    fn resolve(scanned: &[ScannedLayer]) -> Self {
        let declared = scanned
            .iter()
            .flat_map(|layer| layer.entries.iter())
            .flat_map(|entry| entry.declared.iter());
        let mut objects: Vec<BinHash> = declared.clone().map(|d| d.object).collect();
        let mut classes: Vec<BinHash> = declared.map(|d| d.class).collect();
        if objects.is_empty() {
            return Self::default();
        }
        objects.sort_unstable();
        objects.dedup();
        classes.sort_unstable();
        classes.dedup();

        let tables: BinHashTables = match HashtableCache::shared() {
            Ok(cache) => cache.bin_tables(),
            Err(e) => {
                tracing::debug!("No hashtable cache to name a project's objects from: {e}");
                return Self::default();
            }
        };

        let mut names = Self::default();
        tables.for_each_entry(&objects, &mut |at, path| {
            names.objects.insert(objects[at], path.to_owned());
        });
        names.classes = classes
            .into_iter()
            .filter_map(|class| Some((class, tables.class(class)?)))
            .collect();
        names
    }

    /// `declared` as the frontend lists it, hex wherever a name is missing.
    fn object(&self, declared: Declaration) -> ContentObject {
        ContentObject {
            object_hash: hex(declared.object),
            path: self
                .objects
                .get(&declared.object)
                .map_or_else(|| hex(declared.object), Clone::clone),
            class: self
                .classes
                .get(&declared.class)
                .map_or_else(|| hex(declared.class), Clone::clone),
            class_hash: hex(declared.class),
        }
    }
}

/// Scan a single layer directory. Returns every file under the directory,
/// recursively — no truncation.
fn scan_layer(
    layer_dir: &Path,
    name: &str,
    filter: Option<&IgnoreFilter<'_>>,
) -> AppResult<ScannedLayer> {
    let mut entries: Vec<ScannedEntry> = Vec::new();
    let mut ignored_directories: Vec<IgnoredDirectory> = Vec::new();

    for dent in WalkDir::new(layer_dir).follow_links(false) {
        let dent = match dent {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(
                    "Skipping unreadable entry in {}: {}",
                    layer_dir.display(),
                    e
                );
                continue;
            }
        };

        if dent.depth() == 0 {
            continue;
        }

        let relative_path = dent
            .path()
            .strip_prefix(layer_dir)
            .map(Path::to_path_buf)
            .unwrap_or_else(|_| dent.path().to_path_buf())
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/");

        if dent.file_type().is_dir() {
            let matched = filter.and_then(|filter| filter.matched(name, &relative_path, true));
            if let Some(ignored_by) = matched {
                ignored_directories.push(IgnoredDirectory {
                    relative_path,
                    ignored_by,
                });
            }
            continue;
        }

        if !dent.file_type().is_file() {
            continue;
        }

        let size_bytes = dent.metadata().map(|m| m.len()).unwrap_or(0);

        let extension = dent
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let kind = WorkshopFileKind::from(LeagueFileKind::from_extension(extension));

        let declared = if kind == WorkshopFileKind::PropertyBin {
            declarations(dent.path()).unwrap_or_else(|e| {
                tracing::debug!("Skipping the objects of {}: {e}", dent.path().display());
                Vec::new()
            })
        } else {
            Vec::new()
        };

        let ignored_by = filter.and_then(|filter| filter.matched(name, &relative_path, false));

        entries.push(ScannedEntry {
            relative_path,
            size_bytes,
            kind,
            declared,
            ignored_by,
        });
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    ignored_directories.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(ScannedLayer {
        name: name.to_string(),
        entries,
        ignored_directories,
    })
}

/// Every object the bin at `path` declares, in file order.
fn declarations(path: &Path) -> Result<Vec<Declaration>, ltk_meta::Error> {
    let file = BufReader::new(fs::File::open(path)?);
    let mut declared = Vec::new();
    for_each_declaration(file, |declaration| declared.push(declaration))?;
    Ok(declared)
}

#[cfg(test)]
mod tests;
