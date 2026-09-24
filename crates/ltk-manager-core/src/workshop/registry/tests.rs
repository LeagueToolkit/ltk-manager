use super::*;

#[test]
fn a_key_ignores_a_trailing_separator() {
    let bare = ProjectKey::of(Path::new("mods").join("ahri").as_path());
    let trailing = ProjectKey::of(Path::new(&format!(
        "mods{sep}ahri{sep}",
        sep = std::path::MAIN_SEPARATOR
    )));

    assert_eq!(bare, trailing);
    assert_eq!(bare.id(), trailing.id());
}

#[cfg(windows)]
#[test]
fn a_key_ignores_case_and_slash_direction_on_windows() {
    assert_eq!(
        ProjectKey::of(Path::new(r"D:\Mods\Ahri")),
        ProjectKey::of(Path::new("d:/mods/ahri"))
    );
}

#[test]
fn a_folder_below_the_root_is_within_it_and_the_root_is_not() {
    let root = ProjectKey::of(Path::new("workshop"));

    assert!(ProjectKey::of(&Path::new("workshop").join("ahri")).is_within(&root));
    assert!(!ProjectKey::of(Path::new("workshop")).is_within(&root));
    assert!(!ProjectKey::of(Path::new("workshop-two")).is_within(&root));
}

#[test]
fn the_registry_survives_a_reload() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(ProjectRegistry::FILE_NAME);
    let project = dir.path().join("ahri");

    let registry = ProjectRegistry::load(file.clone());
    registry.add(&project, "Ahri").unwrap();
    registry.touch(&project).unwrap();

    let reloaded = ProjectRegistry::load(file);
    let folders = reloaded.opened_folders();

    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].display_name, "Ahri");
    assert!(folders[0].last_opened.is_some());
    assert!(folders[0].missing, "the folder has no config");
}

#[test]
fn adding_a_folder_twice_keeps_one_entry_with_the_newer_name() {
    let registry = ProjectRegistry::default();
    let project = Path::new("ahri");

    registry.add(project, "Ahri").unwrap();
    registry.add(project, "Ahri Recolor").unwrap();

    let folders = registry.opened_folders();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].display_name, "Ahri Recolor");
}

#[test]
fn relocating_carries_the_last_opened_time() {
    let registry = ProjectRegistry::default();
    let old = Path::new("old");
    let new = Path::new("new");

    registry.add(old, "Ahri").unwrap();
    registry.touch(old).unwrap();
    let opened = registry.last_opened(&ProjectKey::of(old));

    registry.relocate(old, new, "Ahri").unwrap();

    assert!(!registry.is_opened(&ProjectKey::of(old)));
    assert!(registry.is_opened(&ProjectKey::of(new)));
    assert_eq!(registry.last_opened(&ProjectKey::of(new)), opened);
}

#[test]
fn forgetting_drops_the_entry_and_its_time() {
    let registry = ProjectRegistry::default();
    let project = Path::new("ahri");

    registry.add(project, "Ahri").unwrap();
    registry.touch(project).unwrap();
    registry.forget(project).unwrap();

    assert!(registry.opened_folders().is_empty());
    assert_eq!(registry.last_opened(&ProjectKey::of(project)), None);
}

#[test]
fn an_unreadable_file_starts_empty() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(ProjectRegistry::FILE_NAME);
    fs::write(&file, "not json").unwrap();

    assert!(ProjectRegistry::load(file).opened_folders().is_empty());
}
