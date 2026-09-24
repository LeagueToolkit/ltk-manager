use std::collections::HashMap;
use std::path::Path;

use assert_matches::assert_matches;
use fs_err as fs;
use ltk_hash::Hash as _;
use ltk_meta::property::values;

use super::*;
use crate::bin_document::{BinDocuments, LeafValue, ReadOnly};
use crate::meta_schema;
use crate::preview::AssetRef;

pub(super) const SKIN: &str = "Characters/Teemo/Skins/Skin0";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

pub(super) fn h(name: &str) -> BinHash {
    BinHash::hash_str(name)
}

/// The game, naming what `names` holds and declaring what `chunks` holds.
pub(super) struct Game {
    names: HashMap<BinHash, &'static str>,
    chunks: HashMap<BinHash, Vec<u8>>,
}

impl Game {
    pub(super) fn naming(names: &[&'static str]) -> Arc<Self> {
        Self::declaring(names, HashMap::new())
    }

    /// The game whose chunk of each entry of `chunks` is the bytes beside it.
    pub(super) fn declaring(
        names: &[&'static str],
        chunks: HashMap<BinHash, Vec<u8>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            names: names.iter().map(|name| (h(name), *name)).collect(),
            chunks,
        })
    }
}

impl GameCopy for Game {
    fn declaring_chunk(&self, entry: BinHash) -> AppResult<Option<Vec<u8>>> {
        Ok(self.chunks.get(&entry).cloned())
    }

    fn with_names(&self, read: &mut dyn FnMut(&dyn RowNames)) {
        read(self);
    }
}

impl RowNames for Game {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.for_each_field(hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.for_each_field(hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if let Some(name) = self.names.get(hash) {
                visit(at, name);
            }
        }
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.for_each_field(hashes, visit);
    }

    fn for_each_chunk(&self, _hashes: &[WadHash], _visit: &mut dyn FnMut(usize, &str)) {}
}

/// A project directory with a `base` and a `chroma` layer.
pub(super) fn project(dir: &Path) -> ProjectDir {
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

/// The game's copy of Teemo's skin: a glow inside an embed, a list, and an unnamed field.
pub(super) fn game_bin() -> Vec<u8> {
    let mesh = values::Embedded(values::Struct {
        class_hash: h("SkinMeshDataProperties"),
        properties: [
            (h("selfIllumination"), values::F32::new(0.0).into()),
            (
                h("texture"),
                values::String::new("assets/teemo.tex".to_owned()).into(),
            ),
        ]
        .into(),
    });
    let object = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(h("skinMeshProperties"), mesh)
        .property(
            h("championSkinName"),
            values::String::new("Teemo".to_owned()),
        )
        .property(
            h("tags"),
            values::Container::new(
                ltk_meta::property::Kind::Hash,
                vec![values::Hash::new(h("a")).into()],
            )
            .unwrap(),
        )
        .property(BinHash(0x1234_5678), values::U8::new(1))
        .build();
    let mut bytes = Cursor::new(Vec::new());
    Bin::builder()
        .object(object)
        .build()
        .to_writer(&mut bytes)
        .unwrap();
    bytes.into_inner()
}

pub(super) fn declared(project: ProjectDir) -> BinDocument {
    let context = DeclareContext {
        project,
        schema: PatchSchema::new(meta_schema::shared(None), None),
        game: Game::naming(&[
            SKIN,
            "skinMeshProperties",
            "selfIllumination",
            "texture",
            "championSkinName",
            "tags",
            "a",
        ]),
    };
    BinDocument::declare(game_bin(), ltk_game_data::path_hash(CHUNK), context).unwrap()
}

fn glow_path() -> String {
    format!(
        "{:08x}.{:08x}",
        *h("skinMeshProperties"),
        *h("selfIllumination")
    )
}

fn glow(document: &BinDocument) -> f32 {
    let object = document.object_at(h(SKIN)).unwrap();
    let path = PropertyPath::new("skinMeshProperties.selfIllumination").unwrap();
    match object.resolve(&path).unwrap() {
        PropertyValueEnum::F32(value) => value.value,
        other => panic!("the glow is {other:?}"),
    }
}

pub(super) fn manifest(dir: &Path, layer: &str) -> String {
    fs::read_to_string(
        dir.join("content")
            .join(layer)
            .join(ltk_declarations::FILE_NAME),
    )
    .unwrap()
}

#[test]
fn a_hand_written_manifest_applies_and_marks_the_row_it_touches() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!("version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"),
    )
    .unwrap();

    let document = declared(project);

    assert!((glow(&document) - 0.37).abs() < f32::EPSILON);
    let state = document.declared_state().unwrap();
    assert_eq!(state.layer, "base");
    assert_eq!(state.layers, ["base", "chroma"]);
    assert_eq!(
        state.marks,
        [DeclaredMark {
            entry: hex(h(SKIN)),
            path: glow_path(),
            property: "skinMeshProperties.selfIllumination".to_owned(),
            module: 0,
            module_name: None,
            sign: DeclaredSign::Set,
            whole: false,
            reference: None,
            game: Some("0.0".to_owned()),
        }]
    );
}

#[test]
fn a_block_set_marks_each_key_of_the_block() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!("version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties:\n          selfIllumination: 0.5\n          texture: assets/jade.tex\n"),
    )
    .unwrap();

    let state = declared(project).declared_state().unwrap();

    let paths: Vec<&str> = state.marks.iter().map(|mark| mark.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            glow_path(),
            format!("{:08x}.{:08x}", *h("skinMeshProperties"), *h("texture")),
        ]
    );
    assert_eq!(state.marks[1].game.as_deref(), Some("assets/teemo.tex"));
}

#[test]
fn a_leaf_set_writes_one_line_and_marks_its_row() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    let held = document
        .set_leaf(h(SKIN), &glow_path(), LeafValue::Float { value: 0.37 })
        .unwrap();

    assert_eq!(held, LeafValue::Float { value: 0.0 });
    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"
        ),
    );
    assert!((glow(&document) - 0.37).abs() < f32::EPSILON);
    assert!(!document.is_dirty());
    let marks = document.declared_state().unwrap().marks;
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0].path, glow_path());
}

#[test]
fn undo_removes_the_line_and_the_mark_and_redo_restores_both() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    document
        .set_leaf(h(SKIN), &glow_path(), LeafValue::Float { value: 0.37 })
        .unwrap();

    assert!(document.undo().unwrap());
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
    assert!(glow(&document).abs() < f32::EPSILON);
    assert!(document.declared_state().unwrap().marks.is_empty());
    assert!(!document.undo().unwrap());

    assert!(document.redo().unwrap());
    assert!(manifest(dir.path(), "base").contains("selfIllumination: 0.37"));
    assert!((glow(&document) - 0.37).abs() < f32::EPSILON);
    assert_eq!(document.declared_state().unwrap().marks.len(), 1);
}

#[test]
fn an_undo_over_a_manifest_edited_since_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    document
        .set_leaf(h(SKIN), &glow_path(), LeafValue::Float { value: 0.37 })
        .unwrap();
    let file = dir.path().join("content/base/game_data.yaml");
    fs::write(&file, format!("# mine\n{}", manifest(dir.path(), "base"))).unwrap();

    assert_matches!(document.undo(), Err(BinDocumentError::Declaring(_)));
    assert!(manifest(dir.path(), "base").starts_with("# mine\n"));
}

#[test]
fn a_declaration_of_another_layer_applies_with_no_mark() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/chroma/game_data.yaml"),
        format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        championSkinName: Jade\n"
        ),
    )
    .unwrap();

    let mut document = declared(project);

    assert!(document.declared_state().unwrap().marks.is_empty());
    let name = document
        .object_at(h(SKIN))
        .unwrap()
        .properties
        .get(&h("championSkinName"))
        .cloned();
    assert_eq!(name, Some(values::String::new("Jade".to_owned()).into()));

    let state = document
        .declare_into("chroma", DeclaredModuleChoice::Auto)
        .unwrap();
    assert_eq!(state.layer, "chroma");
    assert_eq!(state.marks.len(), 1);
    assert_matches!(
        document.declare_into("missing", DeclaredModuleChoice::Auto),
        Err(BinDocumentError::Declaring(_))
    );
}

#[test]
fn an_edit_lands_in_the_chosen_layer() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    document
        .declare_into("chroma", DeclaredModuleChoice::Auto)
        .unwrap();

    document
        .set_leaf(
            h(SKIN),
            &format!("{:08x}", *h("championSkinName")),
            LeafValue::String {
                value: "Jade".to_owned(),
            },
        )
        .unwrap();

    assert!(manifest(dir.path(), "chroma").contains("championSkinName: Jade"));
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}

#[test]
fn a_path_through_a_nameless_field_is_refused_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    assert_matches!(
        document.set_leaf(
            h(SKIN),
            "12345678",
            LeafValue::Integer {
                text: "2".to_owned()
            }
        ),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::NamelessPath,
            ..
        })
    );
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
    let held = document
        .object_at(h(SKIN))
        .unwrap()
        .properties
        .get(&BinHash(0x1234_5678))
        .cloned();
    assert_eq!(held, Some(values::U8::new(1).into()));
}

#[test]
fn an_edit_no_declaration_expresses_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    assert_matches!(
        document.remove_property(h(SKIN), &format!("{:08x}", *h("championSkinName"))),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::Undeclarable,
            ..
        })
    );
}

fn teemo_chunk(project: Option<String>) -> AssetRef {
    AssetRef::GameChunk {
        wad: "Champions/Teemo.wad.client".to_owned(),
        path_hash: format!("{:016x}", ltk_game_data::path_hash(CHUNK)),
        project,
    }
}

#[test]
fn a_declared_game_chunk_takes_edits_only_while_declaring_and_a_bare_one_never() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let inside = teemo_chunk(Some(dir.path().display().to_string()));

    assert_eq!(document.read_only(&inside), Some(ReadOnly::DeclarationsOff));

    document.set_declaring(Declaring::On).unwrap();
    assert_eq!(document.read_only(&inside), None);

    let mut bare = BinDocument::parse(game_bin()).unwrap();
    assert_eq!(bare.read_only(&teemo_chunk(None)), Some(ReadOnly::Install));
    assert_matches!(
        bare.set_declaring(Declaring::On),
        Err(BinDocumentError::Declaring(_))
    );
}

#[test]
fn the_store_refuses_every_declaring_edit_while_declarations_are_off() {
    let dir = tempfile::tempdir().unwrap();
    let project_dir = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!("version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"),
    )
    .unwrap();
    let before = manifest(dir.path(), "base");
    let store = BinDocuments::new(std::num::NonZeroUsize::new(2).unwrap());
    let id = store
        .open_declared(
            teemo_chunk(Some(dir.path().display().to_string())),
            ltk_game_data::path_hash(CHUNK),
            || {
                let context = declared(project_dir).declared.take().unwrap().context;
                Ok((game_bin(), context))
            },
        )
        .unwrap();

    assert_eq!(
        store.read_only(id).unwrap(),
        Some(ReadOnly::DeclarationsOff)
    );
    assert_matches!(
        store.patch(id, h(SKIN), &glow_path(), LeafValue::Float { value: 0.5 }),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.declare_reference(id, h(SKIN), &glow_path(), "0x1:a", false),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.undo(id),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.declared_module_action(id, "base", &ModuleAction::Remove { module: 0 }),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.create_object(
            id,
            "Mods/jade-teemo/Glow",
            &NewObject::Clone {
                source: hex(h(SKIN)),
            },
        ),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.remove_object(id, h(SKIN)),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_matches!(
        store.restore_object(id, h(SKIN)),
        Err(BinDocumentError::ReadOnly(ReadOnly::DeclarationsOff))
    );
    assert_eq!(manifest(dir.path(), "base"), before);
    store
        .read(id, |document| {
            assert!((glow(document) - 0.37).abs() < f32::EPSILON);
            assert_eq!(document.declared_state().unwrap().marks.len(), 1);
            Ok(())
        })
        .unwrap();

    assert_eq!(store.set_declaring(id, Declaring::On).unwrap(), None);
    store
        .patch(id, h(SKIN), &glow_path(), LeafValue::Float { value: 0.5 })
        .unwrap();
    assert_ne!(manifest(dir.path(), "base"), before);
}

/// Times one re-apply over the largest `PROP` chunk of the champion archives, which is a
/// skin bin: the cost every edit of a declared document pays.
#[test]
#[ignore = "reads a game install, and needs LTK_LIVE_GAME"]
fn one_reapply_over_the_largest_skin_bin_is_timed() {
    let Ok(game) = std::env::var("LTK_LIVE_GAME") else {
        panic!("set LTK_LIVE_GAME to the install's DATA/FINAL directory");
    };
    let mut largest: Option<(std::path::PathBuf, ltk_wad::WadChunk)> = None;
    for archive in fs::read_dir(Path::new(&game).join("Champions")).unwrap() {
        let path = archive.unwrap().path();
        let is_base = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".wad.client") && !name.contains('_'));
        if !is_base {
            continue;
        }
        let mut wad = ltk_wad::Wad::mount(fs::File::open(&path).unwrap()).unwrap();
        let chunks: Vec<_> = wad.chunks().iter().copied().collect();
        for chunk in chunks {
            let bigger = largest
                .as_ref()
                .is_none_or(|(_, held)| chunk.uncompressed_size() > held.uncompressed_size());
            if bigger
                && wad
                    .load_chunk_decompressed(&chunk)
                    .is_ok_and(|bytes| bytes.starts_with(b"PROP"))
            {
                largest = Some((path.clone(), chunk));
            }
        }
    }
    let (archive, chunk) = largest.expect("a champion archive holds a PROP");
    let mut wad = ltk_wad::Wad::mount(fs::File::open(&archive).unwrap()).unwrap();
    let bytes = wad.load_chunk_decompressed(&chunk).unwrap().into_vec();

    let BinFile::Prop(bin) = BinFile::from_reader(&mut Cursor::new(&bytes)).unwrap() else {
        panic!("the chunk is a PROP");
    };
    let skin = bin
        .objects
        .values()
        .find(|object| object.class_hash == h("SkinCharacterDataProperties"))
        .expect("the largest PROP is a skin bin");

    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!(
            "version: 1\nmodules:\n  - entries:\n      \"{}\":\n        championSkinName: Timed\n",
            hex(skin.path_hash)
        ),
    )
    .unwrap();
    let context = DeclareContext {
        project,
        schema: PatchSchema::new(meta_schema::shared(None), None),
        game: Game::naming(&["championSkinName"]),
    };
    let mut document = BinDocument::declare(bytes.clone(), chunk.path_hash().0, context).unwrap();
    assert_eq!(document.declared_state().unwrap().marks.len(), 1);

    let started = std::time::Instant::now();
    const RUNS: u32 = 5;
    for _ in 0..RUNS {
        document.reapply().unwrap();
    }
    println!(
        "{}  {:016x}  {} KiB  {} objects  {:?} per re-apply",
        archive.display(),
        chunk.path_hash().0,
        bytes.len() / 1024,
        bin.objects.len(),
        started.elapsed() / RUNS,
    );
}

/// A base layer of two `entries` modules: the glow of the skin, then a named one declaring
/// an entry the chunk lacks.
fn two_modules(dir: &Path) -> String {
    let text = format!(
        "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.5\n  - name: Later\n    entries:\n      Characters/Other:\n        q: 1\n"
    );
    fs::write(dir.join("content/base/game_data.yaml"), &text).unwrap();
    text
}

fn skin_name_path() -> String {
    format!("{:08x}", *h("championSkinName"))
}

#[test]
fn an_edit_lands_in_the_chosen_module_and_its_mark_names_it() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let text = two_modules(dir.path());
    let mut document = declared(project);

    let state = document
        .declare_into("base", DeclaredModuleChoice::Index { index: 1 })
        .unwrap();
    assert_eq!(
        state.modules,
        [
            DeclaredModuleSummary {
                index: 0,
                name: None,
                takes_keys: true,
            },
            DeclaredModuleSummary {
                index: 1,
                name: Some("Later".to_owned()),
                takes_keys: true,
            },
        ]
    );
    document
        .set_leaf(
            h(SKIN),
            &skin_name_path(),
            LeafValue::String {
                value: "Jade".to_owned(),
            },
        )
        .unwrap();

    assert_eq!(
        manifest(dir.path(), "base"),
        format!("{text}      {SKIN}:\n        championSkinName: Jade\n")
    );
    let state = document.declared_state().unwrap();
    let module_of = |path: &str| {
        state
            .marks
            .iter()
            .find(|mark| mark.path == path)
            .map(|mark| (mark.module, mark.module_name.clone()))
    };
    assert_eq!(module_of(&glow_path()), Some((0, None)));
    assert_eq!(
        module_of(&skin_name_path()),
        Some((1, Some("Later".to_owned())))
    );
}

#[test]
fn a_new_module_choice_makes_one_module_that_later_edits_join() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let text = two_modules(dir.path());
    let mut document = declared(project);
    document
        .declare_into(
            "base",
            DeclaredModuleChoice::New {
                name: Some("Name".to_owned()),
            },
        )
        .unwrap();

    document
        .set_leaf(
            h(SKIN),
            &skin_name_path(),
            LeafValue::String {
                value: "Jade".to_owned(),
            },
        )
        .unwrap();
    assert_eq!(
        document.declared_state().unwrap().module,
        DeclaredModuleChoice::Index { index: 2 }
    );
    document
        .set_leaf(
            h(SKIN),
            &format!("{:08x}.{:08x}", *h("skinMeshProperties"), *h("texture")),
            LeafValue::String {
                value: "assets/jade.tex".to_owned(),
            },
        )
        .unwrap();

    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "{text}  - name: Name\n    entries:\n      {SKIN}:\n        championSkinName: Jade\n        skinMeshProperties.texture: assets/jade.tex\n"
        )
    );
}

#[test]
fn a_key_moved_between_modules_keeps_the_view_and_undoes() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let text = two_modules(dir.path());
    let mut document = declared(project);

    let state = document
        .declared_module_action(
            "base",
            &ModuleAction::MoveKeys {
                module: 0,
                entry: SKIN.to_owned(),
                path: Some("skinMeshProperties.selfIllumination".to_owned()),
                to: 1,
            },
        )
        .unwrap();

    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - name: Later\n    entries:\n      Characters/Other:\n        q: 1\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.5\n"
        )
    );
    assert!((glow(&document) - 0.5).abs() < f32::EPSILON);
    assert_eq!(state.modules.len(), 1);
    assert_eq!(state.marks[0].module_name.as_deref(), Some("Later"));

    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), text);
    assert_eq!(document.declared_state().unwrap().modules.len(), 2);
}
