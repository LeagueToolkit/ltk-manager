use super::*;
use crate::events::NullEventSink;
use crate::hashtables::{LayeredHashDb, WadPathResolver};
use crate::mods::test_support::{make_bad_crc_fantome_zip, make_full_fantome_zip};
use assert_matches::assert_matches;
use parking_lot::Mutex;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

/// A workshop rooted at `dir`, plus the config that points it there.
fn make_workshop(dir: &Path) -> (Workshop, Config) {
    let config = Config {
        workshop_path: Some(dir.to_path_buf()),
        ..Config::default()
    };
    (Workshop::new(Arc::new(NullEventSink)), config)
}

fn import_args(archive: &Path, name: &str) -> ImportFantomeArgs {
    ImportFantomeArgs {
        file_path: archive.display().to_string(),
        name: name.to_string(),
        display_name: "Chosen Name".to_string(),
    }
}

fn empty_resolver() -> WadPathResolver {
    WadPathResolver::new(LayeredHashDb::new())
}

fn import(workshop: &Workshop, config: &Config, archive: &Path, name: &str) -> PathBuf {
    workshop
        .import_from_fantome(config, import_args(archive, name), &empty_resolver())
        .unwrap();
    config.workshop_path.clone().unwrap().join(name)
}

/// A single-pixel PNG, so the importer has something it can really decode.
fn png_bytes() -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::RgbaImage::new(1, 1)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

/// An archive spelling `wad/` in lower case, with a license and a
/// thumbnail under `META/`.
fn make_lowercase_fantome_zip(path: &Path) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("meta/info.json", options).unwrap();
    zip.write_all(br#"{"Name":"Lower Mod","Author":"Author","Version":"1.0.0","Description":"d"}"#)
        .unwrap();

    zip.start_file("wad/Aatrox.wad.client/data/skin0.bin", options)
        .unwrap();
    zip.write_all(b"skin bytes").unwrap();

    zip.start_file("META/LICENSE", options).unwrap();
    zip.write_all(b"The terms.").unwrap();

    zip.start_file("META/image.png", options).unwrap();
    zip.write_all(&png_bytes()).unwrap();

    zip.finish().unwrap();
}

// ── import_from_fantome ──

#[test]
fn import_writes_raw_entries_under_the_base_layer() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("full.fantome");
    make_full_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project = import(&workshop, &config, &archive, "full-mod");

    assert!(
        project
            .join("content/base/raw/assets/maps/map11/scene.bin")
            .is_file()
    );
}

#[test]
fn import_finds_a_lower_case_wad_prefix() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("lower.fantome");
    make_lowercase_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project = import(&workshop, &config, &archive, "lower-mod");

    assert!(
        project
            .join("content/base/Aatrox.wad.client/data/skin0.bin")
            .is_file()
    );
}

#[test]
fn import_writes_the_license_and_a_webp_thumbnail() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("lower.fantome");
    make_lowercase_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project = import(&workshop, &config, &archive, "lower-mod");

    assert_eq!(fs::read(project.join("LICENSE")).unwrap(), b"The terms.");
    assert!(project.join("thumbnail.webp").is_file());
    assert!(!project.join("thumbnail.png").exists());
}

/// Fantome tools in the wild write checksums that describe nothing, so an
/// import that trusts them rejects archives users really have.
#[test]
fn import_reads_an_archive_whose_checksums_are_wrong() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("bad-crc.fantome");
    make_bad_crc_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project = import(&workshop, &config, &archive, "bad-crc-mod");

    assert_eq!(
        fs::read(
            project.join("content/base/Aatrox.wad.client/data/characters/aatrox/skins/skin01.bin")
        )
        .unwrap(),
        b"aatrox skin bytes"
    );
}

#[test]
fn import_names_the_project_after_the_dialog_not_the_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("full.fantome");
    make_full_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project = import(&workshop, &config, &archive, "chosen-slug");

    let written = load_mod_project_json(&project);
    assert_eq!(written.name, "chosen-slug");
    assert_eq!(written.display_name, "Chosen Name");
}

#[test]
fn a_failed_import_reports_it_and_leaves_no_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("not-a-zip.fantome");
    fs::write(&archive, b"not a zip at all").unwrap();
    let workshop = Workshop::new(Arc::new(RecordingStages::default()));
    let config = Config {
        workshop_path: Some(tmp.path().to_path_buf()),
        ..Config::default()
    };

    let result =
        workshop.import_from_fantome(&config, import_args(&archive, "broken"), &empty_resolver());

    assert_matches!(result, Err(AppError::Fantome(_)));
    assert!(!tmp.path().join("broken").exists());
}

/// One progress event, flattened so a whole run compares in one assert.
type Reported = (FantomeImportStage, Option<String>, u32, u32);

/// A sink that keeps only the fantome progress, which is what the import
/// dialog's bar is driven from.
#[derive(Default)]
struct RecordingStages(Mutex<Vec<Reported>>);

impl crate::events::EventSink for RecordingStages {
    fn emit(&self, event: BackendEvent) {
        if let BackendEvent::FantomeImportProgress(progress) = event {
            self.0.lock().push((
                progress.stage,
                progress.current_item,
                progress.current,
                progress.total,
            ));
        }
    }
}

#[test]
fn import_reports_one_stage_per_unit_then_finalizing_and_complete() {
    use FantomeImportStage::{Complete, Extracting, Finalizing};

    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("full.fantome");
    make_full_fantome_zip(&archive);
    let stages = Arc::new(RecordingStages::default());
    let workshop = Workshop::new(Arc::clone(&stages) as Arc<dyn crate::events::EventSink>);
    let config = Config {
        workshop_path: Some(tmp.path().to_path_buf()),
        ..Config::default()
    };

    workshop
        .import_from_fantome(
            &config,
            import_args(&archive, "full-mod"),
            &empty_resolver(),
        )
        .unwrap();

    let recorded = stages.0.lock().clone();
    assert_eq!(
        recorded,
        [
            (Extracting, Some("Aatrox.wad.client".to_string()), 0, 3),
            (Extracting, Some("Ashe.wad.client".to_string()), 1, 3),
            /* Every `RAW/` entry unpacks in one pass, so they are one unit. */
            (Extracting, Some("RAW".to_string()), 2, 3),
            /* The metadata files, which have no count of their own. */
            (Finalizing, None, 3, 3),
            (Complete, None, 3, 3),
        ]
    );
}

/// Refused before the import runs, so there is no half-written project to
/// remove and no progress bar that opened and then reported nothing.
#[test]
fn a_fantome_import_past_the_path_limit_is_refused_and_leaves_no_project() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("full.fantome");
    make_full_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let _limit = long_paths::test_limit::just_past(&tmp.path().join("full-mod"), 20);
    let result = workshop.import_from_fantome(
        &config,
        import_args(&archive, "full-mod"),
        &empty_resolver(),
    );

    assert_matches!(result, Err(AppError::ValidationFailed(_)));
    assert!(!tmp.path().join("full-mod").exists());
}

/// The estimate cannot see past a packed WAD, so a resolver that names its
/// chunks is caught by the pass over what actually landed — and the project
/// that pass condemns is removed with it.
#[test]
fn a_resolved_chunk_past_the_limit_takes_the_project_with_it() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("packed.fantome");
    crate::mods::test_support::make_long_chunk_fantome_zip(&archive);
    let (workshop, config) = make_workshop(tmp.path());

    let project_dir = tmp.path().join("packed-mod");
    let predicted = long_paths::longest_fantome_import_path(&archive, &project_dir).unwrap();
    let resolver =
        crate::mods::test_support::resolver_naming(&[crate::mods::test_support::LONG_CHUNK_PATH]);

    let _limit = long_paths::test_limit::of(predicted + 20);
    let result =
        workshop.import_from_fantome(&config, import_args(&archive, "packed-mod"), &resolver);

    assert_matches!(result, Err(AppError::ValidationFailed(_)));
    assert!(!project_dir.exists());
}

// ── import_from_modpkg ──

/// A package whose project carried a readme, so the import has a meta chunk
/// to place as well as content under a layer.
fn make_modpkg_with_readme(path: &Path, name: &str) {
    let source = tempfile::tempdir().unwrap();
    let wad_dir = source
        .path()
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join("data");
    fs::create_dir_all(&wad_dir).unwrap();
    fs::write(wad_dir.join("skin0.bin"), b"content bytes").unwrap();
    fs::write(source.path().join("README.md"), b"how it works").unwrap();
    fs::write(
        source.path().join("mod.config.json"),
        serde_json::to_string_pretty(&crate::mods::test_support::mod_project_named(name)).unwrap(),
    )
    .unwrap();

    let project_dir = camino::Utf8PathBuf::from_path_buf(source.path().to_path_buf()).unwrap();
    let writer = std::io::BufWriter::new(fs::File::create(path).unwrap());
    ltk_mod_project::ProjectPacker::new(
        crate::mods::test_support::mod_project_named(name),
        project_dir,
    )
    .pack(ltk_mod_project::modpkg::ModpkgFormat::new(writer))
    .unwrap();
}

/// A package stores which WAD a chunk belonged to, and an import that
/// flattened that away would pack back into a project the game reads
/// differently.
///
/// The directory is lower case because that is the spelling the package holds.
/// A modpkg records a WAD as a `WadNameHash` beside a name, and only the
/// normalized name hashes to it, so the original casing is not in the file to
/// recover. A fantome keeps its entry paths verbatim and comes back capitalized.
#[test]
fn a_modpkg_import_keeps_each_chunk_under_its_wad() {
    let tmp = tempfile::tempdir().unwrap();
    let package = tmp.path().join("packed-mod.modpkg");
    make_modpkg_with_readme(&package, "packed-mod");
    let (workshop, config) = make_workshop(tmp.path());

    workshop
        .import_from_modpkg(&config, &package.display().to_string())
        .unwrap();

    let base = tmp.path().join("packed-mod").join("content").join("base");
    /* Listed rather than reached through a joined path, because a
    case-insensitive filesystem answers one built with the wrong spelling and
    leaves the difference to show up only where the suite runs elsewhere. */
    let wads: Vec<String> = fs::read_dir(&base)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();

    assert_eq!(wads, ["aatrox.wad.client"]);
    assert_eq!(
        fs::read(
            base.join("aatrox.wad.client")
                .join("data")
                .join("skin0.bin")
        )
        .unwrap(),
        b"content bytes"
    );
}

/// The readme is a project's, not a layer's, so a copy of it inside
/// `content/` would be packed back as game content.
#[test]
fn a_modpkg_import_leaves_no_metadata_inside_the_content_tree() {
    let tmp = tempfile::tempdir().unwrap();
    let package = tmp.path().join("packed-mod.modpkg");
    make_modpkg_with_readme(&package, "packed-mod");
    let (workshop, config) = make_workshop(tmp.path());

    workshop
        .import_from_modpkg(&config, &package.display().to_string())
        .unwrap();

    let project = tmp.path().join("packed-mod");
    assert_eq!(
        fs::read(project.join("README.md")).unwrap(),
        b"how it works"
    );
    assert!(!project.join("content/README.md").exists());
}

#[test]
fn a_modpkg_whose_project_already_exists_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let package = tmp.path().join("packed-mod.modpkg");
    make_modpkg_with_readme(&package, "packed-mod");
    let (workshop, config) = make_workshop(tmp.path());
    let file_path = package.display().to_string();

    workshop.import_from_modpkg(&config, &file_path).unwrap();

    assert_matches!(
        workshop.import_from_modpkg(&config, &file_path),
        Err(AppError::ProjectAlreadyExists(_))
    );
}

/// A package's own name picks the directory, so how long the import's paths
/// will be is only knowable once its metadata has been read.
#[test]
fn a_modpkg_import_past_the_path_limit_is_refused_and_leaves_no_project() {
    let tmp = tempfile::tempdir().unwrap();
    let package = tmp.path().join("packed-mod.modpkg");
    make_modpkg_with_readme(&package, "packed-mod");
    let (workshop, config) = make_workshop(tmp.path());

    let _limit = long_paths::test_limit::just_past(&tmp.path().join("packed-mod"), 20);
    let result = workshop.import_from_modpkg(&config, &package.display().to_string());

    assert_matches!(result, Err(AppError::ValidationFailed(_)));
    assert!(!tmp.path().join("packed-mod").exists());
}

// ── peek_fantome ──

#[test]
fn peek_lists_the_wads_whatever_case_the_prefix_is_in() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("lower.fantome");
    make_lowercase_fantome_zip(&archive);
    let (workshop, _) = make_workshop(tmp.path());

    let peeked = workshop
        .peek_fantome(&archive.display().to_string())
        .unwrap();

    assert_eq!(peeked.wad_files, ["Aatrox.wad.client"]);
    assert_eq!(peeked.name, "Lower Mod");
    assert_eq!(peeked.suggested_name, "lower-mod");
}

#[test]
fn peek_sorts_wads_in_natural_order() {
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("many.fantome");
    let file = fs::File::create(&archive).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(br#"{"Name":"M","Author":"A","Version":"1","Description":"d"}"#)
        .unwrap();
    for name in ["Map11.wad.client", "Map10.wad.client", "Map9.wad.client"] {
        zip.start_file(format!("WAD/{name}/data.bin"), options)
            .unwrap();
        zip.write_all(b"x").unwrap();
    }
    zip.finish().unwrap();
    let (workshop, _) = make_workshop(tmp.path());

    let peeked = workshop
        .peek_fantome(&archive.display().to_string())
        .unwrap();

    assert_eq!(
        peeked.wad_files,
        ["Map9.wad.client", "Map10.wad.client", "Map11.wad.client"]
    );
}

fn load_mod_project_json(project_dir: &Path) -> ModProject {
    let contents = fs::read_to_string(project_dir.join("mod.config.json")).unwrap();
    serde_json::from_str(&contents).unwrap()
}

// ── parse_github_url ──

#[test]
fn parse_github_url_valid_https() {
    let (owner, repo) = parse_github_url("https://github.com/owner/repo").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}

#[test]
fn parse_github_url_trailing_slash() {
    let (owner, repo) = parse_github_url("https://github.com/owner/repo/").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}

#[test]
fn parse_github_url_with_git_suffix() {
    let (owner, repo) = parse_github_url("https://github.com/owner/repo.git").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}

#[test]
fn parse_github_url_with_whitespace() {
    let (owner, repo) = parse_github_url("  https://github.com/owner/repo  ").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}

#[test]
fn parse_github_url_http_also_works() {
    let (owner, repo) = parse_github_url("http://github.com/owner/repo").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}

#[test]
fn parse_github_url_non_github_host_rejected() {
    let result = parse_github_url("https://gitlab.com/owner/repo");
    assert_matches!(result, Err(AppError::ValidationFailed(_)));
}

#[test]
fn parse_github_url_missing_repo() {
    let result = parse_github_url("https://github.com/owner");
    assert_matches!(result, Err(AppError::ValidationFailed(_)));
}

#[test]
fn parse_github_url_empty_string() {
    let result = parse_github_url("");
    assert_matches!(result, Err(AppError::ValidationFailed(_)));
}

#[test]
fn parse_github_url_extra_path_segments_rejected() {
    let result = parse_github_url("https://github.com/owner/repo/tree/main");
    assert_matches!(result, Err(AppError::ValidationFailed(_)));
}

#[test]
fn parse_github_url_trailing_slash_and_git() {
    let (owner, repo) = parse_github_url("https://github.com/owner/repo.git/").unwrap();
    assert_eq!(owner, "owner");
    assert_eq!(repo, "repo");
}
