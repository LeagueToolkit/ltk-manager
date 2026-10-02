//! The walk: embedded class hits, link and hash hits, file hits, the paths they carry,
//! and a walk over a synthetic install and a project's layers.

use super::*;
use crate::bin_document::{BinDocument, RowNames};
use crate::problems::Budget;
use ltk_meta::property::Kind;
use std::sync::atomic::{AtomicU32, Ordering};

use super::super::walk::{FileTarget, HitStep, WalkHit, scan_bin, spelled_property};

const SKIN: &str = "characters/aatrox/skins/skin0";
const RESOURCES: &str = "characters/aatrox/skins/skin0/resources";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn part(name: &str) -> values::Struct {
    values::Struct {
        class_hash: h("Part"),
        properties: [(h("name"), values::String::from(name).into())]
            .into_iter()
            .collect(),
    }
}

/// A skin holding `Part` at every depth a class can sit, and links to its resources at
/// every depth a link can sit.
fn skin() -> BinObject {
    let lookup = values::Map::new(
        Kind::Hash,
        Kind::ObjectLink,
        vec![
            (
                values::Hash::new(h(RESOURCES)).into(),
                values::ObjectLink::new(h("characters/elsewhere")).into(),
            ),
            (
                values::Hash::new(h("weapon")).into(),
                values::ObjectLink::new(h(RESOURCES)).into(),
            ),
        ],
    )
    .unwrap();
    let parts = values::Container::new(
        Kind::Embedded,
        vec![
            values::Embedded(part("p0")).into(),
            values::Embedded(part("p1")).into(),
        ],
    )
    .unwrap();

    BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(h("resolver"), values::ObjectLink::new(h(RESOURCES)))
        .property(h("material"), values::Hash::new(h(RESOURCES)))
        .property(
            h("unrelated"),
            values::ObjectLink::new(h("characters/other")),
        )
        .property(h("parts"), parts)
        .property(h("lookup"), lookup)
        .property(
            h("maybe"),
            values::Optional::from(Some(values::ObjectLink::new(h(RESOURCES)))),
        )
        .property(
            h("boxed"),
            values::Optional::from(Some(values::Embedded(part("b0")))),
        )
        .property(h("pointer"), part("s0"))
        .property(
            h("links"),
            values::Container::from(vec![
                values::ObjectLink::new(h("characters/other")),
                values::ObjectLink::new(h(RESOURCES)),
            ]),
        )
        .build()
}

fn skin_bytes() -> Vec<u8> {
    let bin = Bin::builder()
        .object(skin())
        .object(BinObject::new(h(RESOURCES), h("ResourceResolver")))
        .object(BinObject::new(h("characters/aatrox/parts/root"), h("Part")))
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn scanned(bytes: &[u8], target: WalkTarget) -> Vec<WalkHit> {
    let mut hits = Vec::new();
    scan_bin(bytes, &target, &mut hits).unwrap();
    hits
}

/// Each hit's hash path, read back through the grammar a row writes.
fn hash_paths(hits: &[WalkHit]) -> Vec<String> {
    let names = WalkNames::default();
    hits.iter()
        .map(|hit| hit_property(hit, &names).path)
        .collect()
}

/// The paths of every row the bin document draws under `entry`, at any depth.
fn row_paths(document: &BinDocument, entry: BinHash, path: &str, out: &mut Vec<String>) {
    let rows = document
        .children(entry, path, 0, usize::MAX, &(), None)
        .unwrap();
    for row in rows.rows {
        out.push(row.path.clone());
        row_paths(document, entry, &row.path, out);
    }
}

fn field(name: &str) -> String {
    format!("{:08x}", h(name))
}

#[test]
fn an_embedded_class_hits_every_pointer_and_embed_below_a_root() {
    let hits = scanned(&skin_bytes(), WalkTarget::Embedded(h("Part")));

    assert_eq!(
        hash_paths(&hits),
        [
            format!("{}[0]", field("parts")),
            format!("{}[1]", field("parts")),
            format!("{}[0]", field("boxed")),
            field("pointer"),
        ],
        "every value of the class in file order, and never an object declared as it"
    );
    assert!(hits.iter().all(|hit| hit.object == h(SKIN)));
    assert_eq!(hits[0].class, h("SkinCharacterDataProperties"));
}

#[test]
fn a_link_hits_through_link_and_hash_values_at_every_depth() {
    let hits = scanned(&skin_bytes(), WalkTarget::Linked(h(RESOURCES)));
    let resources_key = format!("{:08x}", h(RESOURCES));
    let weapon_key = format!("{:08x}", h("weapon"));

    assert_eq!(
        hash_paths(&hits),
        [
            field("resolver"),
            field("material"),
            format!("{}{{{resources_key}}}", field("lookup")),
            format!("{}{{{weapon_key}}}", field("lookup")),
            field("maybe"),
            format!("{}[1]", field("links")),
        ],
        "a link, a hash, a map key, a map value, an optional's leaf on its own row, and a list item"
    );
}

#[test]
fn every_hit_is_a_row_the_bin_document_draws() {
    let bytes = skin_bytes();
    let document = BinDocument::parse(bytes.clone()).unwrap();
    let mut rows = Vec::new();
    row_paths(&document, h(SKIN), "", &mut rows);

    for target in [
        WalkTarget::Embedded(h("Part")),
        WalkTarget::Linked(h(RESOURCES)),
    ] {
        for path in hash_paths(&scanned(&bytes, target.clone())) {
            assert!(rows.contains(&path), "no row at {path} for {target:?}");
        }
    }
}

#[test]
fn a_repeated_key_hits_on_the_row_of_the_entry_that_links() {
    let map = values::Map::new(
        Kind::Hash,
        Kind::ObjectLink,
        vec![
            (
                values::Hash::new(h("run")).into(),
                values::ObjectLink::new(h("characters/elsewhere")).into(),
            ),
            (
                values::Hash::new(h("run")).into(),
                values::ObjectLink::new(h(RESOURCES)).into(),
            ),
        ],
    )
    .unwrap();
    let bin = Bin::builder()
        .object(
            BinObject::builder(h(SKIN), h("Skin"))
                .property(h("clips"), map)
                .build(),
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    let bytes = out.into_inner();

    let paths = hash_paths(&scanned(&bytes, WalkTarget::Linked(h(RESOURCES))));
    assert_eq!(paths, [format!("{}{{{:08x}}}#1", field("clips"), h("run"))]);

    let document = BinDocument::parse(bytes).unwrap();
    let mut rows = Vec::new();
    row_paths(&document, h(SKIN), "", &mut rows);
    assert!(rows.contains(&paths[0]));
}

#[test]
fn a_patch_walks_the_objects_it_adds() {
    let mut bin = BinOverride::new();
    let object = BinObject::builder(h("characters/added"), h("Added"))
        .property(h("resolver"), values::ObjectLink::new(h(RESOURCES)))
        .build();
    bin.objects.insert(object.path_hash, object);
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();

    let hits = scanned(&out.into_inner(), WalkTarget::Linked(h(RESOURCES)));
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].object, h("characters/added"));
    assert_eq!(
        hits[0].steps,
        [HitStep::Field {
            class: h("Added"),
            field: h("resolver")
        }]
    );
}

#[test]
fn a_map_entry_whose_key_and_value_both_link_is_one_hit() {
    let map = values::Map::new(
        Kind::Hash,
        Kind::ObjectLink,
        vec![(
            values::Hash::new(h(RESOURCES)).into(),
            values::ObjectLink::new(h(RESOURCES)).into(),
        )],
    )
    .unwrap();
    let bin = Bin::builder()
        .object(
            BinObject::builder(h(SKIN), h("Skin"))
                .property(h("lookup"), map)
                .build(),
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();

    assert_eq!(
        scanned(&out.into_inner(), WalkTarget::Linked(h(RESOURCES))).len(),
        1
    );
}

const TEXTURE: &str = "assets/characters/aatrox/skins/base/aatrox_base_tx_cm.tex";

/// A skin naming [`TEXTURE`] as every kind of value a file can be named by, and as an
/// object link, which names no file.
fn texture_bytes() -> Vec<u8> {
    let by_chunk = values::Map::new(
        Kind::WadChunkLink,
        Kind::String,
        vec![(
            values::WadChunkLink::new(WadHash::hash_str(TEXTURE)).into(),
            values::String::from("diffuse").into(),
        )],
    )
    .unwrap();
    let object = BinObject::builder(h(SKIN), h("SkinMeshDataProperties"))
        .property(h("texture"), values::String::from(TEXTURE.to_uppercase()))
        .property(h("textureHash"), values::Hash::new(h(TEXTURE)))
        .property(
            h("textureFile"),
            values::WadChunkLink::new(WadHash::hash_str(TEXTURE)),
        )
        .property(h("notAFile"), values::ObjectLink::new(h(TEXTURE)))
        .property(h("other"), values::String::from("assets/other.tex"))
        .property(
            h("layers"),
            values::Container::from(vec![
                values::String::from("assets/other.tex"),
                values::String::from(TEXTURE),
            ]),
        )
        .property(h("byChunk"), by_chunk)
        .build();
    let bin = Bin::builder().object(object).build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

#[test]
fn a_named_file_hits_through_string_hash_and_file_values_at_every_depth() {
    let bytes = texture_bytes();
    let hits = scanned(&bytes, WalkTarget::File(FileTarget::named(TEXTURE)));
    let chunk_key = format!("{:016x}", WadHash::hash_str(TEXTURE).0);

    let paths = hash_paths(&hits);
    assert_eq!(
        paths,
        [
            field("texture"),
            field("textureHash"),
            field("textureFile"),
            format!("{}[1]", field("layers")),
            format!("{}{{{chunk_key}}}", field("byChunk")),
        ],
        "a string in any case, a hash, a file, a list item and a map key, never a link"
    );

    let document = BinDocument::parse(bytes).unwrap();
    let mut rows = Vec::new();
    row_paths(&document, h(SKIN), "", &mut rows);
    for path in &paths {
        assert!(rows.contains(path), "no row at {path}");
    }
}

#[test]
fn an_unnamed_chunk_hits_through_file_values_alone() {
    let hits = scanned(
        &texture_bytes(),
        WalkTarget::File(FileTarget::unnamed(WadHash::hash_str(TEXTURE))),
    );
    let chunk_key = format!("{:016x}", WadHash::hash_str(TEXTURE).0);

    assert_eq!(
        hash_paths(&hits),
        [
            field("textureFile"),
            format!("{}{{{chunk_key}}}", field("byChunk")),
        ]
    );
}

/// Names for the fields and hashes the fixture writes.
#[derive(Default)]
struct WalkNames {
    fields: HashMap<BinHash, String>,
    values: HashMap<BinHash, String>,
    entries: HashMap<BinHash, String>,
    classes: HashMap<BinHash, String>,
}

impl WalkNames {
    fn over(fields: &[&str], values: &[&str], entries: &[&str], classes: &[&str]) -> Self {
        let table = |names: &[&str]| {
            names
                .iter()
                .map(|name| (h(name), (*name).to_owned()))
                .collect()
        };
        Self {
            fields: table(fields),
            values: table(values),
            entries: table(entries),
            classes: table(classes),
        }
    }
}

fn visit_each(
    table: &HashMap<BinHash, String>,
    hashes: &[BinHash],
    visit: &mut dyn FnMut(usize, &str),
) {
    for (at, hash) in hashes.iter().enumerate() {
        if let Some(name) = table.get(hash) {
            visit(at, name);
        }
    }
}

impl RowNames for WalkNames {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.entries, hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.classes, hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.fields, hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.values, hashes, visit);
    }

    fn for_each_chunk(&self, _hashes: &[WadHash], _visit: &mut dyn FnMut(usize, &str)) {}
}

/// The property a hit reads as, through `names` and no schema.
fn hit_property(hit: &WalkHit, names: &WalkNames) -> ReferenceProperty {
    spelled_property(hit, names)
}

/// A project directory with one `base` layer holding `files`, each a path and its bytes.
fn project_with(files: &[(&str, Vec<u8>)]) -> TempDir {
    let tmp = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        let at = tmp.path().join("content").join("base").join(path);
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        fs::write(at, bytes).unwrap();
    }
    tmp
}

fn linking_bin(object: &str) -> Vec<u8> {
    let bin = Bin::builder()
        .object(
            BinObject::builder(h(object), h("Skin"))
                .property(h("resolver"), values::ObjectLink::new(h(RESOURCES)))
                .build(),
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// An install of two archives linking to the resources, and a project linking once more.
struct Fixture {
    _game: TempDir,
    project: TempDir,
    index: ObjectIndex,
    archives: GameArchives,
}

fn fixture() -> Fixture {
    let first: &[Chunk<'_>] = &[
        ("data/a.bin", linking_bin("characters/a")),
        ("data/none.bin", prop(&[("characters/none", "Skin")])),
    ];
    let second: &[Chunk<'_>] = &[("data/b.bin", linking_bin("characters/b"))];
    let wads: &[(&str, &[Chunk<'_>])] = &[("A.wad.client", first), ("B.wad.client", second)];
    let (game, index) = build(wads, 1);
    let archives = GameArchives::at(game.path());
    let project = project_with(&[("data/mine.bin", linking_bin("characters/mine"))]);
    Fixture {
        _game: game,
        project,
        index,
        archives,
    }
}

fn names() -> WalkNames {
    WalkNames::over(
        &["resolver"],
        &[],
        &["characters/a", "characters/b", "characters/mine"],
        &["Skin"],
    )
}

#[test]
fn the_walk_groups_the_layers_first_and_then_the_install_in_archive_order() {
    let fixture = fixture();
    let project = fixture.project.path().to_str().unwrap();
    let layers = layer_bins(project).unwrap();
    let budget = Budget::sweep();
    let request = WalkRequest {
        target: WalkTarget::Linked(h(RESOURCES)),
        layers: &layers,
        archives: &fixture.archives,
        budget: &budget,
        workers: 2,
    };
    let reports = AtomicU32::new(0);

    let result = fixture.index.walk(
        &request,
        &names(),
        None,
        || false,
        |_| {
            reports.fetch_add(1, Ordering::Relaxed);
        },
    );

    let files: Vec<&str> = result
        .groups
        .iter()
        .map(|group| group.file.as_str())
        .collect();
    assert_eq!(files, ["data/mine.bin", "data/a.bin", "data/b.bin"]);
    assert_eq!(
        result.groups[0].asset,
        AssetRef::Layer {
            project: project.to_owned(),
            layer: "base".to_owned(),
            path: "data/mine.bin".to_owned(),
        }
    );
    let hit = &result.groups[1].objects[0];
    assert_eq!(hit.path, "characters/a");
    assert_eq!(hit.class, "Skin");
    assert_eq!(
        hit.property,
        Some(ReferenceProperty {
            path: field("resolver"),
            label: "resolver".to_owned(),
        })
    );
    assert_eq!(result.total, 3);
    assert!(!result.cancelled && !result.superseded);
    assert_eq!(
        reports.load(Ordering::Relaxed),
        4,
        "one report per bin: the layer's and the install's three"
    );
}

#[test]
fn a_cancelled_walk_says_so_and_keeps_what_it_found() {
    let fixture = fixture();
    let budget = Budget::sweep();
    budget.cancel();
    let request = WalkRequest {
        target: WalkTarget::Linked(h(RESOURCES)),
        layers: &[],
        archives: &fixture.archives,
        budget: &budget,
        workers: 1,
    };

    let result = fixture
        .index
        .walk(&request, &names(), None, || false, |_| {});
    assert!(result.cancelled);
    assert!(!result.superseded);
    assert!(result.groups.is_empty());
}

#[test]
fn an_overtaken_walk_is_superseded_rather_than_cancelled() {
    let fixture = fixture();
    let budget = Budget::sweep();
    let request = WalkRequest {
        target: WalkTarget::Linked(h(RESOURCES)),
        layers: &[],
        archives: &fixture.archives,
        budget: &budget,
        workers: 1,
    };

    let result = fixture
        .index
        .walk(&request, &names(), None, || true, |_| {});
    assert!(result.superseded);
    assert!(!result.cancelled);
}

#[test]
fn the_walk_caps_the_rows_and_counts_on_past_the_cap() {
    let fixture = fixture();
    let budget = Budget::sweep();
    let request = WalkRequest {
        target: WalkTarget::Linked(h(RESOURCES)),
        layers: &[],
        archives: &fixture.archives,
        budget: &budget,
        workers: 1,
    };

    let result = fixture
        .index
        .walk_capped(&request, &names(), None, 1, || false, |_| {});
    let files: Vec<&str> = result
        .groups
        .iter()
        .map(|group| group.file.as_str())
        .collect();
    assert_eq!(files, ["data/a.bin"]);
    assert_eq!(result.total, 2);
}

#[test]
fn a_hit_spells_its_path_through_the_tables_and_hex_where_they_miss() {
    let hit = WalkHit {
        object: h(SKIN),
        class: h("Skin"),
        steps: vec![
            HitStep::Field {
                class: h("Skin"),
                field: h("lookup"),
            },
            HitStep::Key {
                text: format!("{:08x}", h("weapon")).into(),
                hash: Some(h("weapon")),
                occurrence: 0,
            },
            HitStep::Field {
                class: h("Part"),
                field: BinHash(0x9c4e_1b02),
            },
            HitStep::Index(2),
            HitStep::Key {
                text: "3".into(),
                hash: None,
                occurrence: 1,
            },
            HitStep::Key {
                text: "deadbeef".into(),
                hash: Some(BinHash(0xdead_beef)),
                occurrence: 0,
            },
        ],
    };
    let names = WalkNames::over(&["lookup"], &["weapon"], &[], &[]);

    let property = hit_property(&hit, &names);
    assert_eq!(
        property.path,
        format!(
            "{}{{{:08x}}}.9c4e1b02[2]{{3}}#1{{deadbeef}}",
            field("lookup"),
            h("weapon")
        )
    );
    assert_eq!(
        property.label,
        "lookup{\"weapon\"}.0x9c4e1b02[2]{3}#1{0xdeadbeef}"
    );
}

#[test]
fn layer_bins_lists_every_bin_of_every_layer_and_nothing_else() {
    let project = project_with(&[
        ("data/b.bin", linking_bin("characters/b")),
        ("data/a.BIN", linking_bin("characters/a")),
        ("data/texture.dds", vec![0; 4]),
    ]);
    let bins = layer_bins(project.path().to_str().unwrap()).unwrap();
    let files: Vec<&str> = bins.iter().map(|bin| bin.file.as_str()).collect();
    assert_eq!(files, ["data/a.BIN", "data/b.bin"]);
}

#[test]
fn a_project_with_no_content_holds_no_layer_bins() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(layer_bins(tmp.path().to_str().unwrap()).unwrap().is_empty());
}
