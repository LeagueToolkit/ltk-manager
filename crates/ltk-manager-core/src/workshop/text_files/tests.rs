use super::*;
use crate::error::AppError;
use assert_matches::assert_matches;

/// A project directory holding nothing but `content/`.
fn make_project(dir: &Path) -> ProjectDir {
    fs::create_dir_all(dir.join("content")).unwrap();
    ProjectDir::open(dir.display().to_string()).unwrap()
}

#[test]
fn a_file_that_is_not_there_reads_as_absent() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());

    let readme = project.project_text(ProjectTextFile::Readme).unwrap();

    assert_eq!(readme.text, None);
    assert!(readme.readable);
    assert_eq!(readme.revision, None);
    assert!(readme.path.ends_with(README_FILE_NAME));
}

#[test]
fn a_file_reads_with_a_revision() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    fs::write(tmp.path().join(README_FILE_NAME), "# Mod\n").unwrap();

    let readme = project.project_text(ProjectTextFile::Readme).unwrap();

    assert_eq!(readme.text.as_deref(), Some("# Mod\n"));
    assert_eq!(readme.revision.map(|revision| revision.size), Some(6));
}

#[test]
fn bytes_that_are_not_utf8_read_as_unreadable() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    fs::write(tmp.path().join(README_FILE_NAME), [0x23, 0x20, 0xff, 0xfe]).unwrap();

    let readme = project.project_text(ProjectTextFile::Readme).unwrap();

    assert!(!readme.readable);
    assert_eq!(readme.text, None);
    assert!(readme.revision.is_some());
}

#[test]
fn a_save_writes_what_it_was_given() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());

    let written = project
        .write_project_text(ProjectTextFile::Readme, "# Mod\n\nWhat it changes.\n", None)
        .unwrap();

    assert_eq!(written.text.as_deref(), Some("# Mod\n\nWhat it changes.\n"));
    assert_eq!(
        fs::read_to_string(tmp.path().join(README_FILE_NAME)).unwrap(),
        "# Mod\n\nWhat it changes.\n"
    );
}

#[test]
fn a_save_is_refused_when_the_file_moved_under_it() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    let path = tmp.path().join(README_FILE_NAME);
    fs::write(&path, "# Mod\n").unwrap();

    let read = project.project_text(ProjectTextFile::Readme).unwrap();
    fs::write(&path, "# Written by another editor, at another length\n").unwrap();

    let refused = project.write_project_text(ProjectTextFile::Readme, "# Mine\n", read.revision);

    assert_matches!(
        refused,
        Err(AppError::Workshop(WorkshopError::TextFileChanged { .. }))
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "# Written by another editor, at another length\n"
    );
}

#[test]
fn a_save_that_expects_nothing_writes_over_whatever_is_there() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    fs::write(tmp.path().join(README_FILE_NAME), "# Theirs\n").unwrap();

    project
        .write_project_text(ProjectTextFile::Readme, "# Mine\n", None)
        .unwrap();

    assert_eq!(
        fs::read_to_string(tmp.path().join(README_FILE_NAME)).unwrap(),
        "# Mine\n"
    );
}

#[test]
fn a_carriage_return_file_keeps_its_line_endings() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    fs::write(
        tmp.path().join(README_FILE_NAME),
        "# Mod\r\n\r\nOne line.\r\n",
    )
    .unwrap();

    /* The buffer arrives with the `\n` a textarea gives it. */
    project
        .write_project_text(ProjectTextFile::Readme, "# Mod\n\nTwo lines.\n", None)
        .unwrap();

    assert_eq!(
        fs::read_to_string(tmp.path().join(README_FILE_NAME)).unwrap(),
        "# Mod\r\n\r\nTwo lines.\r\n"
    );
}

#[test]
fn a_license_is_found_under_any_spelling_it_was_written_with() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());
    fs::write(tmp.path().join("license.txt"), "MIT\n").unwrap();

    let license = project.project_text(ProjectTextFile::License).unwrap();

    assert_eq!(license.text.as_deref(), Some("MIT\n"));
}

#[test]
fn a_project_with_no_license_is_offered_the_first_name() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path());

    let license = project.project_text(ProjectTextFile::License).unwrap();

    assert_eq!(license.text, None);
    assert!(license.path.ends_with(LICENSE_FILE_NAMES[0]));
}

#[test]
fn the_default_readme_is_the_display_name_alone() {
    let tmp = tempfile::tempdir().unwrap();

    write_default_readme(tmp.path(), "My Awesome Mod").unwrap();

    assert_eq!(
        fs::read_to_string(tmp.path().join(README_FILE_NAME)).unwrap(),
        "# My Awesome Mod\n"
    );
}

#[test]
fn the_default_readme_leaves_a_file_that_is_already_there() {
    let tmp = tempfile::tempdir().unwrap();
    fs::write(
        tmp.path().join(README_FILE_NAME),
        "# What its author wrote\n",
    )
    .unwrap();

    write_default_readme(tmp.path(), "My Awesome Mod").unwrap();

    assert_eq!(
        fs::read_to_string(tmp.path().join(README_FILE_NAME)).unwrap(),
        "# What its author wrote\n"
    );
}

#[test]
fn a_line_ending_is_the_one_the_file_mostly_has() {
    assert_eq!(LineEnding::of(b"one\ntwo\n"), LineEnding::Lf);
    assert_eq!(LineEnding::of(b"one\r\ntwo\r\n"), LineEnding::CrLf);
    assert_eq!(LineEnding::of(b"one\r\ntwo\r\nthree\n"), LineEnding::CrLf);
    assert_eq!(LineEnding::of(b"one\ntwo\nthree\r\n"), LineEnding::Lf);
    assert_eq!(LineEnding::of(b"no lines at all"), LineEnding::Lf);
}
