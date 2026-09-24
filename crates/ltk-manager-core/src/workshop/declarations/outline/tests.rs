use super::*;
use std::path::Path;

use ltk_hash::Hash as _;

fn project(dir: &Path) -> ProjectDir {
    let config = serde_json::json!({
        "name": "jade-teemo",
        "display_name": "Jade Teemo",
        "version": "1.0.0",
        "description": "",
        "authors": [],
        "layers": [
            { "name": "base", "priority": 0 },
            { "name": "chroma", "priority": 1 },
        ],
    });
    fs::write(dir.join("mod.config.json"), config.to_string()).unwrap();
    for layer in ["base", "chroma"] {
        fs::create_dir_all(dir.join("content").join(layer)).unwrap();
    }
    ProjectDir::open(dir).unwrap()
}

fn write_manifest(dir: &Path, layer: &str, text: &str) {
    fs::write(dir.join("content").join(layer).join("game_data.yaml"), text).unwrap();
}

const MANIFEST: &str = "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        skinMeshProperties.selfIllumination: 0.37
        skinMeshProperties:
          initialSubmeshToHide: Tail
        +resourceMap: {Teemo_R: Characters/Jade/R}
        iconAvatar: !ref \"Characters/Teemo/Skins/Skin1:iconAvatar\"
  - target: data/characters/teemo/skins/skin0.bin
    Characters/Teemo/Skins/Skin0:
      -resourceMap: [Teemo_R]
";

#[test]
fn a_layer_with_no_manifest_outlines_as_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());

    let layers = project.declarations_outline().unwrap();

    assert_eq!(
        layers
            .iter()
            .map(|layer| layer.layer.as_str())
            .collect::<Vec<_>>(),
        ["base", "chroma"]
    );
    assert!(
        layers
            .iter()
            .all(|layer| layer.file.is_none() && layer.error.is_none() && layer.modules.is_empty())
    );
}

#[test]
fn an_entries_module_lists_dotted_block_signed_and_tagged_keys_in_order() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(tmp.path(), "base", MANIFEST);

    let layers = project.declarations_outline().unwrap();
    let base = &layers[0];
    let module = &base.modules[0];
    let entry = &module.entries[0];
    let keys: Vec<(&str, &str)> = entry
        .keys
        .iter()
        .map(|key| (key.key.as_str(), key.value.as_str()))
        .collect();

    assert_eq!(base.file.as_deref(), Some("game_data.yaml"));
    assert_eq!(module.selector, ModuleSelector::Entries);
    assert_eq!(module.name, None);
    assert_eq!(entry.name, "Characters/Teemo/Skins/Skin0");
    assert_eq!(entry.hash, hex(ltk_hash::BinHash::hash_str(&entry.name)));
    assert_eq!(
        keys,
        [
            ("skinMeshProperties.selfIllumination", "0.37"),
            ("skinMeshProperties", "initialSubmeshToHide: Tail"),
            ("+resourceMap", "{Teemo_R: Characters/Jade/R}"),
            (
                "iconAvatar",
                "!ref \"Characters/Teemo/Skins/Skin1:iconAvatar\""
            ),
        ]
    );
    assert_eq!(entry.keys[2].sign, DeclaredSign::Add);
    assert_eq!(entry.keys[2].path, "resourceMap");
}

#[test]
fn a_named_module_carries_its_name() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(
        tmp.path(),
        "base",
        "version: 1
modules:
  - name: Base look
    entries:
      Characters/Teemo/Skins/Skin0:
        iconSquare: b.tex
  - entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: c.tex
",
    );

    let layers = project.declarations_outline().unwrap();
    let names: Vec<Option<&str>> = layers[0]
        .modules
        .iter()
        .map(|module| module.name.as_deref())
        .collect();

    assert_eq!(names, [Some("Base look"), None]);
}

#[test]
fn a_key_carries_its_lines_and_the_row_it_reaches() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(tmp.path(), "base", &MANIFEST.replace('\n', "\r\n"));

    let layers = project.declarations_outline().unwrap();
    let keys = &layers[0].modules[0].entries[0].keys;
    let glow = &keys[0];
    let block = &keys[1];

    assert_eq!(
        glow.span,
        Some(LineSpan {
            line: 5,
            column: 9,
            end_line: 6,
            end_column: 1,
        })
    );
    assert_eq!(
        block.span.map(|span| (span.line, span.end_line)),
        Some((6, 8))
    );
    assert_eq!(
        glow.row,
        format!(
            "{:08x}.{:08x}",
            *ltk_hash::BinHash::hash_str("skinmeshproperties"),
            *ltk_hash::BinHash::hash_str("selfillumination"),
        )
    );
    assert!(!layers[0].text.as_deref().unwrap().contains('\r'));
}

#[test]
fn a_target_module_names_its_chunk() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(tmp.path(), "base", MANIFEST);

    let layers = project.declarations_outline().unwrap();
    let module = &layers[0].modules[1];
    let key = &module.entries[0].keys[0];

    assert_eq!(module.index, 1);
    assert_eq!(module.selector, ModuleSelector::Target);
    assert_eq!(
        module.target.as_deref(),
        Some("data/characters/teemo/skins/skin0.bin")
    );
    assert_eq!(
        module.target_hash,
        Some(format!(
            "{:016x}",
            ltk_game_data::path_hash("data/characters/teemo/skins/skin0.bin")
        ))
    );
    assert_eq!(module.span.map(|span| span.line), Some(10));
    assert_eq!(
        (key.key.as_str(), key.value.as_str()),
        ("-resourceMap", "[Teemo_R]")
    );
    assert_eq!(key.span.map(|span| span.line), Some(12));
}

#[test]
fn a_manifest_that_does_not_load_reports_where() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(
        tmp.path(),
        "chroma",
        "version: 1\nmodules:\n  - entries:\n      Characters/Teemo/Skins/Skin0:\n        a: [1\n",
    );

    let layers = project.declarations_outline().unwrap();
    let chroma = &layers[1];
    let error = chroma.error.as_ref().unwrap();

    assert!(chroma.modules.is_empty());
    assert!(chroma.text.is_some());
    assert!(error.span.is_some_and(|span| span.line >= 5));
}

#[test]
fn a_semantic_error_is_placed_on_its_module() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    write_manifest(
        tmp.path(),
        "base",
        "version: 1\nmodules:\n  - entries:\n      Characters/Teemo/Skins/Skin0:\n        a: 1\n  - target: data/a.bin\n    entries: {}\n",
    );

    let layers = project.declarations_outline().unwrap();
    let error = layers[0].error.as_ref().unwrap();

    assert_eq!(error.document.as_deref(), Some("game_data.yaml"));
    assert_eq!(error.span.map(|span| span.line), Some(6));
}

#[test]
fn a_row_path_stops_before_a_map_key() {
    let path = PropertyPath::new("a[2].b{\"x\"}.c").unwrap();

    assert_eq!(
        row_path(&path),
        format!(
            "{:08x}[2].{:08x}",
            *ltk_hash::BinHash::hash_str("a"),
            *ltk_hash::BinHash::hash_str("b"),
        )
    );
}
