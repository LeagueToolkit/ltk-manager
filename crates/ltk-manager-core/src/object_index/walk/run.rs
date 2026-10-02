//! One walk over a project's layers and the install, on the problems pass's bounded pool.

use fs_err as fs;
use std::fmt::Write as _;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

use ltk_wad::hex_name;
use walkdir::WalkDir;

use crate::bin_document::{EntryKey, HashPath, Lens, RowNames, Wanted, hex};
use crate::error::AppResult;
use crate::game_index::FIND_LIMIT;
use crate::game_wads::{GameArchives, mount_wad};
use crate::meta_schema::SchemaAt;
use crate::preview::AssetRef;
use crate::problems::Budget;
use crate::problems::walk::write_json_string;
use crate::utils::natural_order::compare_names;
use crate::workshop::layer;

use super::super::{
    ObjectIndex, ReferenceGroup, ReferenceHit, ReferenceProperty, ReferenceResult,
    ReferenceWalkProgress,
};
use super::{HitStep, WalkHit, WalkTarget, scan_bin};

/// One bin of a project's layers, which the walk reads beside the install's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerBin {
    /// The file, as an open reads it.
    pub asset: AssetRef,
    /// The path relative to the layer root, which a group is titled by.
    pub file: String,
    /// Where the file is on disk.
    pub path: PathBuf,
}

/// Every `.bin` of a project's layers, `base` first, each layer's in path order.
///
/// `project` is the project directory as the frontend names it, which every asset
/// carries. A project with no content directory holds none.
///
/// # Errors
///
/// Fails when the content directory cannot be listed. An entry that cannot be read is
/// skipped and logged.
pub fn layer_bins(project: &str) -> AppResult<Vec<LayerBin>> {
    let content = Path::new(project).join("content");
    if !content.exists() {
        return Ok(Vec::new());
    }

    let mut bins = Vec::new();
    for layer_dir in layer::dirs_in(&content)? {
        let Some(layer_name) = layer_dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let start = bins.len();
        for entry in WalkDir::new(&layer_dir).follow_links(false) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    tracing::debug!("Not walking an entry of {}: {e}", layer_dir.display());
                    continue;
                }
            };
            let is_bin = entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("bin"));
            if !entry.file_type().is_file() || !is_bin {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(&layer_dir) else {
                continue;
            };
            let relative = relative
                .components()
                .filter_map(|component| component.as_os_str().to_str())
                .collect::<Vec<_>>()
                .join("/");
            bins.push(LayerBin {
                asset: AssetRef::Layer {
                    project: project.to_owned(),
                    layer: layer_name.to_owned(),
                    path: relative.clone(),
                },
                file: relative,
                path: entry.into_path(),
            });
        }
        bins[start..].sort_by(|a, b| a.file.cmp(&b.file));
    }
    Ok(bins)
}

/// What one walk reads, and the pool it reads it on.
#[derive(Debug)]
pub struct WalkRequest<'a> {
    /// What the walk looks for.
    pub target: WalkTarget,
    /// Read before the install, in their own order.
    pub layers: &'a [LayerBin],
    /// The install the index was built over, whose archives the walk mounts.
    pub archives: &'a GameArchives,
    /// Bounds the bytes a walk holds decompressed, and carries its cancel.
    pub budget: &'a Budget,
    /// The most threads the walk reads on.
    pub workers: usize,
}

/// One job of the pool: a layer's bin, or every declaring file of one archive.
#[derive(Debug)]
enum Unit<'a> {
    Layer(&'a LayerBin),
    Archive { wad: u32, files: Range<usize> },
}

/// What a walk shares across its workers.
struct Walked<'a, O, P> {
    budget: &'a Budget,
    is_overtaken: O,
    progress: P,
    total: u32,
    walked: AtomicU32,
    hits: AtomicU32,
    overtaken: AtomicBool,
}

impl<O: Fn() -> bool, P: Fn(ReferenceWalkProgress)> Walked<'_, O, P> {
    /// Whether to stop before the next bin: a cancel, or a newer query.
    ///
    /// A newer query cancels the budget too, so a worker parked on it wakes and stops.
    fn stopped(&self) -> bool {
        if self.budget.is_cancelled() {
            return true;
        }
        if (self.is_overtaken)() {
            self.overtaken.store(true, Ordering::Relaxed);
            self.budget.cancel();
            return true;
        }
        false
    }

    /// Count one bin read and the hits it held, and report the walk so far.
    fn advance(&self, hits: usize) {
        let found = u32::try_from(hits).unwrap_or(u32::MAX);
        let walked = self.walked.fetch_add(1, Ordering::Relaxed) + 1;
        let hits = self
            .hits
            .fetch_add(found, Ordering::Relaxed)
            .saturating_add(found);
        (self.progress)(ReferenceWalkProgress {
            walked,
            total: self.total,
            hits,
        });
    }
}

impl ObjectIndex {
    /// Every value of the project's layers and the install that `request.target` names,
    /// grouped by the file that holds it.
    ///
    /// The layers come first, then the install's declaring files in archive order. One
    /// job per layer bin and per archive runs on at most `request.workers` threads, each
    /// chunk held under the budget while it is read. The objects of a group come in
    /// natural path order, the unnamed last, and an object's rows in file order.
    ///
    /// `is_overtaken` and the budget's cancel are tested before every bin, so a walk stops
    /// within the archive it is reading. `progress` is called after every bin, from
    /// whichever worker read it. `names` and `schema` spell the paths once the walk is over.
    #[must_use]
    pub fn walk(
        &self,
        request: &WalkRequest<'_>,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
        is_overtaken: impl Fn() -> bool + Sync,
        progress: impl Fn(ReferenceWalkProgress) + Sync,
    ) -> ReferenceResult {
        self.walk_capped(request, names, schema, FIND_LIMIT, is_overtaken, progress)
    }

    /// [`walk`](Self::walk) with the cap a test can afford to fill.
    pub(in crate::object_index) fn walk_capped(
        &self,
        request: &WalkRequest<'_>,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
        limit: usize,
        is_overtaken: impl Fn() -> bool + Sync,
        progress: impl Fn(ReferenceWalkProgress) + Sync,
    ) -> ReferenceResult {
        let started = Instant::now();
        let units = self.units(request.layers);
        let files = request.layers.len() + self.declared.files.len();
        let walked = Walked {
            budget: request.budget,
            is_overtaken,
            progress,
            total: u32::try_from(files).unwrap_or(u32::MAX),
            walked: AtomicU32::new(0),
            hits: AtomicU32::new(0),
            overtaken: AtomicBool::new(false),
        };

        let reads = request.budget.map(
            &units,
            request.workers,
            |_| 0,
            |unit| match unit {
                Unit::Layer(bin) => walk_layer(bin, &request.target, &walked)
                    .map(|hits| vec![(0, hits)])
                    .unwrap_or_default(),
                Unit::Archive { wad, files } => {
                    self.walk_archive(*wad, files.clone(), request, &walked)
                }
            },
        );

        let mut total = 0usize;
        let mut room = limit;
        let mut kept: Vec<(AssetRef, String, Vec<WalkHit>)> = Vec::new();
        for (unit, read) in units.iter().zip(reads) {
            for (at, mut hits) in read.unwrap_or_default() {
                total += hits.len();
                hits.truncate(room);
                if hits.is_empty() {
                    continue;
                }
                room -= hits.len();
                let (asset, file) = self.group_of(unit, at);
                kept.push((asset, file, hits));
            }
        }

        let overtaken = walked.overtaken.load(Ordering::Relaxed);
        let cancelled = request.budget.is_cancelled() && !overtaken;
        tracing::info!(
            target = ?request.target,
            walked = walked.walked.load(Ordering::Relaxed),
            files,
            hits = total,
            workers = request.workers,
            cancelled,
            overtaken,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Walked the bins for references"
        );

        let spelled = HitNames::resolve(kept.iter().flat_map(|group| &group.2), names, schema);
        ReferenceResult {
            groups: kept
                .into_iter()
                .map(|(asset, file, hits)| spelled.group(asset, file, &hits))
                .collect(),
            total: u32::try_from(total).unwrap_or(u32::MAX),
            superseded: overtaken,
            cancelled,
        }
    }

    /// The layers one job each, then one job per run of declaring files in one archive.
    fn units<'a>(&self, layers: &'a [LayerBin]) -> Vec<Unit<'a>> {
        let mut units: Vec<Unit<'a>> = layers.iter().map(Unit::Layer).collect();
        let files = &self.declared.files;
        let mut start = 0;
        while start < files.len() {
            let wad = files[start].wad;
            let end = start + files[start..].partition_point(|file| file.wad == wad);
            units.push(Unit::Archive {
                wad,
                files: start..end,
            });
            start = end;
        }
        units
    }

    /// The asset and title of the file at `at` in `unit`'s read.
    fn group_of(&self, unit: &Unit<'_>, at: usize) -> (AssetRef, String) {
        match unit {
            Unit::Layer(bin) => (bin.asset.clone(), bin.file.clone()),
            Unit::Archive { wad, .. } => {
                let file = &self.declared.files[at];
                (
                    AssetRef::GameChunk {
                        wad: self.declared.wads[*wad as usize].clone(),
                        path_hash: hex_name(file.path_hash),
                    },
                    self.file_name(file),
                )
            }
        }
    }

    /// Every declaring file of `files` in one archive, with the hits of each that held any.
    ///
    /// An archive that will not mount is logged, and its files count as walked.
    fn walk_archive<O, P>(
        &self,
        wad: u32,
        files: Range<usize>,
        request: &WalkRequest<'_>,
        walked: &Walked<'_, O, P>,
    ) -> Vec<(usize, Vec<WalkHit>)>
    where
        O: Fn() -> bool,
        P: Fn(ReferenceWalkProgress),
    {
        let name = &self.declared.wads[wad as usize];
        let mounted = request
            .archives
            .archive_path(name)
            .and_then(|path| mount_wad(&path));
        let mut archive = match mounted {
            Ok(archive) => archive,
            Err(e) => {
                tracing::warn!("Not walking unreadable game archive {name}: {e}");
                for _ in files {
                    walked.advance(0);
                }
                return Vec::new();
            }
        };

        let mut found = Vec::new();
        for at in files {
            if walked.stopped() {
                break;
            }
            let path_hash = self.declared.files[at].path_hash;
            let Some(chunk) = archive.chunks().get(path_hash).copied() else {
                walked.advance(0);
                continue;
            };
            let Some(_held) = request.budget.reserve(chunk.uncompressed_size() as u64) else {
                break;
            };
            let bytes = match archive.load_chunk_decompressed(&chunk) {
                Ok(bytes) => bytes,
                Err(e) => {
                    tracing::debug!("Not walking {name}/{}: {e}", hex_name(path_hash));
                    walked.advance(0);
                    continue;
                }
            };
            let mut hits = Vec::new();
            if let Err(e) = scan_bin(&bytes, &request.target, &mut hits) {
                tracing::debug!("Walked {name}/{} only in part: {e}", hex_name(path_hash));
            }
            walked.advance(hits.len());
            if !hits.is_empty() {
                found.push((at, hits));
            }
        }
        found
    }
}

/// The hits of one layer bin, or `None` where the walk stopped before it.
fn walk_layer<O, P>(
    bin: &LayerBin,
    target: &WalkTarget,
    walked: &Walked<'_, O, P>,
) -> Option<Vec<WalkHit>>
where
    O: Fn() -> bool,
    P: Fn(ReferenceWalkProgress),
{
    if walked.stopped() {
        return None;
    }
    let size = fs::metadata(&bin.path).map_or(0, |metadata| metadata.len());
    let _held = walked.budget.reserve(size)?;
    let mut hits = Vec::new();
    match fs::read(&bin.path) {
        Ok(bytes) => {
            if let Err(e) = scan_bin(&bytes, target, &mut hits) {
                tracing::debug!("Walked {} only in part: {e}", bin.path.display());
            }
        }
        Err(e) => tracing::debug!("Not walking {}: {e}", bin.path.display()),
    }
    walked.advance(hits.len());
    Some(hits)
}

/// The property `hit` reads as, spelled through `names` and no schema.
#[cfg(test)]
pub(in crate::object_index) fn spelled_property(
    hit: &WalkHit,
    names: &dyn RowNames,
) -> ReferenceProperty {
    HitNames::resolve(std::iter::once(hit), names, None).property(&hit.steps)
}

/// What the tables and the schema spell for one walk's hits, asked once per table.
struct HitNames<'s>(Lens<'s>);

impl<'s> HitNames<'s> {
    fn resolve<'h>(
        hits: impl Iterator<Item = &'h WalkHit>,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'s>>,
    ) -> Self {
        let mut wanted = Wanted::default();
        for hit in hits {
            wanted.entries.push(hit.object);
            wanted.classes.push(hit.class);
            for step in &hit.steps {
                match step {
                    HitStep::Field { field, .. } => wanted.fields.push(*field),
                    HitStep::Key {
                        hash: Some(hash), ..
                    } => wanted.values.push(*hash),
                    HitStep::Key { .. } | HitStep::Index(_) => {}
                }
            }
        }

        Self(Lens {
            named: wanted.resolve(names, schema),
            schema,
        })
    }

    /// One file's hits as a group, its objects in natural path order and the unnamed last.
    fn group(&self, asset: AssetRef, file: String, hits: &[WalkHit]) -> ReferenceGroup {
        let mut objects: Vec<ReferenceHit> = hits.iter().map(|hit| self.hit(hit)).collect();
        objects.sort_by(|a, b| {
            let unnamed = |hit: &ReferenceHit| hit.path == hit.object_hash;
            unnamed(a)
                .cmp(&unnamed(b))
                .then_with(|| compare_names(&a.path, &b.path))
        });
        ReferenceGroup {
            asset,
            file,
            objects,
        }
    }

    fn hit(&self, hit: &WalkHit) -> ReferenceHit {
        ReferenceHit {
            object_hash: hex(hit.object),
            path: self.0.named.entry(hit.object).0,
            class_hash: hex(hit.class),
            class: self
                .0
                .named
                .classes
                .get(&hit.class)
                .cloned()
                .unwrap_or_else(|| hex(hit.class)),
            property: Some(self.property(&hit.steps)),
        }
    }

    /// The row's hash path and its readable path, the way the bin document writes a row's.
    fn property(&self, steps: &[HitStep]) -> ReferenceProperty {
        let mut path = HashPath::default();
        let mut label = String::new();
        for step in steps {
            match step {
                HitStep::Field { class, field } => {
                    path = path.field(*field);
                    if !label.is_empty() {
                        label.push('.');
                    }
                    label.push_str(&self.0.field(Some(*class), *field).0);
                }
                HitStep::Index(index) => {
                    path = path.index(*index);
                    let _ = write!(label, "[{index}]");
                }
                HitStep::Key {
                    text,
                    hash,
                    occurrence,
                } => {
                    path = path.key(&EntryKey::new(text.to_string(), *occurrence));
                    label.push('{');
                    match hash {
                        Some(hash) => match self.0.named.values.get(hash) {
                            Some(name) => write_json_string(&mut label, name),
                            None => label.push_str(&hex(*hash)),
                        },
                        None => label.push_str(text),
                    }
                    label.push('}');
                    if *occurrence > 0 {
                        let _ = write!(label, "#{occurrence}");
                    }
                }
            }
        }
        ReferenceProperty {
            path: path.into(),
            label,
        }
    }
}
