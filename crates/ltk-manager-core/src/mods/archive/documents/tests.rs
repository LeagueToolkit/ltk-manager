use super::*;
use crate::mods::index::ModArchiveFormat;
use crate::mods::test_support::{
    make_fantome_zip_with_documents, make_modpkg_with_documents, make_slugged_entry,
    make_test_library, make_unpacked_entry, place_installed_mod, seed_library,
};
use fs_err as fs;

/// A library holding one mod at `slug`, with whatever archive `place` writes.
fn library_holding(
    storage: &Path,
    slug: &str,
    format: ModArchiveFormat,
    place: impl FnOnce(&Path),
) -> LibraryModEntry {
    let (library, config) = make_test_library(storage);
    let entry = make_slugged_entry(slug, slug, format);
    place_installed_mod(storage, slug, format, false);
    place(
        &storage
            .join("mods")
            .join(format!("{slug}.{}", format.extension())),
    );
    seed_library(&library, &config, vec![entry.clone()]);
    entry
}

#[test]
fn a_modpkg_readme_is_read_off_disk_without_mounting_anything() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(storage.path(), "cached", ModArchiveFormat::Modpkg, |_| {});
    fs::write(
        storage.path().join("mods").join("cached").join("README.md"),
        "# On disk",
    )
    .unwrap();

    let document = read_readme(storage.path(), &entry);

    assert_eq!(
        document,
        ModDocument::Present {
            text: "# On disk".to_string()
        }
    );
}

#[test]
fn a_modpkg_readme_is_read_out_of_its_archive_when_the_import_wrote_none() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "packed",
        ModArchiveFormat::Modpkg,
        |archive| make_modpkg_with_documents(archive, "packed", Some("# Packed"), None),
    );

    let document = read_readme(storage.path(), &entry);

    assert_eq!(
        document,
        ModDocument::Present {
            text: "# Packed".to_string()
        }
    );
}

#[test]
fn a_fantome_readme_comes_out_of_the_archive_and_is_left_beside_the_mod() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "swapper",
        ModArchiveFormat::Fantome,
        |archive| make_fantome_zip_with_documents(archive, "swapper", Some("# Install me"), None),
    );

    let document = read_readme(storage.path(), &entry);

    assert_eq!(
        document,
        ModDocument::Present {
            text: "# Install me".to_string()
        }
    );
    let cached = storage
        .path()
        .join("mods")
        .join("swapper")
        .join("README.md");
    assert_eq!(fs::read_to_string(cached).unwrap(), "# Install me");
}

/// The second ask never reopens the archive, which is what the cache buys. The
/// archive is deleted between the two so that reading it again would fail.
#[test]
fn a_fantome_readme_is_read_off_disk_once_it_has_been_extracted() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "swapper",
        ModArchiveFormat::Fantome,
        |archive| make_fantome_zip_with_documents(archive, "swapper", Some("# Once"), None),
    );
    read_readme(storage.path(), &entry);
    fs::remove_file(storage.path().join("mods").join("swapper.fantome")).unwrap();

    let document = read_readme(storage.path(), &entry);

    assert_eq!(
        document,
        ModDocument::Present {
            text: "# Once".to_string()
        }
    );
}

#[test]
fn a_mod_whose_author_wrote_no_readme_reads_as_absent() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "bare",
        ModArchiveFormat::Fantome,
        |archive| make_fantome_zip_with_documents(archive, "bare", None, None),
    );

    assert_eq!(read_readme(storage.path(), &entry), ModDocument::Absent);
}

/// A damaged archive means the mod may not work at all, so it cannot read as a
/// mod that merely shipped no documentation.
#[test]
fn an_archive_that_will_not_open_is_told_from_a_mod_with_no_readme() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "broken",
        ModArchiveFormat::Fantome,
        |archive| fs::write(archive, b"not a zip").unwrap(),
    );

    let document = read_readme(storage.path(), &entry);

    assert!(
        matches!(document, ModDocument::Unreadable { .. }),
        "expected an unreadable archive, got {document:?}"
    );
}

#[test]
fn a_fantome_license_is_read_out_of_the_archive_and_not_written_beside_the_mod() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "licensed",
        ModArchiveFormat::Fantome,
        |archive| {
            make_fantome_zip_with_documents(archive, "licensed", None, Some("All rights reserved"))
        },
    );

    let document = read_license(storage.path(), &entry);

    assert_eq!(
        document,
        ModDocument::Present {
            text: "All rights reserved".to_string()
        }
    );
    assert!(
        !storage
            .path()
            .join("mods")
            .join("licensed")
            .join("LICENSE")
            .exists(),
        "a license is read transiently and never cached"
    );
}

#[test]
fn a_modpkg_license_is_read_out_of_its_own_chunk() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "licensed",
        ModArchiveFormat::Modpkg,
        |archive| make_modpkg_with_documents(archive, "licensed", None, Some("MIT-ish, honestly")),
    );

    assert_eq!(
        read_license(storage.path(), &entry),
        ModDocument::Present {
            text: "MIT-ish, honestly".to_string()
        }
    );
}

/// A mod that names a license and ships no file is the common case, and the
/// whole reason the gallery tells three states apart rather than two.
#[test]
fn a_mod_that_ships_no_license_file_reads_as_absent() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(
        storage.path(),
        "unlicensed",
        ModArchiveFormat::Modpkg,
        |archive| make_modpkg_with_documents(archive, "unlicensed", None, None),
    );

    assert_eq!(read_license(storage.path(), &entry), ModDocument::Absent);
}

/// Unpacking deletes the archive, because the tree is the mod from then on. A
/// mod stored that way is documented by whatever its tree carries, and every
/// unpacked mod reading as damaged is the fourth state the panel does not have.
#[test]
fn an_unpacked_mod_carries_only_what_its_tree_holds() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let entry = make_unpacked_entry("unpacked", "unpacked");
    place_installed_mod(storage.path(), "unpacked", ModArchiveFormat::Fantome, false);
    seed_library(&library, &config, vec![entry.clone()]);

    assert_eq!(read_readme(storage.path(), &entry), ModDocument::Absent);
    assert_eq!(read_license(storage.path(), &entry), ModDocument::Absent);
}

#[test]
fn an_unpacked_mod_reads_the_readme_its_tree_holds() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let entry = make_unpacked_entry("unpacked", "unpacked");
    place_installed_mod(storage.path(), "unpacked", ModArchiveFormat::Fantome, false);
    seed_library(&library, &config, vec![entry.clone()]);
    fs::write(
        storage
            .path()
            .join("mods")
            .join("unpacked")
            .join("README.md"),
        "# Unpacked",
    )
    .unwrap();

    assert_eq!(
        read_readme(storage.path(), &entry),
        ModDocument::Present {
            text: "# Unpacked".to_string()
        }
    );
}

/// A packed mod is its archive, so one that has gone missing is a mod that may
/// not work at all rather than a mod whose author shipped no documentation.
#[test]
fn a_packed_mod_whose_archive_is_gone_reads_as_unreadable() {
    let storage = tempfile::tempdir().unwrap();
    let entry = library_holding(storage.path(), "gone", ModArchiveFormat::Fantome, |_| {});

    let document = read_readme(storage.path(), &entry);

    assert!(
        matches!(document, ModDocument::Unreadable { .. }),
        "expected a missing archive to read as unreadable, got {document:?}"
    );
}

#[test]
fn an_id_no_mod_answers_to_is_an_error_rather_than_an_empty_document() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    seed_library(&library, &config, Vec::new());

    assert!(library.get_mod_readme(&config, "nobody").is_err());
}
