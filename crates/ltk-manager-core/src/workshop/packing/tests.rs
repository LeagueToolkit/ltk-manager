//! Unit tests for pre-flight validation and for what a pack reports.

use super::*;
use crate::events::NullEventSink;
use assert_matches::assert_matches;
use indexmap::IndexMap;
use ltk_mod_project::ModProjectLayer;
use std::sync::Arc;

/// A packable project holding `layers`, with `files` written under `content/`.
fn make_project(dir: &Path, layers: Vec<ModProjectLayer>, files: &[&str]) -> ProjectDir {
    let mod_project = ModProject {
        name: "test-mod".to_string(),
        display_name: "Test Mod".to_string(),
        version: "1.0.0".to_string(),
        description: String::new(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers,
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();

    for file in files {
        let path = dir.join("content").join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    ProjectDir::open(dir).unwrap()
}

fn base_layer() -> Vec<ModProjectLayer> {
    ModProjectLayer::default_table()
}

fn write_rules(dir: &Path, rules: &str) {
    fs::write(dir.join(".modignore"), rules).unwrap();
}

fn pack(dir: &Path) -> AppResult<PackResult> {
    Workshop::new(Arc::new(NullEventSink)).pack_project(PackProjectArgs {
        project_path: dir.display().to_string(),
        output_dir: None,
        format: PackFormat::Modpkg,
    })
}

fn make_valid_project(dir: &std::path::Path) {
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test Mod".to_string(),
        version: "1.0.0".to_string(),
        description: "A valid test mod".to_string(),
        authors: vec![ltk_mod_project::ModProjectAuthor::Name(
            "Author".to_string(),
        )],
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.join("content").join("base")).unwrap();
    fs::write(
        dir.join("content").join("base").join("test.wad.client"),
        b"data",
    )
    .unwrap();
    fs::write(dir.join("thumbnail.webp"), b"fake thumbnail").unwrap();
}

#[test]
fn validate_missing_config_file() {
    let dir = tempfile::tempdir().unwrap();
    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("mod.config.json")));
}

#[test]
fn validate_invalid_config() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("mod.config.json"), "invalid json").unwrap();
    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("parse config")));
}

#[test]
fn validate_invalid_project_name() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "BadName".to_string(),
        display_name: "Bad".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("lowercase")));
}

#[test]
fn validate_invalid_version() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test".to_string(),
        version: "not-semver".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("version")));
}

#[test]
fn validate_missing_content_dir() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("content/")));
}

#[test]
fn validate_empty_layer_dir_warns() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(result.valid);
    assert!(result.warnings.iter().any(|w| w.contains("empty")));
}

#[test]
fn validate_missing_thumbnail_warns() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ltk_mod_project::ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("content").join("base")).unwrap();
    fs::write(
        dir.path().join("content").join("base").join("file"),
        b"data",
    )
    .unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(result.valid);
    assert!(result.warnings.iter().any(|w| w.contains("thumbnail")));
}

#[test]
fn validate_valid_project_passes() {
    let dir = tempfile::tempdir().unwrap();
    make_valid_project(dir.path());
    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(
        result.valid,
        "errors: {:?}, warnings: {:?}",
        result.errors, result.warnings
    );
    assert!(result.errors.is_empty());
}

#[test]
fn validate_no_base_layer_warns() {
    let dir = tempfile::tempdir().unwrap();
    let mod_project = ltk_mod_project::ModProject {
        name: "test-mod".to_string(),
        display_name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: vec![ltk_mod_project::ModProjectLayer {
            name: "chroma".to_string(),
            display_name: Some("Chroma".to_string()),
            priority: 1,
            description: None,
            string_overrides: IndexMap::new(),
        }],
        thumbnail: None,
        hashtables: Vec::new(),
    };
    fs::write(
        dir.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("content").join("chroma")).unwrap();
    fs::write(
        dir.path().join("content").join("chroma").join("file"),
        b"data",
    )
    .unwrap();

    let result = ProjectDir::open(dir.path()).unwrap().validate().unwrap();
    assert!(result.warnings.iter().any(|w| w.contains("base")));
}

#[test]
fn pack_format_deserialization() {
    let modpkg: PackFormat = serde_json::from_str("\"modpkg\"").unwrap();
    assert_eq!(modpkg, PackFormat::Modpkg);
    let fantome: PackFormat = serde_json::from_str("\"fantome\"").unwrap();
    assert_eq!(fantome, PackFormat::Fantome);
}

#[test]
fn a_pack_reports_what_the_rules_left_out() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(
        tmp.path(),
        base_layer(),
        &[
            "base/data/skin0.bin",
            "base/textures/skin0_src.psd",
            "base/notes.txt",
            "base/wip/draft.dds",
            "base/wip/nested/deeper.dds",
        ],
    );
    write_rules(tmp.path(), "*.psd\n/base/notes.txt\n/base/wip/\n");

    let result = pack(tmp.path()).unwrap();

    let mut ignored: Vec<_> = result.ignored.iter().map(|e| e.path.as_str()).collect();
    ignored.sort_unstable();
    assert_eq!(
        ignored,
        ["base/notes.txt", "base/textures/skin0_src.psd", "base/wip"]
    );

    let pruned = result
        .ignored
        .iter()
        .find(|entry| entry.path == "base/wip")
        .unwrap();
    assert!(pruned.pruned, "a pruned folder is marked as one");
}

#[test]
fn a_project_with_no_rules_leaves_nothing_out() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &["base/data/skin0.bin"]);

    assert_eq!(pack(tmp.path()).unwrap().ignored, []);
}

#[test]
fn a_pattern_that_does_not_compile_fails_the_pack_with_its_line() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &["base/data/skin0.bin"]);
    write_rules(tmp.path(), "*.psd\n\na{b\n");

    let error = pack(tmp.path()).unwrap_err();

    assert_matches!(
        error,
        AppError::Workshop(WorkshopError::PackIgnorePattern { path, line, .. }) => {
            assert_eq!(line, 3);
            // Project-relative, the form the creator knows the file by.
            assert_eq!(path, ".modignore");
        }
    );
}

#[test]
fn a_layer_the_rules_empty_is_a_warning() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &["base/textures/skin0_src.psd"]);
    write_rules(tmp.path(), "*.psd\n");

    let validation = ProjectDir::open(tmp.path()).unwrap().validate().unwrap();

    assert!(
        validation
            .warnings
            .contains(&"Layer content/base is empty after ignore rules".to_string()),
        "{:?}",
        validation.warnings
    );
}

#[test]
fn a_layer_keeping_one_file_is_not_a_warning() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(
        tmp.path(),
        base_layer(),
        &["base/textures/skin0_src.psd", "base/data/skin0.bin"],
    );
    write_rules(tmp.path(), "*.psd\n");

    let validation = ProjectDir::open(tmp.path()).unwrap().validate().unwrap();

    assert!(
        !validation
            .warnings
            .iter()
            .any(|warning| warning.contains("content/base is empty")),
        "{:?}",
        validation.warnings
    );
}

/// A layer with no files at all keeps the warning it always had, so a creator
/// who wrote no rules is not told the rules emptied it.
#[test]
fn a_layer_with_no_files_reads_as_empty_rather_than_emptied() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &[]);
    fs::create_dir_all(tmp.path().join("content").join("base")).unwrap();
    write_rules(tmp.path(), "*.psd\n");

    let validation = ProjectDir::open(tmp.path()).unwrap().validate().unwrap();

    assert!(
        validation
            .warnings
            .contains(&"Layer content/base is empty".to_string()),
        "{:?}",
        validation.warnings
    );
}

/// The filter walks files, so a layer whose only entries are directories packs
/// nothing and reads as empty, where counting raw entries called it populated.
#[test]
fn a_layer_holding_only_empty_directories_reads_as_empty() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &[]);
    fs::create_dir_all(tmp.path().join("content").join("base").join("textures")).unwrap();

    let validation = ProjectDir::open(tmp.path()).unwrap().validate().unwrap();

    assert!(
        validation
            .warnings
            .contains(&"Layer content/base is empty".to_string()),
        "{:?}",
        validation.warnings
    );
}

#[test]
fn a_pattern_that_does_not_compile_fails_validation_with_its_line() {
    let tmp = tempfile::tempdir().unwrap();
    make_project(tmp.path(), base_layer(), &["base/data/skin0.bin"]);
    write_rules(tmp.path(), "a{b\n");

    let validation = ProjectDir::open(tmp.path()).unwrap().validate().unwrap();

    assert!(!validation.valid);
    assert!(
        validation
            .errors
            .iter()
            .any(|error| error.contains("line 1")),
        "{:?}",
        validation.errors
    );
}
