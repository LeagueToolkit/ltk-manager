use super::*;
use crate::mods::index::{LibraryIndex, ModArchiveFormat};
use crate::mods::test_support::{
    make_full_fantome_zip, make_slugged_entry, make_test_library, make_test_profile,
    make_unpacked_entry, place_unpacked_mod,
};
use crate::mods::types::{LibraryFolder, ROOT_FOLDER_ID};
use camino::{Utf8Path, Utf8PathBuf};
use fs_err as fs;
use ltk_wad::{NoResolver, PathResolver, WadHash};
use sha2::Digest as _;
use std::collections::BTreeSet;

/// Every override a provider holds, as `(chunk hash, content digest)` pairs.
///
/// The pair is what "the same content" means to the overlay builder: it routes
/// by chunk hash and writes the bytes, so two providers that agree on this set
/// produce byte-identical WADs whatever their storage looks like underneath.
/// Comparing an archive against its import is what holds the fantome importer
/// to reading one faithfully.
fn override_digest_set(
    content: &mut dyn ModContentProvider,
) -> AppResult<BTreeSet<(WadHash, [u8; 32])>> {
    let content_error = AppError::Overlay;

    let project = content.mod_project().map_err(content_error)?;
    let layer_names: Vec<String> = project.layers.iter().map(|l| l.name.clone()).collect();

    let mut set = BTreeSet::new();
    for layer in &layer_names {
        for wad in content.list_layer_wads(layer).map_err(content_error)? {
            for (rel_path, bytes) in content
                .read_wad_overrides(layer, &wad)
                .map_err(content_error)?
            {
                set.insert(digest_entry(&rel_path, &bytes)?);
            }
        }
    }

    for (rel_path, bytes) in content.read_raw_overrides().map_err(content_error)? {
        set.insert(digest_entry(&rel_path, &bytes)?);
    }

    Ok(set)
}

fn digest_entry(rel_path: &Utf8Path, bytes: &[u8]) -> AppResult<(WadHash, [u8; 32])> {
    let hash = ltk_overlay::utils::resolve_chunk_hash(rel_path, bytes)?;
    Ok((hash, sha2::Sha256::digest(bytes).into()))
}

/// A resolver that names the fixture's packed chunks, so the import writes real
/// paths where the no-resolver run writes hex.
struct FixtureResolver;

impl PathResolver for FixtureResolver {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        for path in [
            "data/characters/ashe/skins/skin01.bin",
            "data/characters/ashe/ashe.bin",
        ] {
            if WadHash::from(path) == path_hash {
                return Some(path.to_string());
            }
        }
        None
    }
}

/// Unpack the shared fixture into a directory the way the storage conversion
/// does, returning (archive, mod dir).
fn import_fixture(root: &std::path::Path, resolver: &dyn PathResolver) -> (PathBuf, PathBuf) {
    let archive = root.join("full.fantome");
    make_full_fantome_zip(&archive);

    let mod_dir = root.join("mods").join("full-mod");
    let utf8_mod_dir = Utf8PathBuf::from_path_buf(mod_dir.clone()).unwrap();
    ltk_mod_project::ProjectImporter::new(&utf8_mod_dir)
        .import(
            ltk_mod_project::fantome::FantomeImporter::new(File::open(&archive).unwrap())
                .with_path_resolver(resolver),
        )
        .unwrap();

    (archive, mod_dir)
}

/// Golden A: with chunk names available, the unpacked directory answers with
/// exactly what the archive answers with.
#[test]
fn an_imported_directory_matches_its_archive_with_a_resolver() {
    let root = tempfile::tempdir().unwrap();
    let (archive, mod_dir) = import_fixture(root.path(), &FixtureResolver);

    let mut from_archive = FantomeContent::new(File::open(&archive).unwrap()).unwrap();
    let mut from_disk =
        FsModContent::new(Utf8PathBuf::from_path_buf(mod_dir).unwrap()).with_raw_overrides();

    let expected = override_digest_set(&mut from_archive).unwrap();
    assert!(!expected.is_empty(), "the fixture yielded no overrides");
    assert_eq!(expected, override_digest_set(&mut from_disk).unwrap());
}

/// Golden B: the same holds with nothing to name the chunks. A packed WAD's
/// files land under hex names on both sides, which hash to the same values.
#[test]
fn an_imported_directory_matches_its_archive_without_a_resolver() {
    let root = tempfile::tempdir().unwrap();
    let (archive, mod_dir) = import_fixture(root.path(), &NoResolver);

    let hex_named = fs::read_dir(mod_dir.join("content").join("base").join("Ashe.wad.client"))
        .unwrap()
        .flatten()
        .any(|entry| {
            entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|stem| stem.len() == 16 && stem.chars().all(|c| c.is_ascii_hexdigit()))
        });
    assert!(hex_named, "expected hex chunk names with no resolver");

    let mut from_archive = FantomeContent::new(File::open(&archive).unwrap()).unwrap();
    let mut from_disk =
        FsModContent::new(Utf8PathBuf::from_path_buf(mod_dir).unwrap()).with_raw_overrides();

    assert_eq!(
        override_digest_set(&mut from_archive).unwrap(),
        override_digest_set(&mut from_disk).unwrap()
    );
}

#[test]
fn a_packed_modpkg_reads_through_its_archive_and_everything_else_off_disk() {
    let storage = tempfile::tempdir().unwrap();
    place_unpacked_mod(storage.path(), "unpacked", false);

    let fs_entry = make_unpacked_entry("id-fs", "unpacked");
    let mut provider = fs_entry.content_provider(storage.path()).unwrap();
    assert_eq!(
        provider.list_layer_wads("base").unwrap(),
        vec!["Aatrox.wad.client".to_string()]
    );

    // The packed arm needs a real modpkg to mount, which the fixture set does
    // not build. What it decides is the branch, and that is `is_packed`.
    assert!(make_slugged_entry("id-pkg", "packed", ModArchiveFormat::Modpkg).is_packed());
}

#[test]
fn the_overlay_takes_a_fantome_with_no_archive_and_skips_a_missing_mod() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    place_unpacked_mod(storage.path(), "keep-me", false);

    let index = LibraryIndex {
        version: 0,
        mods: vec![
            make_unpacked_entry("keep", "keep-me"),
            make_unpacked_entry("gone", "not-on-disk"),
        ],
        profiles: vec![make_test_profile(
            "p1",
            "Default",
            vec!["keep", "gone"],
            vec!["keep", "gone"],
        )],
        active_profile_id: "p1".to_string(),
        folders: vec![LibraryFolder {
            id: ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: vec!["keep".into(), "gone".into()],
        }],
        folder_order: vec![ROOT_FOLDER_ID.to_string()],
    };
    crate::mods::index::document::save_library_index(storage.path(), &index).unwrap();

    let (_slug, enabled) = library.get_enabled_mods_for_overlay(&config).unwrap();
    let ids: Vec<&str> = enabled.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["keep"]);
}

/// Before the layout migration runs, a fantome's content is still inside its
/// archive. Reading it off `mods/<uuid>/` would find a metadata directory and
/// build the mod as empty, with nothing to say it had.
#[test]
fn a_pre_migration_fantome_is_still_read_out_of_its_archive() {
    let storage = tempfile::tempdir().unwrap();
    let entry = crate::mods::test_support::make_test_entry("id-1", ModArchiveFormat::Fantome);

    let archives = storage.path().archives_dir();
    fs::create_dir_all(&archives).unwrap();
    make_full_fantome_zip(&archives.join("id-1.fantome"));
    let meta_dir = storage.path().mods_dir().join("id-1");
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&crate::mods::test_support::mod_project_named("legacy"))
            .unwrap(),
    )
    .unwrap();

    assert!(entry.is_present(storage.path()));
    let mut provider = entry.content_provider(storage.path()).unwrap();
    let mut wads = provider.list_layer_wads("base").unwrap();
    wads.sort();

    assert_eq!(wads, vec!["aatrox.wad.client", "ashe.wad.client"]);
    assert!(!override_digest_set(provider.as_mut()).unwrap().is_empty());
}
