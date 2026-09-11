use super::*;

/// A project on disk: layer files under `content`, and declared tables under `hashes`.
fn project(files: &[&str], tables: &[(&str, &str)]) -> tempfile::TempDir {
    written(files, tables, &[])
}

/// A project whose manifest declares `layers` by name and priority.
fn layered(files: &[&str], layers: &[(&str, i32)]) -> tempfile::TempDir {
    written(files, &[], layers)
}

fn written(files: &[&str], tables: &[(&str, &str)], layers: &[(&str, i32)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");

    for layer_path in files {
        let full = dir.path().join(CONTENT_DIR_NAME).join(layer_path);
        fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
        fs::write(&full, b"x").expect("write");
    }

    let declared: Vec<String> = tables
        .iter()
        .map(|(name, body)| {
            let full = dir.path().join("hashes").join(name);
            fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
            fs::write(&full, body.as_bytes()).expect("write");
            format!(r#"{{"path":"hashes/{name}","category":"game","algorithm":"xxh64","bits":64}}"#)
        })
        .collect();

    let named: Vec<String> = layers
        .iter()
        .map(|(name, priority)| format!(r#"{{"name":"{name}","priority":{priority}}}"#))
        .collect();

    let manifest = format!(
        r#"{{"name":"probe","display_name":"Probe","version":"1.0.0","description":"","authors":[],"layers":[{}],"hashtables":[{}]}}"#,
        named.join(","),
        declared.join(",")
    );
    fs::write(dir.path().join("mod.config.json"), manifest.as_bytes()).expect("manifest");
    dir
}

#[test]
fn a_layer_file_is_named_at_its_path_inside_the_archive() {
    let path = "assets/characters/smolder/charizard_base_tx_cm.tex";
    let dir = project(&[&format!("base/Smolder.wad.client/{path}")], &[]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.get(WadHash::hash_str(path)), Some(path));
}

#[test]
fn the_layer_and_the_archive_are_not_part_of_the_chunk_path() {
    let dir = project(&["base/Aatrox.wad.client/assets/x.tex"], &[]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.get(WadHash::hash_str("assets/x.tex")),
        Some("assets/x.tex")
    );
    assert_eq!(
        chunks.get(WadHash::hash_str("base/Aatrox.wad.client/assets/x.tex")),
        None
    );
}

#[test]
fn a_chunk_path_reaches_the_layer_file_holding_it_whatever_its_casing() {
    let dir = project(&["base/Aatrox.wad.client/assets/x.tex"], &[]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.asset_at("ASSETS/X.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "base".to_owned(),
            path: "Aatrox.wad.client/assets/x.tex".to_owned(),
        })
    );
}

#[test]
fn a_path_only_a_declared_table_names_reaches_no_file() {
    let path = "assets/x.tex";
    let dir = project(&[], &[("game.hashes.txt", &format!("{path}\n"))]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.get(WadHash::hash_str(path)), Some(path));
    assert_eq!(chunks.asset_at(path), None);
}

#[test]
fn a_declared_table_names_a_path_no_layer_holds() {
    let path = "ASSETS/Characters/Smolder/Skins/Base/charizard_base_tx_cm.tex";
    let dir = project(&[], &[("game.hashes.txt", &format!("{path}\n"))]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.get(WadHash::hash_str(path)), Some(path));
}

#[test]
fn a_table_the_manifest_does_not_declare_is_not_read() {
    let dir = project(&[], &[]);
    fs::create_dir_all(dir.path().join("hashes")).expect("dirs");
    fs::write(
        dir.path().join("hashes/stray.hashes.txt"),
        b"assets/x.tex\n",
    )
    .expect("write");

    let chunks = LayerChunks::scan(dir.path());

    assert!(chunks.is_empty());
}

#[test]
fn a_table_path_and_a_layer_path_differing_only_in_case_are_one_chunk() {
    let dir = project(
        &["base/W.wad.client/assets/x.tex"],
        &[("game.hashes.txt", "ASSETS/X.TEX\n")],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.len(), 1, "one hash, whatever the casing");
}

/// `Layer::priority`'s contract, against a name order that would answer the other way.
#[test]
fn a_path_two_layers_hold_reaches_the_higher_priority_one() {
    let dir = layered(
        &[
            "aaa/W.wad.client/assets/x.tex",
            "zzz/W.wad.client/assets/x.tex",
        ],
        &[("aaa", 5), ("zzz", 1)],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.asset_at("assets/x.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "aaa".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

/// A layer dropped in by hand is declared nowhere, and still stacks over `base`.
#[test]
fn an_undeclared_layer_directory_stacks_onto_base() {
    let dir = layered(
        &[
            "base/W.wad.client/assets/x.tex",
            "custom/W.wad.client/assets/x.tex",
        ],
        &[("base", 0)],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.asset_at("assets/x.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "custom".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

/// `base` sits under its siblings by convention, not by rank, so a manifest that puts it
/// above them resolves that way.
#[test]
fn a_base_layer_of_the_higher_priority_still_wins() {
    let dir = layered(
        &[
            "base/W.wad.client/assets/x.tex",
            "extra/W.wad.client/assets/x.tex",
        ],
        &[("base", 10), ("extra", 1)],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.asset_at("assets/x.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "base".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

/// A priority is signed, and a layer below `base` is under it rather than over it.
#[test]
fn a_layer_of_a_negative_priority_is_under_base() {
    let dir = layered(
        &[
            "base/W.wad.client/assets/x.tex",
            "under/W.wad.client/assets/x.tex",
        ],
        &[("base", 0), ("under", -1)],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.asset_at("assets/x.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "base".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

/// One layer answers both halves, so a resolved link does not name one file and open another.
#[test]
fn the_named_spelling_and_the_file_come_from_one_layer() {
    let dir = layered(
        &[
            "aaa/W.wad.client/Assets/X.tex",
            "zzz/W.wad.client/assets/x.tex",
        ],
        &[("aaa", 1), ("zzz", 5)],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.get(WadHash::hash_str("assets/x.tex")),
        Some("assets/x.tex")
    );
    assert_eq!(
        chunks.asset_at("assets/x.tex"),
        Some(&AssetRef::Layer {
            project: dir.path().display().to_string(),
            layer: "zzz".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

#[test]
fn a_project_with_no_content_and_no_tables_names_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");

    assert!(LayerChunks::scan(dir.path()).is_empty());
}

#[test]
fn an_asset_outside_a_project_names_nothing() {
    let asset = AssetRef::GameChunk {
        wad: "Aatrox.wad.client".to_owned(),
        path_hash: "0040cb0b0c8560aa".to_owned(),
    };

    assert!(LayerChunks::of(&asset).is_empty());
}
