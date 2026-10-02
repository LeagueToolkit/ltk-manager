use super::*;
use crate::mods::index::ModStorage;
use crate::mods::test_support::{
    make_named_fantome_zip, make_test_library, make_test_profile, place_installed_mod,
    place_mod_files,
};
use crate::mods::types::LibraryFolder;
use assert_matches::assert_matches;
use ltk_wad::NoResolver;

fn context() -> InstallContext<'static> {
    InstallContext {
        resolver: &NoResolver,
    }
}

fn fantome_with_hashtable(path: &Path, content: &[u8]) {
    crate::mods::test_support::make_missing_hashtable_fantome_zip(path);

    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .unwrap();
    let mut zip = zip::ZipWriter::new_append(file).unwrap();
    zip.start_file(
        "meta/HASHES/GAME.hashes.txt",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(content).unwrap();
    zip.finish().unwrap();
}

#[test]
fn bom_prefixed_hashtables_keep_their_names_when_installed_and_unpacked() {
    for newline in ["\n", "\r\n"] {
        let storage = tempfile::tempdir().unwrap();
        let (library, config) = make_test_library(storage.path());
        let source = tempfile::tempdir().unwrap();
        let archive = source.path().join("bom.fantome");
        let table = format!("\u{feff}data/skin0.bin{newline}assets/custom/second.tex{newline}");
        fantome_with_hashtable(&archive, table.as_bytes());
        let original = fs::read(&archive).unwrap();

        let installed = library
            .install_mod_from_package(&config, archive.to_str().unwrap())
            .unwrap();
        library
            .set_mod_storage(&config, &installed.id, ModStorage::Project)
            .unwrap();

        let mod_dir = PathBuf::from(&installed.mod_dir);
        let project = load_mod_project(&mod_dir).unwrap();
        let table = ltk_hashtable::Hashtable::from_reader(
            fs::File::open(mod_dir.join(&project.hashtables[0].path)).unwrap(),
        )
        .unwrap();
        assert_eq!(
            table.names().collect::<Vec<_>>(),
            ["data/skin0.bin", "assets/custom/second.tex"]
        );
        assert_eq!(
            fs::read(mod_dir.join("content/base/Ashe.wad.client/data/skin0.bin")).unwrap(),
            b"PROP"
        );
        assert_eq!(fs::read(&archive).unwrap(), original);
    }
}

#[test]
fn a_hashtable_containing_only_a_bom_installs_as_an_empty_table() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("empty-table.fantome");
    fantome_with_hashtable(&archive, b"\xef\xbb\xbf");

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();

    let mut reader =
        ltk_fantome::FantomeReader::new(fs::File::open(staged.staged_archive).unwrap()).unwrap();
    let tables = reader.read_hashtables().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].1.names().count(), 0);
}

#[test]
fn stripping_a_bom_does_not_hide_invalid_hashtable_content() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("invalid-table.fantome");
    fantome_with_hashtable(&archive, b"\xef\xbb\xbfdata/skin0.bin\ninvalid\x00name\n");

    let result = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context());

    assert!(result.is_err());
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 0);
}

fn install(storage: &Path, archive: &Path) -> AppResult<LibraryModEntry> {
    let mut index = LibraryIndex::default();
    let staged = stage_mod_package(storage, archive.to_str().unwrap(), &context())?;
    let mut taken = TakenSlugs::collect(&index, &storage.mods_dir());
    let (entry, _) = register_staged_mod(storage, &mut index, staged, &mut taken)?;
    Ok(entry)
}

/// An extension nothing recognizes is read as a fantome, which is what
/// `stage_mod_package` documents. Guessing modpkg instead would hand the
/// archive to the modpkg provider, and a modpkg is not convertible, so nothing
/// afterwards can undo the guess.
#[test]
fn an_archive_whose_extension_names_nothing_is_read_as_a_fantome() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("renamed.bak");
    make_named_fantome_zip(&archive, "Renamed Mod");

    let entry = install(storage.path(), &archive).unwrap();

    assert_eq!(entry.format, ModArchiveFormat::Fantome);
    assert_eq!(entry.storage, ModStorage::Archive);
    assert!(entry.format.is_convertible());
}

#[test]
fn staging_a_missing_file_fails_before_anything_is_written() {
    let storage = tempfile::tempdir().unwrap();
    let result = stage_mod_package(storage.path(), "/nonexistent/file.fantome", &context())
        .map(|staged| staged.id);
    assert_matches!(result, Err(AppError::InvalidPath(_)));
}

/// A fantome stages as its archive plus a metadata directory: the content
/// stays inside the file, so no tree is written. ADR-0007.
#[test]
fn a_staged_fantome_holds_its_metadata_and_its_archive() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();

    assert!(staged.staging_dir.join("mod.config.json").exists());
    assert!(!staged.staging_dir.join("content").exists());

    assert!(staged.staged_archive.is_file());
    assert_eq!(staged.staged_archive.parent(), staged.staging_dir.parent());
}

/// Fantome tools routinely write CRC32 values that describe nothing, and a
/// reader that trusts them refuses the archive outright — which is the whole
/// install failing on a mod that is perfectly readable.
#[test]
fn a_fantome_installs_despite_checksums_that_describe_nothing() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("bad-crc.fantome");
    crate::mods::test_support::make_bad_crc_fantome_zip(&archive);

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();

    assert!(staged.staging_dir.join("mod.config.json").exists());
    assert!(staged.staged_archive.is_file());
}

/// The archive is where the mod's own names live from here on, so the copy
/// into the library is the preserve: names the resolver cannot recover are
/// embedded on the way in.
#[test]
fn staging_embeds_unrecoverable_names_in_the_archive() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();

    let mut reader =
        ltk_fantome::FantomeReader::new(fs::File::open(&staged.staged_archive).unwrap()).unwrap();
    let tables = reader.read_hashtables().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(
        tables[0].1.names().collect::<Vec<_>>(),
        ["data/characters/aatrox/skins/skin01.bin"]
    );
}

/// Import is where a fantome's packed WADs become `Stored`, so a build can map
/// them straight out of the archive instead of inflating them into memory.
/// Upstream ADR-0002: normalize runs at import, on the copy the importer owns,
/// never on the file the user handed in.
#[test]
fn staging_stores_a_fantomes_packed_wads() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);
    let shipped_bytes = fs::read(&archive).unwrap();

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();

    let mut zip = zip::ZipArchive::new(fs::File::open(&staged.staged_archive).unwrap()).unwrap();
    assert_eq!(
        zip.by_name("WAD/Ashe.wad.client").unwrap().compression(),
        zip::CompressionMethod::Stored
    );

    assert_eq!(fs::read(&archive).unwrap(), shipped_bytes);

    let staged_path = camino::Utf8PathBuf::from_path_buf(staged.staged_archive.clone()).unwrap();
    assert_matches!(
        ltk_fantome::normalize_archive(&staged_path, &staged_path),
        Ok(ltk_fantome::NormalizeOutcome::Unchanged)
    );
}

/// The community tables are the preserve's exclusions: a name they already
/// recover is not worth embedding, and a mod made only of such names keeps
/// its archive byte-identical to what the author shipped. The fixture is
/// normalized first, since an archive shipping deflated packed WADs is
/// rewritten to `Stored` on the way in regardless of names.
#[test]
fn a_mod_the_resolver_covers_keeps_its_archive_unrewritten() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);
    let archive_utf8 = camino::Utf8PathBuf::from_path_buf(archive.clone()).unwrap();
    ltk_fantome::normalize_archive(&archive_utf8, &archive_utf8).unwrap();

    let resolver =
        crate::mods::test_support::resolver_naming(&["data/characters/aatrox/skins/skin01.bin"]);
    let context = InstallContext {
        resolver: &resolver,
    };

    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context).unwrap();

    assert_eq!(
        fs::read(&staged.staged_archive).unwrap(),
        fs::read(&archive).unwrap()
    );
}

#[test]
fn registering_puts_the_archive_beside_the_slug_directory() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("test.fantome");
    make_named_fantome_zip(&archive, "Kept Copy");

    let entry = install(storage.path(), &archive).unwrap();

    assert_eq!(
        entry.archive_path(storage.path()),
        storage.path().mods_dir().join("kept-copy.fantome")
    );
    assert!(entry.archive_path(storage.path()).is_file());
}

/// The archive holds the name as firmly as the directory does, or the next mod
/// slugging the same way would inherit it.
#[test]
fn a_leftover_archive_keeps_its_slug_from_being_reused() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("test.fantome");
    make_named_fantome_zip(&archive, "Orphan");

    let mods_dir = storage.path().mods_dir();
    fs::create_dir_all(&mods_dir).unwrap();
    fs::write(mods_dir.join("orphan.fantome"), b"leftover").unwrap();

    let entry = install(storage.path(), &archive).unwrap();
    assert_eq!(entry.slug.as_ref().unwrap().as_str(), "orphan-2");
    assert_eq!(
        fs::read(mods_dir.join("orphan.fantome")).unwrap(),
        b"leftover"
    );
}

/// Names the preserve embedded survive a later unpack: the unpacked tree holds
/// the declared table and the manifest names it, so the project carries its own
/// names wherever it goes next.
#[test]
fn harvested_names_land_in_the_unpacked_projects_hashes_directory() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);

    let installed = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    library
        .set_mod_storage(&config, &installed.id, ModStorage::Project)
        .unwrap();

    let mod_dir = PathBuf::from(&installed.mod_dir);
    let table = fs::read_to_string(mod_dir.join("hashes").join("game.hashes.txt")).unwrap();
    assert!(table.contains("data/characters/aatrox/skins/skin01.bin"));

    let project = load_mod_project(&mod_dir).unwrap();
    assert_eq!(project.hashtables.len(), 1);
    assert_eq!(project.hashtables[0].path, "hashes/game.hashes.txt");
}

/// A packed WAD whose only name record is a bin inside it round-trips to a
/// named file: the preserve harvests the name into the archive's table, and
/// a later unpack names the chunk from the mod's own table rather than hex.
#[test]
fn a_packed_chunk_named_only_by_its_own_bin_unpacks_under_that_name() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("packed.fantome");
    let recovered_path = "assets/custom/recovered.tex";
    crate::mods::test_support::make_bin_named_chunk_fantome_zip(&archive, recovered_path);

    let installed = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    library
        .set_mod_storage(&config, &installed.id, ModStorage::Project)
        .unwrap();

    let wad_dir = PathBuf::from(&installed.mod_dir)
        .join("content")
        .join("base")
        .join("Ashe.wad.client");
    assert!(
        wad_dir.join("assets/custom/recovered.tex").is_file(),
        "chunk should unpack under its harvested name"
    );
}

/// What a preserve found outlives the import: the index remembers it, and the
/// mod the frontend receives carries it. A mod that preserved cleanly and one
/// that arrived already lossy are told apart by `unharvestable` alone.
#[test]
fn the_harvest_is_recorded_on_the_entry_and_the_installed_mod() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("full.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);

    let installed = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();

    let expected = crate::mods::index::HarvestSummary {
        names_added: 1,
        unharvestable: 2,
    };
    assert_eq!(installed.harvest, Some(expected));
    library
        .with_index(&config, |_storage, index| {
            assert_eq!(index.mods[0].harvest, Some(expected));
            Ok(())
        })
        .unwrap();
}

#[test]
fn registering_moves_staging_into_the_slug_directory_and_records_the_mod() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("test.fantome");
    make_named_fantome_zip(&archive, "Dark Cosmic Jhin");

    let mut index = LibraryIndex::default();
    let staged = stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).unwrap();
    let mut taken = TakenSlugs::collect(&index, &storage.path().mods_dir());
    let (entry, installed) =
        register_staged_mod(storage.path(), &mut index, staged, &mut taken).unwrap();

    assert_eq!(entry.slug.as_ref().unwrap().as_str(), "dark-cosmic-jhin");
    assert!(
        entry
            .mod_dir(storage.path())
            .join("mod.config.json")
            .exists()
    );
    assert!(
        !storage
            .path()
            .join("mods")
            .join(format!("{STAGING_PREFIX}{}", entry.id))
            .exists()
    );

    assert_eq!(index.mods.len(), 1);
    assert_eq!(installed.display_name, "Dark Cosmic Jhin");
    assert!(installed.enabled);

    let profile = &index.profiles[0];
    assert_eq!(profile.mod_order, vec![entry.id.clone()]);
    assert_eq!(profile.enabled_mods, vec![entry.id.clone()]);
    assert!(index.folders[0].mod_ids.contains(&entry.id));
}

#[test]
fn two_mods_with_one_name_get_distinct_directories() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    let mut paths = Vec::new();
    for i in 0..3 {
        let archive = source.path().join(format!("copy-{i}.fantome"));
        make_named_fantome_zip(&archive, "Same Name");
        paths.push(archive.to_str().unwrap().to_string());
    }

    let result = library.install_mods_from_packages(&config, &paths).unwrap();
    assert!(result.failed.is_empty());
    assert_eq!(result.installed.len(), 3);

    let dirs: std::collections::HashSet<String> =
        result.installed.iter().map(|m| m.mod_dir.clone()).collect();
    assert_eq!(dirs.len(), 3);
}

#[test]
fn a_modpkg_always_keeps_its_archive() {
    let storage = tempfile::tempdir().unwrap();
    place_installed_mod(storage.path(), "packed", ModArchiveFormat::Modpkg, true);

    let entry =
        crate::mods::test_support::make_slugged_entry("id-1", "packed", ModArchiveFormat::Modpkg);
    assert!(entry.archive_path(storage.path()).exists());
}

#[test]
fn a_failed_stage_leaves_nothing_behind() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("corrupt.fantome");
    fs::write(&archive, b"not a zip").unwrap();

    assert!(stage_mod_package(storage.path(), archive.to_str().unwrap(), &context()).is_err());

    let leftovers: Vec<_> = fs::read_dir(storage.path().mods_dir())
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    assert!(leftovers.is_empty(), "staging directory was left behind");
}

#[test]
fn uninstall_removes_the_mod_directory_and_scrubs_every_reference() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("test.fantome");
    make_named_fantome_zip(&archive, "Doomed");

    let installed = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    let mod_dir = PathBuf::from(&installed.mod_dir);
    let retained = storage.path().mods_dir().join("doomed.fantome");
    assert!(mod_dir.is_dir());
    assert!(retained.is_file());

    library
        .set_mod_layers(
            &config,
            &installed.id,
            std::collections::HashMap::from([("base".to_string(), true)]),
        )
        .unwrap();

    library.uninstall_mod_by_id(&config, &installed.id).unwrap();

    assert!(!mod_dir.exists());
    assert!(!retained.exists());
    library
        .with_index(&config, |_storage, index| {
            assert!(index.mods.is_empty());
            assert!(index.profiles[0].mod_order.is_empty());
            assert!(index.profiles[0].enabled_mods.is_empty());
            assert!(index.profiles[0].layer_states.is_empty());
            assert!(index.folders[0].mod_ids.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn uninstalling_a_legacy_entry_clears_both_of_its_old_paths() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_mod_files(storage.path(), "legacy", ModArchiveFormat::Modpkg);

    let entry = crate::mods::test_support::make_test_entry("legacy", ModArchiveFormat::Modpkg);
    seed_index(&library, &config, vec![entry.clone()]);

    library.uninstall_mod_by_id(&config, "legacy").unwrap();
    assert!(!entry.mod_dir(storage.path()).exists());
    assert!(!entry.archive_path(storage.path()).exists());
}

/// Write an index holding exactly `mods`, with one profile that names them all.
fn seed_index(library: &ModLibrary, config: &Config, mods: Vec<LibraryModEntry>) {
    let ids: Vec<String> = mods.iter().map(|m| m.id.clone()).collect();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let index = LibraryIndex {
        version: 0,
        mods,
        profiles: vec![make_test_profile(
            "p1",
            "Default",
            refs.clone(),
            refs.clone(),
        )],
        active_profile_id: "p1".to_string(),
        folders: vec![LibraryFolder {
            id: ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: ids,
        }],
        folder_order: vec![ROOT_FOLDER_ID.to_string()],
    };
    let storage_dir = library.storage_dir(config).unwrap();
    crate::mods::index::document::save_library_index(&storage_dir, &index).unwrap();
}

/// The importer resets an imported project to one default layer, which would
/// silently drop a fantome's own layers and every string override on them.
#[test]
fn a_fantome_keeps_the_layers_its_metadata_declares() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("layered.fantome");
    crate::mods::test_support::make_layered_fantome_zip(&archive);

    let entry = install(storage.path(), &archive).unwrap();
    let project = load_mod_project(&entry.mod_dir(storage.path())).unwrap();

    let names: Vec<&str> = project.layers.iter().map(|l| l.name.as_str()).collect();
    assert!(names.contains(&"base"), "the base layer is always present");
    assert!(names.contains(&"high_res"));

    let high_res = project
        .layers
        .iter()
        .find(|l| l.name == "high_res")
        .unwrap();
    assert_eq!(high_res.display_name.as_deref(), Some("High Res"));
    assert_eq!(
        high_res.string_overrides["en_us"]["game_character_displayname_Ashe"],
        "Frost Archer"
    );
}

#[test]
fn an_update_keeps_identity_folders_and_every_profiles_choices() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("original.fantome");
    make_named_fantome_zip(&archive, "Original");
    let (library, config) = make_test_library(storage.path());
    let original = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    let before = library
        .mutate_index(&config, |_, index| {
            index.profiles[0].enabled_mods.clear();
            index.profiles[0].layer_states.insert(
                original.id.clone(),
                std::collections::HashMap::from([
                    ("base".to_owned(), false),
                    ("removed".to_owned(), true),
                ]),
            );
            index.profiles.push(make_test_profile(
                "other",
                "Other",
                vec![&original.id],
                vec![&original.id],
            ));
            index.folders[0].mod_ids.clear();
            index.folders.push(LibraryFolder {
                id: "custom".to_owned(),
                name: "Custom".to_owned(),
                mod_ids: vec![original.id.clone()],
            });
            Ok(index.clone())
        })
        .unwrap();
    let replacement = source.path().join("replacement.fantome");
    make_named_fantome_zip(&replacement, "Replacement");

    let updated = library
        .update_mod_from_package(&config, &original.id, replacement.to_str().unwrap())
        .unwrap();

    assert_eq!(updated.id, original.id);
    assert_eq!(updated.mod_dir, original.mod_dir);
    assert_eq!(updated.display_name, "Replacement");
    assert_eq!(updated.folder_id.as_deref(), Some("custom"));
    assert!(!updated.enabled);
    library
        .with_index(&config, |_, index| {
            assert_eq!(index.mods.len(), 1);
            assert_eq!(index.mods[0].installed_at, before.mods[0].installed_at);
            assert_eq!(
                serde_json::to_value(&index.folders).unwrap(),
                serde_json::to_value(&before.folders).unwrap()
            );
            for (after, before) in index.profiles.iter().zip(&before.profiles) {
                assert_eq!(after.mod_order, before.mod_order);
                assert_eq!(after.enabled_mods, before.enabled_mods);
            }
            let states = &index.profiles[0].layer_states[&original.id];
            assert_eq!(states.get("base"), Some(&false));
            assert!(!states.contains_key("removed"));
            Ok(())
        })
        .unwrap();
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 2);
}

#[test]
fn a_failed_index_save_restores_the_old_archive_and_metadata() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("original.fantome");
    make_named_fantome_zip(&archive, "Original");
    let (library, config) = make_test_library(storage.path());
    let original = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    let old_archive = storage.path().join("mods/original.fantome");
    let old_bytes = fs::read(&old_archive).unwrap();
    let old_index = fs::read(storage.path().join("library.json")).unwrap();
    make_named_fantome_zip(&archive, "Replacement");
    fs::create_dir(storage.path().join(".library.json.tmp")).unwrap();

    assert!(
        library
            .update_mod_from_package(&config, &original.id, archive.to_str().unwrap())
            .is_err()
    );

    assert_eq!(fs::read(old_archive).unwrap(), old_bytes);
    assert_eq!(
        fs::read(storage.path().join("library.json")).unwrap(),
        old_index
    );
    assert_eq!(
        load_mod_project(Path::new(&original.mod_dir))
            .unwrap()
            .display_name,
        "Original"
    );
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 2);
}

#[test]
fn an_invalid_update_leaves_the_old_mod_usable() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("original.fantome");
    make_named_fantome_zip(&archive, "Original");
    let (library, config) = make_test_library(storage.path());
    let original = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    fs::write(&archive, b"invalid archive").unwrap();

    assert!(
        library
            .update_mod_from_package(&config, &original.id, archive.to_str().unwrap())
            .is_err()
    );
    assert_eq!(
        library.get_installed_mods(&config).unwrap()[0].display_name,
        "Original"
    );
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 2);
}

#[test]
fn updating_an_unknown_id_discards_staging_without_installing_a_mod() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("replacement.fantome");
    make_named_fantome_zip(&archive, "Replacement");
    let (library, config) = make_test_library(storage.path());

    assert!(matches!(
        library.update_mod_from_package(&config, "missing", archive.to_str().unwrap()),
        Err(AppError::ModNotFound(_))
    ));
    assert!(library.get_installed_mods(&config).unwrap().is_empty());
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 0);
}

#[test]
fn an_update_can_change_archive_format_without_leaving_the_old_archive() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("original.fantome");
    make_named_fantome_zip(&archive, "Original");
    let (library, config) = make_test_library(storage.path());
    let original = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    let replacement = source.path().join("replacement.modpkg");
    crate::mods::test_support::make_modpkg(&replacement, "Replacement");

    let updated = library
        .update_mod_from_package(&config, &original.id, replacement.to_str().unwrap())
        .unwrap();

    assert_eq!(updated.id, original.id);
    assert_eq!(updated.format, ModArchiveFormat::Modpkg);
    assert!(!storage.path().join("mods/original.fantome").exists());
    assert!(storage.path().join("mods/original.modpkg").is_file());
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 2);
}

#[test]
fn an_update_replaces_an_unpacked_mod_with_the_new_archive() {
    let storage = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let archive = source.path().join("original.fantome");
    crate::mods::test_support::make_full_fantome_zip(&archive);
    let (library, config) = make_test_library(storage.path());
    let original = library
        .install_mod_from_package(&config, archive.to_str().unwrap())
        .unwrap();
    library
        .set_mod_storage(&config, &original.id, ModStorage::Project)
        .unwrap();
    assert!(Path::new(&original.mod_dir).join("content").is_dir());
    make_named_fantome_zip(&archive, "Replacement");

    let updated = library
        .update_mod_from_package(&config, &original.id, archive.to_str().unwrap())
        .unwrap();

    assert_eq!(updated.id, original.id);
    assert_eq!(updated.storage, ModStorage::Archive);
    assert!(!Path::new(&updated.mod_dir).join("content").exists());
    assert_eq!(updated.display_name, "Replacement");
    assert_eq!(fs::read_dir(storage.path().mods_dir()).unwrap().count(), 2);
}
