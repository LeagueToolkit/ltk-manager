//! Unit tests for the content scan: the walk over a layer, the tree over a
//! project, and the objects a layer's bins declare.

use super::*;
use crate::events::NullEventSink;
use fs_err as fs;
use ltk_hash::Hash as _;
use ltk_meta::path::PropertyPath;
use ltk_meta::property::NoMeta;
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject, BinOverride, PropertyPatch};
use ltk_mod_project::MODIGNORE_FILE_NAME;
use std::io::Cursor;
use std::sync::Arc;

fn touch(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

/// A `PROP` declaring `objects`, each as `(object path, class name)`.
fn prop(objects: &[(&str, &str)]) -> Vec<u8> {
    let bin = Bin::<NoMeta>::new(
        objects
            .iter()
            .map(|(path, class)| BinObject::new(BinHash::hash_str(path), BinHash::hash_str(class))),
        std::iter::empty::<&str>(),
    );
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A `PTCH` adding `objects` and carrying one patch record on `patched`.
fn patch(objects: &[(&str, &str)], patched: &str) -> Vec<u8> {
    let mut bin = BinOverride::<NoMeta>::new();
    for (path, class) in objects {
        let object = BinObject::new(BinHash::hash_str(path), BinHash::hash_str(class));
        bin.objects.insert(object.path_hash, object);
    }
    bin.patches.push(PropertyPatch::new(
        BinHash::hash_str(patched),
        PropertyPath::new("mValue").unwrap(),
        values::U32::new(2),
    ));
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// The layer under `dir` as the frontend lists it, named through no table.
fn listed(dir: &Path, name: &str) -> LayerContent {
    scan_layer(dir, name, None)
        .unwrap()
        .named(&ResolvedNames::default())
}

#[test]
fn scan_layer_empty_dir() {
    let dir = tempfile::tempdir().unwrap();
    let layer = listed(dir.path(), "base");
    assert_eq!(layer.file_count, 0);
    assert_eq!(layer.total_size_bytes, 0);
    assert!(layer.entries.is_empty());
}

#[test]
fn scan_layer_classifies_known_extensions() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("assets/tex/skin.dds"), b"DDS content");
    touch(&dir.path().join("data/config.bin"), b"bin content");
    touch(&dir.path().join("mystery.xyz"), b"?");

    let layer = listed(dir.path(), "base");
    assert_eq!(layer.entries.len(), 3);

    let by_path: std::collections::HashMap<_, _> = layer
        .entries
        .iter()
        .map(|e| (e.relative_path.clone(), e.kind))
        .collect();
    assert!(matches!(
        by_path["assets/tex/skin.dds"],
        WorkshopFileKind::TextureDds
    ));
    assert!(matches!(
        by_path["data/config.bin"],
        WorkshopFileKind::PropertyBin
    ));
    assert!(matches!(by_path["mystery.xyz"], WorkshopFileKind::Unknown));
}

#[test]
fn scan_layer_lists_dot_entries() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join(".DS_Store"), b"junk");
    touch(&dir.path().join(".mayaSwatches/swatch.png"), b"png");
    touch(&dir.path().join("visible.png"), b"png");

    let layer = listed(dir.path(), "base");
    let paths: Vec<_> = layer
        .entries
        .iter()
        .map(|e| e.relative_path.as_str())
        .collect();
    assert_eq!(
        paths,
        [".DS_Store", ".mayaSwatches/swatch.png", "visible.png"]
    );
}

#[test]
fn scan_layer_returns_every_file() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..50 {
        touch(&dir.path().join(format!("file_{i}.bin")), b"xx");
    }

    let layer = listed(dir.path(), "base");
    assert_eq!(layer.file_count, 50);
    assert_eq!(layer.entries.len(), 50);
    assert_eq!(layer.total_size_bytes, 100);
}

#[test]
fn scan_layer_sorts_entries_by_path() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("z.bin"), b"");
    touch(&dir.path().join("a.bin"), b"");
    touch(&dir.path().join("m/n.bin"), b"");

    let layer = listed(dir.path(), "base");
    let paths: Vec<_> = layer
        .entries
        .iter()
        .map(|e| e.relative_path.as_str())
        .collect();
    assert_eq!(paths, vec!["a.bin", "m/n.bin", "z.bin"]);
}

#[test]
fn content_tree_orders_base_first() {
    let project_dir = tempfile::tempdir().unwrap();
    let content = project_dir.path().join("content");
    fs::create_dir_all(content.join("zeta")).unwrap();
    fs::create_dir_all(content.join("alpha")).unwrap();
    fs::create_dir_all(content.join("base")).unwrap();
    touch(&content.join("base/a.bin"), b"");
    touch(&content.join("alpha/a.bin"), b"");
    touch(&content.join("zeta/a.bin"), b"");

    let workshop = Workshop::new(Arc::new(NullEventSink));
    let tree = workshop
        .get_project_content_tree(project_dir.path().to_str().unwrap())
        .unwrap();

    let names: Vec<&str> = tree.layers.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, ["base", "alpha", "zeta"]);
}

#[test]
fn a_layer_bin_carries_its_objects_and_every_other_file_none() {
    let project_dir = tempfile::tempdir().unwrap();
    let content = project_dir.path().join("content");
    touch(
        &content.join("base/data/skin0.bin"),
        &prop(&[
            (
                "characters/aatrox/skins/skin0",
                "SkinCharacterDataProperties",
            ),
            (
                "characters/aatrox/skins/skin0/resources",
                "ResourceResolver",
            ),
        ]),
    );
    touch(
        &content.join("base/data/patch.bin"),
        &patch(
            &[(
                "characters/aatrox/skins/skin0/added",
                "VfxSystemDefinitionData",
            )],
            "characters/aatrox/skins/skin0",
        ),
    );
    touch(&content.join("base/data/broken.bin"), b"PROP garbage");
    touch(&content.join("base/assets/skin0.dds"), b"DDS content");

    let workshop = Workshop::new(Arc::new(NullEventSink));
    let tree = workshop
        .get_project_content_tree(project_dir.path().to_str().unwrap())
        .unwrap();
    let base = &tree.layers[0];
    let objects = |path: &str| -> Vec<(String, String, String)> {
        base.entries
            .iter()
            .find(|entry| entry.relative_path == path)
            .unwrap()
            .objects
            .iter()
            .map(|object| {
                (
                    object.object_hash.clone(),
                    object.path.clone(),
                    object.class.clone(),
                )
            })
            .collect()
    };

    let skin0 = objects("data/skin0.bin");
    assert_eq!(skin0.len(), 2, "one row per object, in file order");
    assert_eq!(
        skin0[0].0,
        hex(BinHash::hash_str("characters/aatrox/skins/skin0"))
    );
    assert_eq!(
        skin0[1].0,
        hex(BinHash::hash_str("characters/aatrox/skins/skin0/resources"))
    );
    /* The machine running this may or may not hold a synced cache, so a name
    is either the table's or the hash's, and never empty. */
    for (hash, path, class) in &skin0 {
        assert!(!path.is_empty() && !class.is_empty());
        assert!(path == hash || !path.starts_with("0x"));
    }

    let patched = objects("data/patch.bin");
    assert_eq!(
        patched
            .iter()
            .map(|(hash, _, _)| hash.as_str())
            .collect::<Vec<_>>(),
        [hex(BinHash::hash_str(
            "characters/aatrox/skins/skin0/added"
        ))],
        "a patch's added objects are rows, and its patch record is not"
    );

    assert!(
        objects("data/broken.bin").is_empty(),
        "a bin that will not read"
    );
    assert!(objects("assets/skin0.dds").is_empty(), "not a bin");
    assert_eq!(base.file_count, 4);
}

/// A project holding `rules` at its root and `files` under `content/base`.
fn ignoring(dir: &Path, rules: &str, files: &[&str]) -> LayerContent {
    touch(&dir.join(MODIGNORE_FILE_NAME), rules.as_bytes());
    for file in files {
        touch(&dir.join("content/base").join(file), b"x");
    }

    let workshop = Workshop::new(Arc::new(NullEventSink));
    let tree = workshop
        .get_project_content_tree(dir.to_str().unwrap())
        .unwrap();
    tree.layers.into_iter().next().unwrap()
}

/// What excluded `path`, or `None` where nothing did.
fn excluded_by<'a>(layer: &'a LayerContent, path: &str) -> Option<&'a IgnoreMatch> {
    layer
        .entries
        .iter()
        .find(|entry| entry.relative_path == path)
        .unwrap_or_else(|| panic!("{path} has no row"))
        .ignored_by
        .as_ref()
}

#[test]
fn an_excluded_row_names_the_rule_that_excluded_it() {
    let tmp = tempfile::tempdir().unwrap();
    let layer = ignoring(
        tmp.path(),
        "# working files\n*.psd\n.mayaSwatches/\n",
        &["splash.psd", "splash.tex", ".mayaSwatches/swatch.png"],
    );

    let psd = excluded_by(&layer, "splash.psd").expect("the .psd is excluded");
    assert_eq!(psd.pattern, "*.psd");
    assert_eq!(psd.source, MODIGNORE_FILE_NAME);
    assert_eq!(psd.line, Some(2));

    assert!(excluded_by(&layer, "splash.tex").is_none());

    let directories: Vec<_> = layer
        .ignored_directories
        .iter()
        .map(|dir| (dir.relative_path.as_str(), dir.ignored_by.pattern.as_str()))
        .collect();
    assert_eq!(directories, [(".mayaSwatches", ".mayaSwatches/")]);
}

#[test]
fn a_pruned_directory_marks_its_descendants() {
    let tmp = tempfile::tempdir().unwrap();
    let layer = ignoring(
        tmp.path(),
        "scratch/\n",
        &["scratch/deep/notes.txt", "ships.bin"],
    );

    let descendant = excluded_by(&layer, "scratch/deep/notes.txt").expect("under a pruned folder");
    assert_eq!(
        descendant.pattern, "scratch/",
        "the folder's own rule, not one of its own"
    );

    let pruned: Vec<_> = layer
        .ignored_directories
        .iter()
        .map(|dir| dir.relative_path.as_str())
        .collect();
    assert_eq!(pruned, ["scratch", "scratch/deep"]);
    assert!(excluded_by(&layer, "ships.bin").is_none());
}

#[test]
fn a_rule_from_a_nested_file_names_that_file() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path()
            .join("content/base/textures")
            .join(MODIGNORE_FILE_NAME),
        b"*.png\n",
    );

    let layer = ignoring(tmp.path(), "*.psd\n", &["textures/skin0.png"]);

    let nested = excluded_by(&layer, "textures/skin0.png").expect("the nested rule holds");
    assert_eq!(nested.pattern, "*.png");
    assert_eq!(nested.source, "content/base/textures/.modignore");
    assert_eq!(nested.line, Some(1));
}

/// The row menu offers to stop ignoring where the rule is the row's own
/// anchored line, which it decides by comparing the two strings.
#[test]
fn an_anchored_rule_is_reported_exactly_as_it_was_written() {
    let tmp = tempfile::tempdir().unwrap();
    let layer = ignoring(
        tmp.path(),
        "/base/textures/wip/\n/base/splash.psd\n",
        &["textures/wip/rough.png", "splash.psd"],
    );

    assert_eq!(
        excluded_by(&layer, "splash.psd").map(|rule| rule.pattern.as_str()),
        Some("/base/splash.psd")
    );
    assert_eq!(
        layer
            .ignored_directories
            .iter()
            .map(|dir| dir.ignored_by.pattern.as_str())
            .collect::<Vec<_>>(),
        ["/base/textures/wip/"]
    );
}

#[test]
fn a_project_whose_rules_do_not_compile_still_lists_its_files() {
    let tmp = tempfile::tempdir().unwrap();
    let layer = ignoring(tmp.path(), "a{b\n", &["splash.psd"]);

    assert_eq!(layer.file_count, 1);
    assert!(excluded_by(&layer, "splash.psd").is_none());
}
