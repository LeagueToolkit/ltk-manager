use super::*;
use crate::events::NullEventSink;
use crate::hashtables::LayeredHashDb;
use assert_matches::assert_matches;
use std::sync::Arc;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    elsewhere: PathBuf,
    workshop: Workshop,
    config: Config,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workshop");
    let elsewhere = dir.path().join("elsewhere");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&elsewhere).unwrap();

    let config = Config {
        workshop_path: Some(root.clone()),
        ..Config::default()
    };

    Fixture {
        _dir: dir,
        root,
        elsewhere,
        workshop: Workshop::new(Arc::new(NullEventSink)),
        config,
    }
}

fn resolver() -> WadPathResolver {
    WadPathResolver::new(LayeredHashDb::new())
}

fn write_project(dir: &Path, name: &str) {
    fs::create_dir_all(dir.join("content").join("base")).unwrap();
    let mut project = blank_project();
    project.name = name.to_string();
    project.display_name = name.to_string();
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string(&project).unwrap(),
    )
    .unwrap();
}

/// A cslol-style install: `META/info.json`, one unpacked WAD directory and loose `RAW/` files.
fn write_fantome_folder(dir: &Path) {
    fs::create_dir_all(dir.join("META")).unwrap();
    fs::write(
        dir.join("META").join("info.json"),
        r#"{"Name":"Vi Battle Queen","Author":"Moga","Version":"2.0.0","Description":""}"#,
    )
    .unwrap();

    let wad = dir.join("WAD").join("Vi.wad.client").join("assets");
    fs::create_dir_all(&wad).unwrap();
    fs::write(wad.join("vi.bin"), b"bin").unwrap();

    fs::create_dir_all(dir.join("RAW")).unwrap();
    fs::write(dir.join("RAW").join("loose.txt"), b"raw").unwrap();
}

fn path_arg(path: &Path) -> String {
    path.display().to_string()
}

#[test]
fn a_folder_with_a_config_inspects_as_a_project() {
    let f = fixture();
    let dir = f.elsewhere.join("ahri");
    write_project(&dir, "ahri");

    let inspection = f
        .workshop
        .inspect_folder(&f.config, &path_arg(&dir))
        .unwrap();

    assert_matches!(inspection, FolderInspection::Project { project } => {
        assert_eq!(project.location, ProjectLocation::Opened);
    });
}

#[test]
fn a_cslol_install_inspects_as_a_fantome_folder() {
    let f = fixture();
    let dir = f.elsewhere.join("vi");
    write_fantome_folder(&dir);

    let inspection = f
        .workshop
        .inspect_folder(&f.config, &path_arg(&dir))
        .unwrap();

    assert_matches!(inspection, FolderInspection::Fantome { layout } => {
        assert_eq!(layout.display_name, "Vi Battle Queen");
        assert_eq!(layout.suggested_name, "vi-battle-queen");
        assert_eq!(layout.author.as_deref(), Some("Moga"));
        assert!(layout.has_raw);
        assert_eq!(layout.wads, vec![FolderWad { name: "Vi.wad.client".into(), packed: false }]);
    });
}

#[test]
fn a_folder_of_mods_inspects_as_a_parent() {
    let f = fixture();
    write_project(&f.elsewhere.join("ahri"), "ahri");
    write_fantome_folder(&f.elsewhere.join("vi"));
    fs::create_dir_all(f.elsewhere.join("unrelated")).unwrap();

    let inspection = f
        .workshop
        .inspect_folder(&f.config, &path_arg(&f.elsewhere))
        .unwrap();

    assert_matches!(inspection, FolderInspection::Parent { projects, fantome } => {
        assert_eq!(projects.len(), 1);
        assert_eq!(fantome.len(), 1);
    });
}

#[test]
fn an_empty_folder_inspects_as_plain_and_a_gone_one_as_missing() {
    let f = fixture();
    let dir = f.elsewhere.join("My Mod");
    fs::create_dir_all(&dir).unwrap();

    assert_matches!(
        f.workshop.inspect_folder(&f.config, &path_arg(&dir)).unwrap(),
        FolderInspection::Plain { suggested_name, .. } => assert_eq!(suggested_name, "my-mod")
    );
    assert_matches!(
        f.workshop
            .inspect_folder(&f.config, &path_arg(&f.elsewhere.join("gone")))
            .unwrap(),
        FolderInspection::Missing
    );
}

#[test]
fn opening_an_outside_folder_lists_it_beside_the_workshop_folder() {
    let f = fixture();
    write_project(&f.root.join("smolder"), "smolder");
    let outside = f.elsewhere.join("ahri");
    write_project(&outside, "ahri");

    let opened = f
        .workshop
        .open_folder(&f.config, &path_arg(&outside))
        .unwrap();
    let projects = f.workshop.get_projects(&f.config).unwrap();

    assert_eq!(opened.location, ProjectLocation::Opened);
    assert!(opened.last_opened.is_some());
    assert_eq!(projects.len(), 2);
    assert_eq!(f.workshop.opened_folders().len(), 1);
}

#[test]
fn opening_a_workshop_folder_child_adds_nothing_to_the_list() {
    let f = fixture();
    let inside = f.root.join("smolder");
    write_project(&inside, "smolder");

    let opened = f
        .workshop
        .open_folder(&f.config, &path_arg(&inside))
        .unwrap();

    assert_eq!(opened.location, ProjectLocation::Workshop);
    assert!(f.workshop.opened_folders().is_empty());
    assert_eq!(f.workshop.get_projects(&f.config).unwrap().len(), 1);
}

#[test]
fn projects_list_without_a_workshop_folder() {
    let f = fixture();
    let outside = f.elsewhere.join("ahri");
    write_project(&outside, "ahri");
    let config = Config::default();

    f.workshop
        .open_folder(&config, &path_arg(&outside))
        .unwrap();

    assert_eq!(f.workshop.get_projects(&config).unwrap().len(), 1);
}

#[test]
fn two_opened_projects_with_one_name_keep_two_ids() {
    let f = fixture();
    let first = f.elsewhere.join("a").join("ahri");
    let second = f.elsewhere.join("b").join("ahri");
    write_project(&first, "ahri");
    write_project(&second, "ahri");

    let a = f
        .workshop
        .open_folder(&f.config, &path_arg(&first))
        .unwrap();
    let b = f
        .workshop
        .open_folder(&f.config, &path_arg(&second))
        .unwrap();

    assert_eq!(a.name, b.name);
    assert_ne!(a.id, b.id);
}

#[test]
fn converting_a_cslol_install_in_place_restructures_it() {
    let f = fixture();
    let dir = f.elsewhere.join("vi");
    write_fantome_folder(&dir);

    let project = f
        .workshop
        .convert_folder(
            &f.config,
            ConvertFolderArgs {
                path: path_arg(&dir),
                name: "vi-battle-queen".into(),
                display_name: "Vi Battle Queen".into(),
                placement: ConvertPlacement::InPlace,
            },
            &resolver(),
        )
        .unwrap();

    let base = dir.join("content").join("base");
    assert!(
        base.join("Vi.wad.client")
            .join("assets")
            .join("vi.bin")
            .is_file()
    );
    assert!(base.join("raw").join("loose.txt").is_file());
    assert!(!dir.join("WAD").exists(), "the emptied WAD directory goes");
    assert!(dir.join("META").join("info.json").is_file(), "META stays");
    assert_eq!(project.display_name, "Vi Battle Queen");
    assert_eq!(project.version, "2.0.0");
    assert_eq!(project.location, ProjectLocation::Opened);
    assert_eq!(f.workshop.opened_folders().len(), 1);
}

#[test]
fn converting_as_a_copy_leaves_the_source_alone() {
    let f = fixture();
    let dir = f.elsewhere.join("vi");
    write_fantome_folder(&dir);

    let project = f
        .workshop
        .convert_folder(
            &f.config,
            ConvertFolderArgs {
                path: path_arg(&dir),
                name: "vi".into(),
                display_name: "Vi".into(),
                placement: ConvertPlacement::Copy,
            },
            &resolver(),
        )
        .unwrap();

    assert!(dir.join("WAD").join("Vi.wad.client").is_dir());
    assert!(!dir.join("mod.config.json").exists());
    assert_eq!(project.location, ProjectLocation::Workshop);
    assert!(f.workshop.opened_folders().is_empty());
}

#[test]
fn a_plain_folder_converts_to_an_empty_project() {
    let f = fixture();
    let dir = f.elsewhere.join("fresh");
    fs::create_dir_all(&dir).unwrap();

    let project = f
        .workshop
        .convert_folder(
            &f.config,
            ConvertFolderArgs {
                path: path_arg(&dir),
                name: "fresh".into(),
                display_name: "Fresh".into(),
                placement: ConvertPlacement::InPlace,
            },
            &resolver(),
        )
        .unwrap();

    assert!(dir.join("content").join("base").is_dir());
    assert!(dir.join("README.md").is_file());
    assert_eq!(project.version, "1.0.0");
}

#[test]
fn adding_a_folder_of_mods_reports_each_one() {
    let f = fixture();
    write_project(&f.elsewhere.join("ahri"), "ahri");
    write_fantome_folder(&f.elsewhere.join("vi"));
    fs::create_dir_all(f.elsewhere.join("empty")).unwrap();

    let report = f.workshop.add_folders(
        &f.config,
        vec![
            path_arg(&f.elsewhere.join("ahri")),
            path_arg(&f.elsewhere.join("vi")),
            path_arg(&f.elsewhere.join("empty")),
        ],
        &resolver(),
    );

    assert_eq!(report.added.len(), 2);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(f.workshop.opened_folders().len(), 2);
}

#[test]
fn deleting_an_opened_project_forgets_it() {
    let f = fixture();
    let outside = f.elsewhere.join("ahri");
    write_project(&outside, "ahri");
    f.workshop
        .open_folder(&f.config, &path_arg(&outside))
        .unwrap();

    f.workshop.delete_project(&path_arg(&outside)).unwrap();

    assert!(f.workshop.opened_folders().is_empty());
}

#[test]
fn renaming_an_opened_project_moves_its_entry() {
    let f = fixture();
    let outside = f.elsewhere.join("ahri");
    write_project(&outside, "ahri");
    f.workshop
        .open_folder(&f.config, &path_arg(&outside))
        .unwrap();

    f.workshop
        .rename_project(&path_arg(&outside), "ahri-two")
        .unwrap();

    let folders = f.workshop.opened_folders();
    assert_eq!(folders.len(), 1);
    assert!(!folders[0].missing);
    assert!(folders[0].path.ends_with("ahri-two"));
}

#[test]
fn a_moved_folder_is_missing_until_relocated() {
    let f = fixture();
    let outside = f.elsewhere.join("ahri");
    write_project(&outside, "ahri");
    f.workshop
        .open_folder(&f.config, &path_arg(&outside))
        .unwrap();

    let moved = f.elsewhere.join("moved");
    fs::rename(&outside, &moved).unwrap();
    assert!(f.workshop.opened_folders()[0].missing);
    assert!(f.workshop.get_projects(&f.config).unwrap().is_empty());

    f.workshop
        .relocate_folder(&f.config, &path_arg(&outside), &path_arg(&moved))
        .unwrap();

    assert!(!f.workshop.opened_folders()[0].missing);
    assert_eq!(f.workshop.get_projects(&f.config).unwrap().len(), 1);
}
