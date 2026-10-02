//! Fixture builders shared by the unit tests in `mods` and `workshop`.
//!
//! Index fixtures are verbose, and a copy per test module drifts away from the
//! real defaults. The archive builders are shared because both modules import
//! a fantome through the same importer.

use crate::config::Config;
use crate::events::{BackendEvent, EventSink, NullEventSink};
use crate::hashtables::WadPathResolverState;
use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::analysis::linked_bins::LinkedBinState;
use crate::mods::analysis::wad_reports::WadReportState;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::slug::ModSlug;
use crate::mods::types::{Profile, ProfileSlug};
use chrono::Utc;
use fs_err as fs;
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
    resolver: crate::hashtables::WadPathResolver,
) -> (ModLibrary, Config) {
    let library = ModLibrary::new(
        events,
        Some(storage_dir.to_path_buf()),
        app_version,
        Arc::new(LinkedBinState::default()),
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

/// A project config whose `name` and display name are both `name`, so a slug
/// derived from it is predictable.
pub(crate) fn mod_project_named(name: &str) -> ltk_mod_project::ModProject {
    ltk_mod_project::ModProject {
        name: name.to_string(),
        display_name: name.to_string(),
        version: "1.0.0".to_string(),
        description: String::new(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    }
}

/// Pack a real `.modpkg` at `path`, named `name`, holding one content file.
///
/// A modpkg's archive is the mod, so code that reads one has to mount it. A
/// stub of fake bytes does not exercise that code.
pub(crate) fn make_modpkg(path: &Path, name: &str) {
    make_modpkg_with_documents(path, name, None, None);
}

/// [`make_modpkg`] with a readme and a license in the project root, where a
/// creator's own pack also reads them from.
pub(crate) fn make_modpkg_with_documents(
    path: &Path,
    name: &str,
    readme: Option<&str>,
    license: Option<&str>,
) {
    let source = tempfile::tempdir().unwrap();
    let wad_dir = source
        .path()
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join("data");
    fs::create_dir_all(&wad_dir).unwrap();
    fs::write(wad_dir.join("skin0.bin"), b"content bytes").unwrap();
    fs::write(
        source.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(name)).unwrap(),
    )
    .unwrap();
    if let Some(readme) = readme {
        fs::write(source.path().join("README.md"), readme).unwrap();
    }
    if let Some(license) = license {
        fs::write(source.path().join("LICENSE"), license).unwrap();
    }

    let project_dir = camino::Utf8PathBuf::from_path_buf(source.path().to_path_buf()).unwrap();
    let writer = std::io::BufWriter::new(fs::File::create(path).unwrap());
    ltk_mod_project::ProjectPacker::new(mod_project_named(name), project_dir)
        .pack(ltk_mod_project::modpkg::ModpkgFormat::new(writer))
        .unwrap();
}

/// [`make_named_fantome_zip`] with a readme and a license under `META/`, where
/// a fantome stores its documents and where nothing extracts them.
pub(crate) fn make_fantome_zip_with_documents(
    path: &Path,
    name: &str,
    readme: Option<&str>,
    license: Option<&str>,
) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    if let Some(readme) = readme {
        zip.start_file("META/README.md", options).unwrap();
        zip.write_all(readme.as_bytes()).unwrap();
    }
    if let Some(license) = license {
        zip.start_file("META/LICENSE", options).unwrap();
        zip.write_all(license.as_bytes()).unwrap();
    }

    zip.finish().unwrap();
}

/// Build a minimal but valid fantome archive: a zip whose only entry is
/// `META/info.json`.
pub(crate) fn make_fantome_zip(path: &Path) {
    make_named_fantome_zip(path, "Test Mod");
}

/// [`make_fantome_zip`] with the name the archive reports, which is what a
/// slug is derived from.
pub(crate) fn make_named_fantome_zip(path: &Path, name: &str) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding all three content shapes at once: a
/// directory-style WAD, a packed WAD, and `RAW/`.
///
/// All three shapes are in one archive because the golden tests compare the
/// `(hash, bytes)` set of the archive with the set of its import. A shape the
/// fixture leaves out would pass without being tested.
pub(crate) fn make_full_fantome_zip(path: &Path) {
    make_full_fantome_zip_named(path, "Full Mod");
}

/// [`make_full_fantome_zip`] with the name the archive reports, which is what a
/// slug is derived from.
pub(crate) fn make_full_fantome_zip_named(path: &Path, name: &str) {
    let packed = build_packed_wad(&[
        ("data/characters/ashe/skins/skin01.bin", &[0x11u8; 48][..]),
        ("data/characters/ashe/ashe.bin", &[0x22u8; 32][..]),
    ]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file(
        "WAD/Aatrox.wad.client/data/characters/aatrox/skins/skin01.bin",
        options,
    )
    .unwrap();
    zip.write_all(b"aatrox skin bytes").unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.start_file("RAW/assets/maps/map11/scene.bin", options)
        .unwrap();
    zip.write_all(b"raw scene bytes").unwrap();

    zip.finish().unwrap();
}

/// [`make_full_fantome_zip`] with every CRC32 overwritten by a value that
/// matches nothing.
///
/// Some fantome tools write checksums that do not match the entry bytes, and a
/// reader that trusts them rejects the whole archive. The scan matches header
/// signatures anywhere in the file, so it asserts one local and one central
/// header per entry. A match inside compressed data would overwrite content and
/// change what a test using this fixture tests.
pub(crate) fn make_bad_crc_fantome_zip(path: &Path) {
    const LOCAL_HEADER: u32 = 0x0403_4b50;
    const CENTRAL_HEADER: u32 = 0x0201_4b50;
    const ENTRIES: usize = 4;

    make_full_fantome_zip(path);
    let mut bytes = fs::read(path).unwrap();

    let (mut local, mut central) = (0usize, 0usize);
    let mut i = 0usize;
    while i + 4 <= bytes.len() {
        // CRC32 sits at +14 in a local header and at +16 in a central one.
        let (at, seen) = match u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) {
            LOCAL_HEADER => (14, &mut local),
            CENTRAL_HEADER => (16, &mut central),
            _ => {
                i += 1;
                continue;
            }
        };
        bytes[i + at..i + at + 4].copy_from_slice(&0xDEAD_BEEFu32.to_le_bytes());
        *seen += 1;
        i += 4;
    }

    assert_eq!(local, ENTRIES, "one local header CRC per entry");
    assert_eq!(central, ENTRIES, "one central header CRC per entry");
    fs::write(path, bytes).unwrap();
}

/// A fantome archive whose `META/info.json` declares a second layer with a
/// string override. Only the metadata holds the override, so an import that
/// drops it loses it.
pub(crate) fn make_layered_fantome_zip(path: &Path) {
    let mut info = fantome_info("Layered Mod");
    info.layers.insert(
        "high_res".to_string(),
        ltk_fantome::FantomeLayerInfo {
            name: "high_res".to_string(),
            display_name: Some("High Res".to_string()),
            priority: 10,
            string_overrides: indexmap::IndexMap::from([(
                "en_us".to_string(),
                indexmap::IndexMap::from([(
                    "game_character_displayname_Ashe".to_string(),
                    "Frost Archer".to_string(),
                )]),
            )]),
            game_data: None,
        },
    );

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
        .unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding [`STALE_BIN_IN_WAD`] in three layers: `base_bin`
/// loose under `WAD/`, `layer_bin` loose under `WAD_chroma/`, which the
/// metadata declares as `Chroma`, and `layer_bin` in a packed WAD under
/// `WAD_zeta/`, which the metadata does not declare.
pub(crate) fn make_layer_wads_fantome_zip(
    path: &Path,
    base_bin: &ltk_meta::Bin,
    layer_bin: &ltk_meta::Bin,
) {
    let mut info = fantome_info("Layer WADs");
    info.layers.insert(
        "Chroma".to_string(),
        ltk_fantome::FantomeLayerInfo {
            name: "Chroma".to_string(),
            priority: 5,
            ..Default::default()
        },
    );
    let loose_path = format!("Aatrox.wad.client/{STALE_BIN_IN_WAD}");
    let packed = build_packed_wad(&[(STALE_BIN_IN_WAD, &bin_bytes(layer_bin))]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    let entries = [
        (
            "META/info.json".to_string(),
            serde_json::to_vec_pretty(&info).unwrap(),
        ),
        (format!("WAD/{loose_path}"), bin_bytes(base_bin)),
        (format!("WAD_chroma/{loose_path}"), bin_bytes(layer_bin)),
        ("WAD_zeta/Aatrox.wad.client".to_string(), packed),
    ];
    for (name, bytes) in entries {
        zip.start_file(name, options).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
}

fn fantome_info(name: &str) -> ltk_fantome::FantomeInfo {
    ltk_fantome::FantomeInfo {
        name: name.to_string(),
        author: "Author".to_string(),
        version: "1.0.0".to_string(),
        description: "Description".to_string(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        layers: HashMap::new(),
        ..Default::default()
    }
}

/// A chunk path much longer than the hex name a preflight assumes for a packed
/// WAD, so an import that resolves it writes a longer path than predicted.
pub(crate) const LONG_CHUNK_PATH: &str =
    "data/characters/ashe/skins/skin01/particles/ashe_base_r_cas_ring_glow.troybin";

/// An archive whose only content is a packed WAD holding [`LONG_CHUNK_PATH`].
///
/// The chunk is the longest path the import writes, so any difference between
/// the estimate and the written tree comes from that chunk alone.
pub(crate) fn make_long_chunk_fantome_zip(path: &Path) {
    let packed = build_packed_wad(&[(LONG_CHUNK_PATH, &[0x33u8; 16][..])]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Long Chunk Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/// Where the incompressible chunk sits inside its WAD.
pub(crate) const LARGE_BLOCK_CHUNK_PATH: &str = "data/characters/ashe/blob.bin";

/// An archive whose one packed WAD holds a chunk the first prefix read cannot
/// decode any bytes of.
///
/// A bounded read first takes 16 KB of a chunk raw. A compressed block cannot
/// be decoded until all of it has been read, and this chunk compresses to one
/// block several times that size, so the first read decodes nothing and the
/// larger second read returns the bytes. The return value is the chunk's
/// uncompressed content.
pub(crate) fn make_large_block_chunk_fantome_zip(path: &Path) -> Vec<u8> {
    let bytes = half_entropy_bytes(256 * 1024);

    let mut out = std::io::Cursor::new(Vec::new());
    ltk_wad::WadBuilder::default()
        .with_chunk(
            ltk_wad::WadChunkBuilder::default()
                .with_path(LARGE_BLOCK_CHUNK_PATH)
                .with_force_compression(ltk_wad::WadChunkCompression::Zstd),
        )
        .build_to_writer(&mut out, |_, cursor| {
            cursor.write_all(&bytes)?;
            Ok(())
        })
        .unwrap();

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Large Block Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&out.into_inner()).unwrap();

    zip.finish().unwrap();
    bytes
}

/// Bytes that compress to about half their size, generated from a fixed seed
/// so every run of a test reads the same chunk.
///
/// Each byte holds four bits of entropy. With that, zstd writes a compressed
/// block instead of storing the bytes raw, and the block stays large.
fn half_entropy_bytes(len: usize) -> Vec<u8> {
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state as u8) & 0x0f
        })
        .collect()
}

/// An archive holding a loose WAD file beside a dot-file the directory walk
/// would skip.
///
/// The walk skips any entry whose name starts with a dot, so the archive scan
/// has to skip them too for a tree and an archive to list the same files.
pub(crate) fn make_dot_file_fantome_zip(path: &Path) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Dotted Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client/data/visible.bin", options)
        .unwrap();
    zip.write_all(b"visible").unwrap();
    zip.start_file("WAD/Ashe.wad.client/data/.hidden.bin", options)
        .unwrap();
    zip.write_all(b"hidden").unwrap();

    zip.finish().unwrap();
}

/// An archive whose manifest declares a hashtable file the archive does not
/// hold.
///
/// Its chunks cannot be named the way the manifest declares, so an import
/// refuses it. A check that accepts it names chunks differently from the
/// repair that follows.
pub(crate) fn make_missing_hashtable_fantome_zip(path: &Path) {
    let mut info = fantome_info("Missing Table Mod");
    info.hashtables = vec![ltk_fantome::FantomeHashtable {
        path: "META/hashes/game.hashes.txt".to_string(),
        category: ltk_hashtable::Category::Game,
        algorithm: ltk_hashtable::Algorithm::Xxh64,
        bits: 64,
    }];

    let packed = build_packed_wad(&[("data/skin0.bin", &b"PROP"[..])]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
        .unwrap();
    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/// An archive whose packed WAD holds one texture chunk and one bin, where the
/// bin's strings are the only record of the texture's path.
pub(crate) fn make_bin_named_chunk_fantome_zip(path: &Path, recovered_path: &str) {
    let mut bin = b"PROP".to_vec();
    bin.extend_from_slice(&2u32.to_le_bytes());
    bin.extend_from_slice(&1u32.to_le_bytes());
    bin.extend_from_slice(&(recovered_path.len() as u16).to_le_bytes());
    bin.extend_from_slice(recovered_path.as_bytes());

    let packed = build_packed_wad(&[
        (recovered_path, &b"texture payload"[..]),
        ("data/anonymous.bin", &bin[..]),
    ]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Bin Named Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/* Fixtures for the mod-health tests: a bin the shipped migration table
flags, archives and trees holding it, and a game install that makes the rule
active. The repair and check suites both use them to test the same defect. */

/// `SkinCharacterDataProperties`, the class the shipped migration table keys on.
pub(crate) const SKIN_CLASS: ltk_hash::BinHash = ltk_hash::BinHash(0x9b67_e9f6);
/// The object that holds the stale-bin fixtures' property.
pub(crate) const STALE_ENTRY: ltk_hash::BinHash = ltk_hash::BinHash(0x1234_5678);
/// `iconAvatar`, a field the table moves from `String` to `File`.
pub(crate) const ICON_AVATAR: ltk_hash::BinHash = ltk_hash::BinHash(0x089a_ff69);
pub(crate) const STALE_ICON: &str = "ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds";

/// Where the fixture bin sits, inside the archive and in the unpacked tree.
pub(crate) const STALE_BIN_IN_WAD: &str = "data/skin0.bin";

pub(crate) fn bin_bytes(bin: &ltk_meta::Bin) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A bin still declaring the old `String` shape for a migrated field.
pub(crate) fn stale_bin() -> ltk_meta::Bin {
    bin_holding(ltk_meta::property::values::String::new(
        STALE_ICON.to_owned(),
    ))
}

/// A bin already carrying the migrated shape, which the rules do not report.
pub(crate) fn healthy_bin() -> ltk_meta::Bin {
    use ltk_hash::Hash as _;
    bin_holding(ltk_meta::property::values::WadChunkLink::new(
        ltk_wad::WadHash::hash_str(STALE_ICON),
    ))
}

fn bin_holding(value: impl Into<ltk_meta::PropertyValueEnum>) -> ltk_meta::Bin {
    ltk_meta::Bin::new(
        [ltk_meta::BinObject::builder(STALE_ENTRY, SKIN_CLASS)
            .property(ICON_AVATAR, value)
            .build()],
        std::iter::empty::<&str>(),
    )
}

/// A fantome archive holding one directory-style WAD entry with `bin`'s bytes.
pub(crate) fn make_bin_fantome_zip(path: &Path, name: &str, bin: &ltk_meta::Bin) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("WAD/Aatrox.wad.client/{STALE_BIN_IN_WAD}"), options)
        .unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding `bin` as a loose entry at `at`, verbatim.
///
/// For the paths Riot itself uses that carry no extension, which an archive
/// scan can only identify by reading the entry's head.
pub(crate) fn make_loose_bin_fantome_zip_at(
    path: &Path,
    name: &str,
    at: &str,
    bin: &ltk_meta::Bin,
) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("WAD/{at}"), options).unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding `bin` as a `RAW/` entry.
///
/// An unpack writes `RAW/` entries under the base layer, so a rule sees them,
/// and the archive reader has to list them there too.
pub(crate) fn make_raw_bin_fantome_zip(path: &Path, name: &str, bin: &ltk_meta::Bin) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("RAW/{STALE_BIN_IN_WAD}"), options)
        .unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one WAD is packed into a single entry holding
/// `bin`.
///
/// `compression` picks how the archive reader reaches the WAD: a stored entry
/// is read chunk by chunk in place, and a deflated one is inflated whole first.
pub(crate) fn make_packed_bin_fantome_zip(
    path: &Path,
    name: &str,
    bin: &ltk_meta::Bin,
    compression: zip::CompressionMethod,
) {
    let packed = build_packed_wad(&[(STALE_BIN_IN_WAD, &bin_bytes(bin))]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file(
        "WAD/Aatrox.wad.client",
        options.compression_method(compression),
    )
    .unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one packed WAD holds `bytes` under `chunk_path`.
///
/// The shape of [`make_packed_bin_fantome_zip`] with any chunk content, for a
/// rule about a file that is not a bin.
pub(crate) fn make_packed_chunk_fantome_zip(
    path: &Path,
    name: &str,
    chunk_path: &str,
    bytes: &[u8],
) {
    let packed = build_packed_wad(&[(chunk_path, bytes)]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Aatrox.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one packed WAD holds each of `chunks`.
pub(crate) fn make_packed_chunks_fantome_zip(path: &Path, name: &str, chunks: &[(&str, &[u8])]) {
    let packed = build_packed_wad(chunks);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Aatrox.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
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

/// Put an archive holding `chunks` into the installed game the config points
/// at, for a rule that asks what the install holds.
///
/// `root` is the same directory [`point_at_build`] was given, so both use the
/// same install.
pub(crate) fn place_game_wad(root: &Path, wad_name: &str, chunks: &[(&str, &[u8])]) {
    let final_dir = root.join("league").join("Game").join("DATA").join("FINAL");
    fs::create_dir_all(&final_dir).unwrap();
    fs::write(final_dir.join(wad_name), build_packed_wad(chunks)).unwrap();
}

/// Where the silent-bank fixture sits inside its WAD.
pub(crate) const SILENT_BANK_IN_WAD: &str = "assets/sounds/wwise2016/sfx/ashe_sfx_events.bnk";

/// A Wwise bank at `version` holding `chunks`, each an id and a body length.
///
/// The bodies are zeroes, because the game's reader accepts or rejects a bank
/// by its version and chunk ids, not by chunk contents.
pub(crate) fn audio_bank(version: u32, chunks: &[(&[u8; 4], usize)]) -> Vec<u8> {
    audio_bank_with_id(version, BUILT_BANK_ID, chunks)
}

/// The id a bank the Wwise toolchain built carries.
///
/// Any nonzero value works. A fixture needs a bank that `audio/bank-id` does
/// not report, and the specific number has no meaning.
pub(crate) const BUILT_BANK_ID: u32 = 0x3921_0873;

/// [`audio_bank`] carrying an id of the caller's choosing, for a rule about the
/// id rather than about the version.
pub(crate) fn audio_bank_with_id(version: u32, id: u32, chunks: &[(&[u8; 4], usize)]) -> Vec<u8> {
    let mut header = Vec::new();
    header.extend_from_slice(&version.to_le_bytes());
    header.extend_from_slice(&id.to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());

    let mut out = Vec::new();
    out.extend_from_slice(b"BKHD");
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);

    for (id, length) in chunks {
        out.extend_from_slice(*id);
        out.extend_from_slice(&(*length as u32).to_le_bytes());
        out.resize(out.len() + length, 0);
    }
    out
}

/// A bank the game drops without an error: an older format version with a
/// `HIRC` chunk, which holds its events and which the reader accepts only at
/// the current version.
pub(crate) fn silent_audio_bank() -> Vec<u8> {
    audio_bank(134, &[(b"HIRC", 64)])
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
    let mod_dir = storage_dir.mods_dir().join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();

    let wad_dir = mod_dir
        .join("content")
        .join("base")
        .join("Aatrox.wad.client");
    fs::create_dir_all(wad_dir.join("data")).unwrap();
    fs::write(wad_dir.join(STALE_BIN_IN_WAD), bin_bytes(bin)).unwrap();
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

/// Point the config at a game install on the build the shipped table names,
/// so the rule is active rather than dormant.
pub(crate) fn point_at_installed_build(config: &mut Config, root: &Path) {
    point_at_build(config, root, "16.17.8087655");
}

/// [`point_at_installed_build`] on a build of the caller's choosing, for a test
/// about what changes when the game updates.
pub(crate) fn point_at_build(config: &mut Config, root: &Path, version: &str) {
    let league = root.join("league");
    fs::create_dir_all(league.join("Game")).unwrap();
    fs::write(
        league.join("Game").join("content-metadata.json"),
        format!(r#"{{ "version": "{version}" }}"#),
    )
    .unwrap();
    config.league_path = Some(league);
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
fn synced_resolver() -> crate::hashtables::WadPathResolver {
    resolver_naming(&["data/no-fixture-holds-this.bin"])
}

/// A resolver that names `paths`, so a packed WAD's chunks land under them
/// rather than under the hex names an empty one leaves them at.
pub(crate) fn resolver_naming(paths: &[&str]) -> crate::hashtables::WadPathResolver {
    let mut db = ltk_hashdb::LayeredHashDb::new();
    for path in paths {
        db.insert(ltk_wad::WadHash::from(*path).0, *path);
    }
    crate::hashtables::WadPathResolver::new(db)
}

/// A packed WAD holding `chunks`, as bytes ready to drop into a zip entry.
fn build_packed_wad(chunks: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = ltk_wad::WadBuilder::default();
    for (path, _) in chunks {
        builder = builder.with_chunk(ltk_wad::WadChunkBuilder::default().with_path(*path));
    }

    let by_hash: HashMap<u64, &[u8]> = chunks
        .iter()
        .map(|(path, bytes)| (ltk_wad::WadHash::from(*path).0, *bytes))
        .collect();

    let mut out = std::io::Cursor::new(Vec::new());
    builder
        .build_to_writer(&mut out, |path_hash, cursor| {
            cursor.write_all(by_hash[&path_hash.0])?;
            Ok(())
        })
        .unwrap();
    out.into_inner()
}
