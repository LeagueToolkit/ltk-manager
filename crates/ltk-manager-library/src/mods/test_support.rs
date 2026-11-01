//! Fixture builders shared by the unit tests in `mods` and `workshop`.
//!
//! Index fixtures are verbose, and a copy per test module drifts away from the
//! real defaults. The archive builders are shared because both modules import
//! a fantome through the same importer.

use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::analysis::wad_reports::WadReportState;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::slug::ModSlug;
use crate::mods::types::{Profile, ProfileSlug};
use chrono::Utc;
use fs_err as fs;
use ltk_manager_assets::hashtables::WadPathResolverState;
use ltk_manager_assets::test_util::*;
use ltk_manager_base::config::Config;
use ltk_manager_base::events::ModStorage;
use ltk_manager_base::events::{BackendEvent, EventSink, NullEventSink};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

/// A library rooted at `storage_dir`, plus the config that points it there.
///
/// Its hashtables are synced, because a health check refuses to run without
/// them. [`make_library_without_hashtables`] builds a library without them.
pub(crate) fn make_test_library(storage_dir: &Path) -> (ModLibrary, Config) {
    make_library_with_events(storage_dir, Arc::new(NullEventSink))
}

/// [`make_test_library`] with a sink of the caller's choosing, for a test that
/// asserts on the events an operation emits.
pub(crate) fn make_library_with_events(
    storage_dir: &Path,
    events: Arc<dyn EventSink>,
) -> (ModLibrary, Config) {
    make_library_with(storage_dir, events, "test", synced_resolver())
}

/// [`make_test_library`] reporting an app version of the caller's choosing, for
/// a test about what changes between manager releases.
pub(crate) fn make_library_with_version(
    storage_dir: &Path,
    app_version: &str,
) -> (ModLibrary, Config) {
    make_library_with(
        storage_dir,
        Arc::new(NullEventSink),
        app_version,
        synced_resolver(),
    )
}

/// [`make_test_library`] on a machine whose shared cache has never been synced.
///
/// A fresh install with no network. A health check does not run on it, instead
/// of recording results it could not compute.
pub(crate) fn make_library_without_hashtables(storage_dir: &Path) -> (ModLibrary, Config) {
    make_library_with(
        storage_dir,
        Arc::new(NullEventSink),
        "test",
        resolver_naming(&[]),
    )
}

/// [`make_test_library`] whose resolver names `paths`, for a test over a mod
/// whose WAD ships packed and whose chunks are addressed by hash.
pub(crate) fn make_library_naming(storage_dir: &Path, paths: &[&str]) -> (ModLibrary, Config) {
    make_library_with(
        storage_dir,
        Arc::new(NullEventSink),
        "test",
        resolver_naming(paths),
    )
}

fn make_library_with(
    storage_dir: &Path,
    events: Arc<dyn EventSink>,
    app_version: &str,
    resolver: ltk_manager_assets::hashtables::WadPathResolver,
) -> (ModLibrary, Config) {
    let library = ModLibrary::new(
        events,
        Some(storage_dir.to_path_buf()),
        app_version,
        Arc::new(crate::mods::ChecksumMismatchState::default()),
        Arc::new(WadReportState::new(Some(storage_dir))),
        Arc::new(WadPathResolverState::preloaded(resolver)),
    );
    let config = Config {
        mod_storage_path: Some(storage_dir.to_path_buf()),
        ..Config::default()
    };
    (library, config)
}

/// A sink that keeps every event it is handed, in order.
#[derive(Default)]
pub(crate) struct RecordingEventSink(parking_lot::Mutex<Vec<BackendEvent>>);

impl RecordingEventSink {
    /// Everything kept, for a test that asserts on a payload rather than a name.
    pub(crate) fn events(&self) -> Vec<BackendEvent> {
        self.0.lock().clone()
    }

    /// The wire names of the emitted events, which a frontend listens on.
    pub(crate) fn names(&self) -> Vec<&'static str> {
        self.0.lock().iter().map(BackendEvent::name).collect()
    }
}

impl EventSink for RecordingEventSink {
    fn emit(&self, event: BackendEvent) {
        self.0.lock().push(event);
    }
}

/// An entry in the pre-slug uuid layout, as a library.json written before the
/// layout migration holds it. Its content is inside `archives/` for every
/// format.
pub(crate) fn make_test_entry(id: &str, format: ModArchiveFormat) -> LibraryModEntry {
    LibraryModEntry {
        id: id.to_string(),
        installed_at: Utc::now(),
        format,
        storage: ModStorage::Archive,
        slug: None,
        harvest: None,
        source_sha256: None,
    }
}

/// An entry in the slug layout, stored the way an install leaves it.
pub(crate) fn make_slugged_entry(
    id: &str,
    slug: &str,
    format: ModArchiveFormat,
) -> LibraryModEntry {
    LibraryModEntry {
        slug: Some(ModSlug::from_dir_name(slug)),
        storage: format.installed_storage(),
        ..make_test_entry(id, format)
    }
}

/// A fantome entry the user unpacked into a mod project after installing.
pub(crate) fn make_unpacked_entry(id: &str, slug: &str) -> LibraryModEntry {
    LibraryModEntry {
        storage: ModStorage::Project,
        ..make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
    }
}

/// Write a `library.json` holding `mods`, all enabled in one profile and all in
/// the root folder.
pub(crate) fn seed_library(library: &ModLibrary, config: &Config, mods: Vec<LibraryModEntry>) {
    let ids: Vec<String> = mods.iter().map(|m| m.id.clone()).collect();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let index = crate::mods::index::LibraryIndex {
        version: 0,
        mods,
        profiles: vec![make_test_profile("p1", "Default", refs.clone(), refs)],
        active_profile_id: "p1".to_string(),
        folders: vec![crate::mods::types::LibraryFolder {
            id: crate::mods::types::ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: ids,
        }],
        folder_order: vec![crate::mods::types::ROOT_FOLDER_ID.to_string()],
    };
    let storage_dir = library.storage_dir(config).unwrap();
    crate::mods::index::document::save_library_index(&storage_dir, &index).unwrap();
}

pub(crate) fn make_test_profile(
    id: &str,
    name: &str,
    mod_order: Vec<&str>,
    enabled: Vec<&str>,
) -> Profile {
    Profile {
        id: id.to_string(),
        name: name.to_string(),
        slug: ProfileSlug::from_name(name).unwrap_or_else(|| ProfileSlug("default".to_string())),
        mod_order: mod_order.into_iter().map(String::from).collect(),
        enabled_mods: enabled.into_iter().map(String::from).collect(),
        layer_states: HashMap::new(),
        created_at: Utc::now(),
        last_used: Utc::now(),
    }
}

/// Place the legacy uuid-layout files so the mod is considered valid:
/// `mods/<id>/mod.config.json` plus `archives/<id>.<ext>`.
pub(crate) fn place_mod_files(storage_dir: &Path, id: &str, format: ModArchiveFormat) {
    let meta_dir = storage_dir.mods_dir().join(id);
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(meta_dir.join("mod.config.json"), "{}").unwrap();

    let archive_dir = storage_dir.archives_dir();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::write(
        archive_dir.join(format!("{}.{}", id, format.extension())),
        b"fake",
    )
    .unwrap();
}

/// Place a mod at `mods/<slug>` the way an install leaves it, with the
/// archive beside it when `with_archive` asks for one.
///
/// The directory holds only the config, and the content is in the archive.
/// [`place_unpacked_mod`] places a mod the user unpacked afterwards.
pub(crate) fn place_installed_mod(
    storage_dir: &Path,
    slug: &str,
    format: ModArchiveFormat,
    with_archive: bool,
) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();

    if with_archive {
        fs::write(
            mods_dir.join(format!("{}.{}", slug, format.extension())),
            b"fake",
        )
        .unwrap();
    }
}

/// Place a fantome the user unpacked at `mods/<slug>`: the config plus a
/// content tree, and the archive beside it when `with_archive` asks for one.
pub(crate) fn place_unpacked_mod(storage_dir: &Path, slug: &str, with_archive: bool) {
    place_installed_mod(storage_dir, slug, ModArchiveFormat::Fantome, with_archive);

    let wad_dir = storage_dir
        .mods_dir()
        .join(slug)
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join("data");
    fs::create_dir_all(&wad_dir).unwrap();
    fs::write(wad_dir.join("skin0.bin"), b"content bytes").unwrap();
}

/// An archive-storage fantome in the slug layout whose packed WAD holds
/// `chunks`.
pub(crate) fn place_packed_chunks_archived_fantome(
    storage_dir: &Path,
    slug: &str,
    chunks: &[(&str, &[u8])],
) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_packed_chunks_fantome_zip(&mods_dir.join(format!("{slug}.fantome")), slug, chunks);
}

/// An archive-storage fantome in the slug layout: a metadata-only mod
/// directory, an archive holding `bin` beside it.
pub(crate) fn place_bin_archived_fantome(storage_dir: &Path, slug: &str, bin: &ltk_meta::Bin) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_bin_fantome_zip(&mods_dir.join(format!("{slug}.fantome")), slug, bin);
}

/// A modpkg in the slug layout: a metadata-only mod directory, a package
/// holding `bin` beside it.
pub(crate) fn place_bin_archived_modpkg(storage_dir: &Path, slug: &str, bin: &ltk_meta::Bin) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_bin_modpkg(&mods_dir.join(format!("{slug}.modpkg")), slug, bin);
}

/// [`place_bin_archived_modpkg`] whose package holds a readme and a license.
pub(crate) fn place_bin_archived_modpkg_with_documents(
    storage_dir: &Path,
    slug: &str,
    bin: &ltk_meta::Bin,
    readme: &str,
    license: &str,
) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_bin_modpkg_with_documents(
        &mods_dir.join(format!("{slug}.modpkg")),
        slug,
        bin,
        readme,
        license,
    );
}

/// An archive-storage fantome whose WAD is packed rather than loose.
///
/// Mods ship in this shape before a repack, and its chunks are addressed by
/// hash instead of by path.
pub(crate) fn place_packed_bin_archived_fantome(
    storage_dir: &Path,
    slug: &str,
    bin: &ltk_meta::Bin,
) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_packed_bin_fantome_zip(
        &mods_dir.join(format!("{slug}.fantome")),
        slug,
        bin,
        zip::CompressionMethod::Stored,
    );
}

/// [`place_packed_fantome_with_raw`] holding `chunks` rather than one bin.
pub(crate) fn place_packed_chunks_fantome_with_raw(
    storage_dir: &Path,
    slug: &str,
    chunks: &[(&str, &[u8])],
    raw: (&str, &[u8]),
) {
    let mods_dir = storage_dir.mods_dir();
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();

    let packed = build_packed_wad(chunks);
    let file = fs::File::create(mods_dir.join(format!("{slug}.fantome"))).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(slug))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    let (raw_path, raw_bytes) = raw;
    zip.start_file(format!("RAW/{raw_path}"), options).unwrap();
    zip.write_all(raw_bytes).unwrap();

    zip.start_file(
        "WAD/Aatrox.wad.client",
        options.compression_method(zip::CompressionMethod::Stored),
    )
    .unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// [`place_packed_bin_archived_fantome`] carrying a `RAW/` entry beside its WAD.
///
/// A fantome repack writes WAD directories only, so a repack drops the entry
/// and an edit copies it raw. A test tells the two apart by it.
pub(crate) fn place_packed_fantome_with_raw(
    storage_dir: &Path,
    slug: &str,
    bin: &ltk_meta::Bin,
    raw: (&str, &[u8]),
) {
    place_packed_chunks_fantome_with_raw(
        storage_dir,
        slug,
        &[(STALE_BIN_IN_WAD, &bin_bytes(bin))],
        raw,
    );
}

/// A Project-storage fantome: `bin` sits in the unpacked tree, and no archive
/// exists beside it.
pub(crate) fn place_bin_project_mod(storage_dir: &Path, slug: &str, bin: &ltk_meta::Bin) {
    place_bin_project(&storage_dir.mods_dir().join(slug), slug, bin);
}

/// [`place_bin_project_mod`] with the bin under the bare hex an unpack writes a
/// nameless chunk as.
///
/// The tree a fantome import writes when the hashtables name none of the
/// chunks. The file has no extension, so its kind comes from its first bytes,
/// and a repair addresses it by the chunk hash its name spells.
pub(crate) fn place_hex_named_bin_project_mod(
    storage_dir: &Path,
    slug: &str,
    bin: &ltk_meta::Bin,
) -> String {
    let mod_dir = storage_dir.mods_dir().join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();

    let hex = ltk_wad::hex_name(ltk_wad::WadHash::from(STALE_BIN_IN_WAD));
    let wad_dir = mod_dir
        .join("content")
        .join("base")
        .join("Aatrox.wad.client");
    fs::create_dir_all(&wad_dir).unwrap();
    fs::write(wad_dir.join(&hex), bin_bytes(bin)).unwrap();
    hex
}

/// The one property the stale-bin fixture holds, read back out of the mod's
/// unpacked tree.
pub(crate) fn property_in_unpacked_tree(
    storage_dir: &Path,
    slug: &str,
) -> ltk_meta::PropertyValueEnum {
    let bin_path = storage_dir
        .mods_dir()
        .join(slug)
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join(STALE_BIN_IN_WAD);
    let bin = ltk_meta::Bin::from_reader(&mut fs::File::open(&bin_path).unwrap()).unwrap();
    bin.objects
        .get(&STALE_ENTRY)
        .unwrap()
        .properties
        .get(&ICON_AVATAR)
        .unwrap()
        .clone()
}

/// A resolver standing in for a machine whose hashtables are synced.
///
/// Its one name is a path no fixture holds, so it names nothing a test places.
/// It only gives the library tables, which a health check requires.
fn synced_resolver() -> ltk_manager_assets::hashtables::WadPathResolver {
    resolver_naming(&["data/no-fixture-holds-this.bin"])
}
