//! Fixture builders shared by the unit tests, `mods` and `workshop` alike.
//!
//! Index-shaped fixtures are verbose enough that duplicating them per test
//! module invites them to drift apart, which would quietly weaken whichever
//! copy stopped matching the real defaults. The archive builders are shared for
//! the same reason across the two surfaces: both import a fantome through the
//! same importer, so both want the same archive to import.

use crate::config::Config;
use crate::events::{BackendEvent, EventSink, NullEventSink};
use crate::hashtables::WadPathResolverState;
use crate::mods::ModLibrary;
use crate::mods::analysis::linked_bins::LinkedBinState;
use crate::mods::analysis::wad_reports::WadReportState;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::slug::ModSlug;
use crate::mods::types::{Profile, ProfileSlug};
use chrono::Utc;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

/// A library rooted at `storage_dir`, plus the config that points it there.
pub(crate) fn make_test_library(storage_dir: &Path) -> (ModLibrary, Config) {
    make_library_with_events(storage_dir, Arc::new(NullEventSink))
}

/// [`make_test_library`] with a sink of the caller's choosing, for a test that
/// asserts on what an operation announced rather than what it wrote.
pub(crate) fn make_library_with_events(
    storage_dir: &Path,
    events: Arc<dyn EventSink>,
) -> (ModLibrary, Config) {
    make_library_with(storage_dir, events, "test")
}

/// [`make_test_library`] reporting an app version of the caller's choosing, for
/// a test about what a manager release moves.
pub(crate) fn make_library_with_version(
    storage_dir: &Path,
    app_version: &str,
) -> (ModLibrary, Config) {
    make_library_with(storage_dir, Arc::new(NullEventSink), app_version)
}

fn make_library_with(
    storage_dir: &Path,
    events: Arc<dyn EventSink>,
    app_version: &str,
) -> (ModLibrary, Config) {
    let library = ModLibrary::new(
        events,
        Some(storage_dir.to_path_buf()),
        app_version,
        Arc::new(LinkedBinState::default()),
        Arc::new(WadReportState::new(Some(storage_dir))),
        Arc::new(WadPathResolverState::preloaded(
            crate::hashtables::WadPathResolver::new(ltk_hashdb::LayeredHashDb::new()),
        )),
    );
    let config = Config {
        mod_storage_path: Some(storage_dir.to_path_buf()),
        ..Config::default()
    };
    (library, config)
}

/// A sink that keeps every event it is handed, in order.
#[derive(Default)]
pub(crate) struct RecordingEventSink(std::sync::Mutex<Vec<BackendEvent>>);

impl RecordingEventSink {
    /// Everything kept, for a test that asserts on a payload rather than a name.
    pub(crate) fn events(&self) -> Vec<BackendEvent> {
        self.0.lock().unwrap().clone()
    }

    /// The wire names of what was emitted, which is what a frontend listens on.
    pub(crate) fn names(&self) -> Vec<&'static str> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(BackendEvent::name)
            .collect()
    }
}

impl EventSink for RecordingEventSink {
    fn emit(&self, event: BackendEvent) {
        self.0.lock().unwrap().push(event);
    }
}

/// An entry in the pre-slug uuid layout, as a library.json written before the
/// layout migration holds it — content still inside `archives/`, whatever the
/// format.
pub(crate) fn make_test_entry(id: &str, format: ModArchiveFormat) -> LibraryModEntry {
    LibraryModEntry {
        id: id.to_string(),
        installed_at: Utc::now(),
        format,
        storage: ModStorage::Archive,
        slug: None,
        fault: None,
        harvest: None,
    }
}

/// An entry in the slug layout.
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
    let meta_dir = storage_dir.join("mods").join(id);
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(meta_dir.join("mod.config.json"), "{}").unwrap();

    let archive_dir = storage_dir.join("archives");
    fs::create_dir_all(&archive_dir).unwrap();
    fs::write(
        archive_dir.join(format!("{}.{}", id, format.extension())),
        b"fake",
    )
    .unwrap();
}

/// Place a mod at `mods/<slug>` in the layout its format calls for, with the
/// archive beside it when `with_archive` asks for one.
///
/// A fantome gets a content tree, because that is where its content is. A
/// modpkg gets the config and nothing else, which is all `extract_modpkg_metadata`
/// writes — the archive holds the rest.
pub(crate) fn place_installed_mod(
    storage_dir: &Path,
    slug: &str,
    format: ModArchiveFormat,
    with_archive: bool,
) {
    let mods_dir = storage_dir.join("mods");
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();

    if format.installed_storage() == ModStorage::Project {
        let wad_dir = mod_dir
            .join("content")
            .join("base")
            .join("Aatrox.wad.client")
            .join("data");
        fs::create_dir_all(&wad_dir).unwrap();
        fs::write(wad_dir.join("skin0.bin"), b"content bytes").unwrap();
    }

    if with_archive {
        fs::write(
            mods_dir.join(format!("{}.{}", slug, format.extension())),
            b"fake",
        )
        .unwrap();
    }
}

/// A project config whose `name` is `name` and whose display name is its
/// title-cased echo, so a slug derived from it is predictable.
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
/// A modpkg's archive is the mod, so anything that reads one has to mount it —
/// a stub of made-up bytes proves nothing about the path under test.
pub(crate) fn make_modpkg(path: &Path, name: &str) {
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

    let project_dir = camino::Utf8PathBuf::from_path_buf(source.path().to_path_buf()).unwrap();
    let writer = std::io::BufWriter::new(fs::File::create(path).unwrap());
    ltk_mod_project::ProjectPacker::new(mod_project_named(name), project_dir)
        .pack(ltk_mod_project::modpkg::ModpkgFormat::new(writer))
        .unwrap();
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
/// Every shape has to be in one archive because the golden tests compare the
/// whole `(hash, bytes)` set an archive yields against the set its import
/// yields — a fixture missing a shape would agree trivially about it.
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
/// Fantome tools in the wild write checksums that do not describe their own
/// bytes, and a reader that trusts them rejects the whole archive. The scan is
/// blind, so it asserts one local and one central header per entry: a signature
/// that matched inside compressed data would clobber content and turn a test
/// using this into a different one.
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

/// A fantome archive whose `META/info.json` declares a second layer carrying a
/// string override, the metadata nothing downstream could recover if an import
/// dropped it.
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

/// A packed WAD holding `chunks`, as bytes ready to drop into a zip entry.
/// A chunk path far longer than the hex name a preflight has to assume for a
/// packed WAD, so an import that resolves it writes past what was predicted.
pub(crate) const LONG_CHUNK_PATH: &str =
    "data/characters/ashe/skins/skin01/particles/ashe_base_r_cas_ring_glow.troybin";

/// An archive whose only content is a packed WAD holding [`LONG_CHUNK_PATH`].
///
/// Nothing else, so that chunk is the longest thing the import writes and the
/// gap between the estimate and the tree is the whole of what a test measures.
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
objects to, archives and trees holding it, and the game install that makes
the rule live. Shared by the repair and check suites, which exercise the
same defect through different seams. */

/// `SkinCharacterDataProperties`, the class the shipped migration table keys on.
pub(crate) const SKIN_CLASS: ltk_hash::BinHash = ltk_hash::BinHash(0x9b67_e9f6);
/// The object the stale-bin fixtures hang their property on.
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

/// A bin already carrying the migrated shape, which the rules stay quiet about.
pub(crate) fn healthy_bin() -> ltk_meta::Bin {
    use ltk_hash::Hash as _;
    bin_holding(ltk_meta::property::values::WadChunkLink::new(
        ltk_wad::WadHash::hash_str(STALE_ICON),
    ))
}

fn bin_holding(value: impl Into<ltk_meta::PropertyValueEnum>) -> ltk_meta::Bin {
    ltk_meta::Bin::new(
        [
            ltk_meta::BinObject::<ltk_meta::property::NoMeta>::builder(STALE_ENTRY, SKIN_CLASS)
                .property(ICON_AVATAR, value)
                .build(),
        ],
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

/// An archive-storage fantome in the slug layout: a metadata-only mod
/// directory, an archive holding `bin` beside it.
pub(crate) fn place_bin_archived_fantome(storage_dir: &Path, slug: &str, bin: &ltk_meta::Bin) {
    let mods_dir = storage_dir.join("mods");
    let mod_dir = mods_dir.join(slug);
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(slug)).unwrap(),
    )
    .unwrap();
    make_bin_fantome_zip(&mods_dir.join(format!("{slug}.fantome")), slug, bin);
}

/// A Project-storage fantome: `bin` sits in the unpacked tree, and no archive
/// exists beside it.
pub(crate) fn place_bin_project_mod(storage_dir: &Path, slug: &str, bin: &ltk_meta::Bin) {
    let mod_dir = storage_dir.join("mods").join(slug);
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

/// Point the config at a game install on the build the shipped table names,
/// so the rule is live rather than dormant.
pub(crate) fn point_at_installed_build(config: &mut Config, root: &Path) {
    point_at_build(config, root, "16.17.8087655");
}

/// [`point_at_installed_build`] on a build of the caller's choosing, for a test
/// about what moves when the game patches.
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
        .join("mods")
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

/// A resolver that names `paths`, so a packed WAD's chunks land under them
/// rather than under the hex names an empty one leaves them at.
pub(crate) fn resolver_naming(paths: &[&str]) -> crate::hashtables::WadPathResolver {
    let mut db = ltk_hashdb::LayeredHashDb::new();
    for path in paths {
        db.insert(ltk_wad::WadHash::from(*path).0, *path);
    }
    crate::hashtables::WadPathResolver::new(db)
}

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
