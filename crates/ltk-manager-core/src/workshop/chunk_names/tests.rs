use super::*;

/// A project on disk: layer files under `content`, and declared tables under `hashes`.
fn project(files: &[&str], tables: &[(&str, &str)]) -> tempfile::TempDir {
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

    let manifest = format!(
        r#"{{"name":"probe","display_name":"Probe","version":"1.0.0","description":"","authors":[],"layers":[],"hashtables":[{}]}}"#,
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
