use super::*;

/// A project on disk: layer files under `content`, and declared `game` tables under `hashes`.
fn project(files: &[&str], tables: &[(&str, &str)]) -> tempfile::TempDir {
    let tables: Vec<_> = tables
        .iter()
        .map(|(name, body)| (*name, "game", *body))
        .collect();
    written(files, &tables, &[])
}

/// A project declaring `tables` under `hashes`, each as its file name, category and body.
fn declaring(files: &[&str], tables: &[(&str, &str, &str)]) -> tempfile::TempDir {
    written(files, tables, &[])
}

/// A project whose manifest declares `layers` by name and priority.
fn layered(files: &[&str], layers: &[(&str, i32)]) -> tempfile::TempDir {
    written(files, &[], layers)
}

fn written(
    files: &[&str],
    tables: &[(&str, &str, &str)],
    layers: &[(&str, i32)],
) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");

    for layer_path in files {
        let full = dir.path().join(CONTENT_DIR_NAME).join(layer_path);
        fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
        fs::write(&full, b"x").expect("write");
    }

    let declared: Vec<String> = tables
        .iter()
        .map(|(name, category, body)| {
            let full = dir.path().join("hashes").join(name);
            fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
            fs::write(&full, body.as_bytes()).expect("write");

            let (algorithm, bits) = match *category {
                "game" => ("xxh64", 64),
                _ => ("fnv1a_32", 32),
            };
            format!(
                r#"{{"path":"hashes/{name}","category":"{category}","algorithm":"{algorithm}","bits":{bits}}}"#
            )
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
fn a_file_an_unpack_named_by_its_hash_answers_the_path_that_hashes_to_it() {
    let path = "ASSETS/Maps/KitPieces/SRX/Textures/Unnamed.tex";
    let hash = WadHash::hash_str(path);
    let file = format!("base/Map11.wad.client/{:016x}.tex", hash.0);
    let dir = project(&[&file], &[]);

    let chunks = LayerChunks::scan(dir.path());

    let held = AssetRef::Layer {
        project: dir.path().display().to_string(),
        layer: "base".to_owned(),
        path: format!("Map11.wad.client/{:016x}.tex", hash.0),
    };
    assert_eq!(chunks.asset_at(path), Some(&held));
    assert_eq!(chunks.asset_of_chunk(hash), Some(&held));
    assert_eq!(chunks.asset_at("assets/another.tex"), None);
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

#[test]
fn a_declared_binentries_table_names_an_object_and_no_chunk() {
    let path = "Mods/83f7e874bb9f/lux/vfx/Lux_Skin15_Z_RecallPlatform";
    let dir = declaring(
        &[],
        &[("binentries.hashes.txt", "binentries", &format!("{path}\n"))],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.entry(BinHash::hash_str(path)), Some(path));
    assert_eq!(chunks.get(WadHash::hash_str(path)), None);
    assert!(chunks.is_empty(), "an object path is not a chunk path");
}

#[test]
fn a_declared_binhashes_table_names_a_value() {
    let text = "Frieren_Lux_Mat";
    let dir = declaring(
        &[],
        &[("binhashes.hashes.txt", "binhashes", &format!("{text}\n"))],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.value(BinHash::hash_str(text)), Some(text));
    assert_eq!(chunks.entry(BinHash::hash_str(text)), None);
}

const GRAPH_DECLARATION: &str = r#"version: 1
modules:
  - target: data/characters/chogath/animations/skin0.bin
    objects:
      Mods/Deff/Animations:
        clone: Characters/Chogath/Animations/Skin0
        set:
          'mClipDataMap{"Taunt_Rework"}.mTickDuration': 0.5
          +mClipDataMap:
            Crit_Melee: !pointer(AtomicClipData)
              mTrackDataName: Upper_Track
              mEventDataMap:
                Swing: !pointer(ParticleEventData) { mEffectKey: Deff_Trail }
  - entries:
      Characters/Chogath/Skins/Skin0:
        mEffectList: [Deff_Listed]
        mHexKey: "0x12345678"
"#;

/// A project whose layer `base` holds `GRAPH_DECLARATION`, beside the layer `extra`.
fn declaring_graph() -> tempfile::TempDir {
    let dir = layered(
        &["base/game_data.yaml", "extra/W.wad.client/assets/y.tex"],
        &[("base", 0), ("extra", 1)],
    );
    fs::write(
        dir.path()
            .join(CONTENT_DIR_NAME)
            .join("base/game_data.yaml"),
        GRAPH_DECLARATION,
    )
    .expect("declaration");

    dir
}

#[test]
fn a_game_data_declaration_names_the_hash_values_it_writes() {
    let dir = declaring_graph();

    let chunks = LayerChunks::scan(dir.path());

    for text in [
        "Taunt_Rework",
        "Crit_Melee",
        "Upper_Track",
        "Swing",
        "Deff_Trail",
        "Deff_Listed",
    ] {
        assert_eq!(chunks.value(BinHash::hash_str(text)), Some(text));
    }
    assert_eq!(chunks.value(BinHash::hash_str("0x12345678")), None);
    assert_eq!(chunks.entry(BinHash::hash_str("Crit_Melee")), None);
}

#[test]
fn a_layer_skeleton_names_its_joints_for_every_layer_scan() {
    let path = "base/W.wad.client/assets/deff.SKL";
    let dir = project(&[path, "extra/W.wad.client/assets/y.tex"], &[]);
    fs::write(
        dir.path().join(CONTENT_DIR_NAME).join(path),
        ltk_manager_assets::test_util::skeleton_with_joints("Root", &["saw_tip_R"]),
    )
    .expect("skeleton");

    let chunks = LayerChunks::scan_layer(dir.path(), "extra");

    assert_eq!(chunks.value(BinHash::hash_str("Root")), Some("Root"));
    assert_eq!(
        chunks.value(BinHash::hash_str("saw_tip_r")),
        Some("saw_tip_R")
    );
}

#[test]
fn a_layer_file_that_is_no_skeleton_names_no_joint() {
    let dir = project(&["base/W.wad.client/assets/broken.skl"], &[]);

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.get(WadHash::hash_str("assets/broken.skl")),
        Some("assets/broken.skl")
    );
    assert_eq!(chunks.value(BinHash::hash_str("broken")), None);
}

#[test]
fn a_layer_scan_names_what_another_layer_declares() {
    let dir = declaring_graph();

    let chunks = LayerChunks::scan_layer(dir.path(), "extra");

    assert_eq!(
        chunks.value(BinHash::hash_str("Crit_Melee")),
        Some("Crit_Melee")
    );
}

/// An object path and a chunk path hash into different spaces, so one text is both.
#[test]
fn a_name_an_entry_table_and_a_layer_both_hold_is_named_in_both_spaces() {
    let path = "assets/x.tex";
    let dir = declaring(
        &["base/W.wad.client/assets/x.tex"],
        &[("binentries.hashes.txt", "binentries", "assets/x.tex\n")],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(chunks.get(WadHash::hash_str(path)), Some(path));
    assert_eq!(chunks.entry(BinHash::hash_str(path)), Some(path));
    assert_eq!(chunks.len(), 1);
}

#[test]
fn a_table_of_an_unknown_category_is_skipped() {
    let dir = declaring(
        &[],
        &[
            ("game.hashes.txt", "game", "assets/x.tex\n"),
            ("custom.hashes.txt", "custom", "assets/y.tex\n"),
        ],
    );

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.get(WadHash::hash_str("assets/x.tex")),
        Some("assets/x.tex")
    );
    assert_eq!(chunks.get(WadHash::hash_str("assets/y.tex")), None);
    assert_eq!(chunks.entry(BinHash::hash_str("assets/y.tex")), None);
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

/// The overlay applies `base` first regardless of its priority, so another layer with a
/// lower priority still replaces its files.
#[test]
fn base_stacks_under_a_sibling_of_a_lower_priority() {
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
            layer: "extra".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
}

/// Acceptance test 1 of docs/plans/sandbox.md: the overlay packs the negative-priority
/// layer's file, because it applies `base` first.
#[test]
fn a_layer_of_a_negative_priority_resolves_to_the_file_the_overlay_routes() {
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
            layer: "under".to_owned(),
            path: "W.wad.client/assets/x.tex".to_owned(),
        })
    );
    assert_eq!(chunks.layers(), ["base", "under"]);
}

#[test]
fn one_layer_scanned_alone_holds_its_own_files_only() {
    let dir = layered(
        &[
            "base/W.wad.client/assets/x.tex",
            "extra/W.wad.client/assets/y.tex",
        ],
        &[("base", 0), ("extra", 1)],
    );

    let chunks = LayerChunks::scan_layer(dir.path(), "extra");

    assert_eq!(chunks.asset_at("assets/x.tex"), None);
    assert!(chunks.asset_at("assets/y.tex").is_some());
    assert_eq!(chunks.layers(), ["extra"]);
}

/// One layer answers both halves, so a resolved link does not name one file and open another.
#[test]
fn the_named_text_and_the_file_come_from_one_layer() {
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

fn manifest_of(dir: &tempfile::TempDir) -> ModProject {
    ModProject::load(Utf8Path::from_path(dir.path()).expect("utf8")).expect("config")
}

#[test]
fn declare_entry_names_declares_a_binentries_table() {
    let path = "Maps/MapGeometry/Map11/step6-skin-test";
    let dir = declaring(&[], &[]);

    ProjectDir::open(dir.path())
        .expect("project")
        .declare_entry_names(&[path])
        .expect("declared");

    assert_eq!(
        LayerChunks::scan(dir.path()).entry(BinHash::hash_str(path)),
        Some(path)
    );
    let tables = manifest_of(&dir).hashtables;
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].category, Category::BinEntries);
}

#[test]
fn declare_entry_names_merges_into_a_declared_table() {
    let existing = "Maps/MapGeometry/Map11/Old";
    let added = "Maps/MapGeometry/Map11/New";
    let dir = declaring(
        &[],
        &[(
            "binentries.hashes.txt",
            "binentries",
            &format!("{existing}\n"),
        )],
    );

    ProjectDir::open(dir.path())
        .expect("project")
        .declare_entry_names(&[added])
        .expect("declared");

    let chunks = LayerChunks::scan(dir.path());
    assert_eq!(chunks.entry(BinHash::hash_str(existing)), Some(existing));
    assert_eq!(chunks.entry(BinHash::hash_str(added)), Some(added));
    assert_eq!(manifest_of(&dir).hashtables.len(), 1);
}

#[test]
fn a_path_the_declarations_write_names_its_object() {
    let dir = layered(&["base/game_data.yaml"], &[("base", 0)]);
    fs::write(
        dir.path()
            .join(CONTENT_DIR_NAME)
            .join("base/game_data.yaml"),
        "version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade/Clone:
        clone: Characters/Teemo/Skins/Skin0
",
    )
    .expect("manifest");

    let chunks = LayerChunks::scan(dir.path());

    assert_eq!(
        chunks.entry(BinHash::hash_str("Mods/jade/Clone")),
        Some("Mods/jade/Clone")
    );
    assert_eq!(
        chunks.entry(BinHash::hash_str("Characters/Teemo/Skins/Skin0")),
        Some("Characters/Teemo/Skins/Skin0")
    );
}
