use super::*;
use crate::error::AppError;
use assert_matches::assert_matches;
use camino::Utf8Path;

/// A project directory holding `content/base`, plus the rules text.
fn make_project(dir: &std::path::Path, rules: Option<&str>) -> ProjectDir {
    fs::create_dir_all(dir.join("content").join("base")).unwrap();
    if let Some(rules) = rules {
        fs::write(dir.join(MODIGNORE_FILE_NAME), rules).unwrap();
    }
    ProjectDir::open(dir).unwrap()
}

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 12).unwrap()
}

#[test]
fn every_recommended_line_compiles() {
    assert_eq!(ignore_rule_problem(RECOMMENDED_IGNORE_RULES), None);
}

#[test]
fn the_recommended_rules_leave_sources_out_and_game_files_in() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), Some(RECOMMENDED_IGNORE_RULES));
    let root = project
        .path()
        .to_path_buf()
        .try_into_utf8("project")
        .unwrap();

    let ignore = ModIgnore::load(&root).unwrap();
    let excluded = [
        ("base/splash.psd", false),
        ("base/models/aatrox.fbx", false),
        ("base/.mayaSwatches", true),
        ("base/.DS_Store", false),
    ];
    for (path, is_dir) in excluded {
        assert!(
            ignore.is_ignored(Utf8Path::new(path), is_dir),
            "{path} should be left out"
        );
    }

    let kept = [
        "base/data/characters/aatrox/skin0.bin",
        "base/assets/aatrox.tex",
        "base/assets/aatrox.dds",
        "base/assets/icon.png",
    ];
    for path in kept {
        assert!(
            !ignore.is_ignored(Utf8Path::new(path), false),
            "{path} should be packed"
        );
    }
}

/// A `.mayaSwatches` folder is pruned, so what it holds goes with it.
#[test]
fn a_pruned_folder_takes_its_files_with_it() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), Some(RECOMMENDED_IGNORE_RULES));
    let root = project
        .path()
        .to_path_buf()
        .try_into_utf8("project")
        .unwrap();

    let ignore = ModIgnore::load(&root).unwrap();
    assert!(ignore.is_ignored(Utf8Path::new("base/.mayaSwatches/aatrox.swatch"), false));
}

#[test]
fn a_pattern_that_does_not_compile_names_its_line() {
    let problem = ignore_rule_problem("*.psd\n\na{b\n").unwrap();

    assert_eq!(problem.line, 3);
    assert!(
        problem.message.contains("a{b"),
        "the message should quote the pattern, got {}",
        problem.message
    );
}

/// The buffer is what an editor holds, so a nested file the project does hold
/// cannot fail a save of the root one.
#[test]
fn validation_reads_the_buffer_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), None);
    fs::write(
        project
            .path()
            .join("content")
            .join("base")
            .join(MODIGNORE_FILE_NAME),
        "a{b\n",
    )
    .unwrap();

    assert_eq!(ignore_rule_problem("*.psd\n"), None);
}

#[test]
fn a_blocked_save_writes_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), Some("*.psd\n"));

    let error = project.write_ignore_rules("*.psd\na{b\n").unwrap_err();

    assert_matches!(
        error,
        AppError::Workshop(WorkshopError::IgnoreRulePattern { line: 2, .. })
    );
    assert_eq!(
        fs::read_to_string(project.ignore_file()).unwrap(),
        "*.psd\n"
    );
}

#[test]
fn missing_recommended_skips_what_the_file_holds() {
    let missing = missing_recommended_rules("# mine\n*.psd\n*.fbx\n");

    assert!(!missing.contains(&"*.psd".to_string()));
    assert!(!missing.contains(&"*.fbx".to_string()));
    assert!(missing.contains(&"*.blend".to_string()));
}

#[test]
fn appending_dates_the_block_and_leaves_the_rest_alone() {
    let appended = with_recommended_rules("*.psd\n", day());

    assert!(appended.starts_with("*.psd\n"));
    assert!(appended.contains("# Added 2026-09-12\n"));
    assert!(appended.contains("\n*.blend\n"));
    assert_eq!(appended.matches("*.psd").count(), 1);
}

/// A creator who deleted an entry on purpose is never told twice.
#[test]
fn appending_a_complete_file_changes_nothing() {
    assert_eq!(
        with_recommended_rules(RECOMMENDED_IGNORE_RULES, day()),
        RECOMMENDED_IGNORE_RULES
    );
}

#[test]
fn a_project_with_no_file_gets_the_whole_default() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), None);

    let rules = project.add_recommended_ignore_rules(day()).unwrap();

    assert_eq!(rules.text.as_deref(), Some(RECOMMENDED_IGNORE_RULES));
    assert!(rules.missing_recommended.is_empty());
}

#[test]
fn reading_a_project_with_no_file_names_the_path_it_would_take() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), None);

    let rules = project.ignore_rules().unwrap();

    assert_eq!(rules.text, None);
    assert!(rules.path.ends_with(MODIGNORE_FILE_NAME));
    assert!(!rules.missing_recommended.is_empty());
}

/// The default is written once, so an import that lands on a project carrying
/// its own rules leaves them alone.
#[test]
fn the_default_never_overwrites_a_file_that_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let project = make_project(tmp.path(), Some("*.psd\n"));

    project.write_default_ignore_rules().unwrap();

    assert_eq!(
        fs::read_to_string(project.ignore_file()).unwrap(),
        "*.psd\n"
    );
}
