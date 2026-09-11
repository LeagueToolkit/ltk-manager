//! Unit tests for the system walk: what a link answers, where a name field lands, how a
//! leaf reads, and what the caps refuse.

use std::io::Cursor;

use ltk_hash::Hash as _;
use ltk_meta::property::{Kind, NoMeta};
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::bin_document::resolve::RESOURCE_MAP;
use crate::preview::AssetRef;

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

const SYSTEM: &str = "Vfx/Simple/System";
const CHILD: &str = "Vfx/Simple/Child";
const TEXTURE: &str = "ASSETS/Effects/Textures/Glow.dds";
const MISSING: &str = "ASSETS/Effects/Textures/Absent.dds";

/// A colour, whose channels the walk answers as fractions.
fn color(channels: [u8; 4]) -> values::Color {
    let mut color = values::Color::default();
    let [r, g, b, a] = channels;
    color.value.r = r;
    color.value.g = g;
    color.value.b = b;
    color.value.a = a;
    color
}

fn embedded(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    values::Embedded(values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
        meta: NoMeta,
    })
}

/// One emitter carrying a leaf of every shape the walk reads apart.
fn emitter() -> values::Embedded {
    let lookup = values::Map::new(
        Kind::Hash,
        Kind::String,
        vec![
            (
                values::Hash::new(h("weapon")).into(),
                values::String::from("sword").into(),
            ),
            (
                values::Hash::new(0xdead_beefu32).into(),
                values::String::from("shield").into(),
            ),
        ],
    )
    .unwrap();

    embedded(
        "VfxEmitterDefinitionData",
        vec![
            (h("texture"), values::String::from(TEXTURE).into()),
            (h("falloffTexture"), values::String::from(MISSING).into()),
            (h("emitterName"), values::String::from(TEXTURE).into()),
            (h("blendMode"), values::U8::new(4).into()),
            (h("Color"), color([255, 128, 0, 51]).into()),
            (h("primitive"), values::Struct::default().into()),
            (
                h("lifetime"),
                values::Optional::from(Some(values::F32::new(2.5))).into(),
            ),
            (
                h("rate"),
                values::Optional::<NoMeta>::empty(Kind::F32).unwrap().into(),
            ),
            (h("lookup"), lookup.into()),
            (
                h("textureMult"),
                embedded(
                    "VfxTextureMultDefinitionData",
                    vec![(h("textureMult"), values::String::from(TEXTURE).into())],
                )
                .into(),
            ),
        ],
    )
}

fn system() -> BinObject {
    BinObject::builder(h(SYSTEM), h("VfxSystemDefinitionData"))
        .property(
            h("complexEmitterDefinitionData"),
            values::Container::from(vec![emitter()]),
        )
        .property(h("child"), values::ObjectLink::new(h(CHILD)))
        .property(h("stranger"), values::ObjectLink::new(h("Vfx/Nowhere")))
        .build()
}

/// The object the system links to, which links back to it.
fn child() -> BinObject {
    BinObject::builder(h(CHILD), h("VfxChildData"))
        .property(h("parent"), values::ObjectLink::new(h(SYSTEM)))
        .property(h("emitterName"), values::String::from("spark"))
        .build()
}

fn document_of(objects: Vec<BinObject>) -> BinDocument {
    let mut bin = Bin::<NoMeta>::builder();
    for object in objects {
        bin = bin.object(object);
    }
    let mut out = Cursor::new(Vec::new());
    bin.build().to_writer(&mut out).unwrap();
    BinDocument::parse(&out.into_inner()).unwrap()
}

fn document() -> BinDocument {
    document_of(vec![system(), child()])
}

/// Tables that name what the fixture writes with a name, and nothing else.
#[derive(Default)]
struct Tables {
    entries: HashMap<BinHash, &'static str>,
    classes: HashMap<BinHash, &'static str>,
    fields: HashMap<BinHash, &'static str>,
    values: HashMap<BinHash, &'static str>,
}

fn named() -> Tables {
    let bin = |names: &[&'static str]| -> HashMap<BinHash, &'static str> {
        names.iter().map(|name| (h(name), *name)).collect()
    };
    Tables {
        entries: bin(&[SYSTEM, CHILD]),
        classes: bin(&[
            "VfxSystemDefinitionData",
            "VfxEmitterDefinitionData",
            "VfxChildData",
        ]),
        fields: bin(&[
            "complexEmitterDefinitionData",
            "child",
            "stranger",
            "parent",
            "texture",
            "falloffTexture",
            "emitterName",
            "blendMode",
            "Color",
            "primitive",
            "lifetime",
            "rate",
            "lookup",
            "deep",
            "inner",
            "wide",
            "textureMult",
            "effectKey",
        ]),
        values: bin(&["weapon"]),
    }
}

fn visit_each(
    table: &HashMap<BinHash, &'static str>,
    hashes: &[BinHash],
    visit: &mut dyn FnMut(usize, &str),
) {
    for (at, hash) in hashes.iter().enumerate() {
        if let Some(name) = table.get(hash) {
            visit(at, name);
        }
    }
}

impl RowNames for Tables {
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

/// A lookup that places one path and nothing else.
struct Placed;

impl Placed {
    fn asset() -> AssetRef {
        AssetRef::Layer {
            project: "C:/projects/glow".to_owned(),
            layer: "base".to_owned(),
            path: "Effects.wad.client/assets/effects/textures/glow.dds".to_owned(),
        }
    }
}

impl AssetLookup for Placed {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        (path.eq_ignore_ascii_case(TEXTURE)).then(Self::asset)
    }
}

/// The system of the fixture, resolved against the tables and the one placed path.
fn resolved() -> VfxSystem {
    resolve_system(&document(), h(SYSTEM), &named(), &Placed).unwrap()
}

fn field<'a>(value: &'a VfxValue, name: &str) -> &'a VfxValue {
    let VfxValue::Struct { fields, .. } = value else {
        panic!("not a struct: {value:?}");
    };
    fields
        .iter()
        .find(|field| field.name.as_deref() == Some(name))
        .map(|field| &field.value)
        .unwrap_or_else(|| panic!("no field named {name}"))
}

/// The one emitter of the fixture's system.
fn only_emitter(system: &VfxSystem) -> &VfxValue {
    let VfxValue::Container { items } = field(&system.root, "complexEmitterDefinitionData") else {
        panic!("the emitter list is no container");
    };
    &items[0]
}

#[test]
fn a_system_answers_its_own_class_and_properties() {
    let system = resolved();

    assert_eq!(system.entry, format!("0x{:08x}", h(SYSTEM).0));
    assert_eq!(system.name.as_deref(), Some(SYSTEM));
    assert_eq!(system.class.as_deref(), Some("VfxSystemDefinitionData"));
    assert!(matches!(system.root, VfxValue::Struct { .. }));
}

#[test]
fn a_link_to_an_object_of_the_document_inlines_that_objects_tree() {
    let system = resolved();
    let child = field(&system.root, "child");

    let VfxValue::Struct { class, .. } = child else {
        panic!("the link did not inline: {child:?}");
    };
    assert_eq!(class.as_deref(), Some("VfxChildData"));
    assert_eq!(
        field(child, "emitterName"),
        &VfxValue::String {
            value: "spark".to_owned()
        }
    );
}

#[test]
fn an_inlined_object_carries_the_entry_and_name_its_link_named() {
    let system = resolved();
    let VfxValue::Struct { object, .. } = field(&system.root, "child") else {
        panic!("the link did not inline");
    };

    assert_eq!(
        object.as_ref(),
        Some(&VfxObject {
            entry: format!("0x{:08x}", h(CHILD).0),
            name: Some(CHILD.to_owned()),
        })
    );
}

#[test]
fn an_embedded_struct_carries_no_object() {
    let system = resolved();
    let VfxValue::Struct { object, .. } = only_emitter(&system) else {
        panic!("the emitter is no struct");
    };

    assert_eq!(object, &None);
}

#[test]
fn a_link_back_into_an_open_object_answers_a_link_rather_than_recursing() {
    let system = resolved();
    let parent = field(field(&system.root, "child"), "parent");

    assert_eq!(
        parent,
        &VfxValue::Link {
            hash: format!("0x{:08x}", h(SYSTEM).0),
            name: Some(SYSTEM.to_owned()),
        }
    );
}

#[test]
fn a_link_to_an_object_the_document_lacks_answers_a_link() {
    let system = resolved();

    assert_eq!(
        field(&system.root, "stranger"),
        &VfxValue::Link {
            hash: format!("0x{:08x}", h("Vfx/Nowhere").0),
            name: None,
        }
    );
}

#[test]
fn a_texture_takes_the_asset_the_lookup_places() {
    let system = resolved();

    assert_eq!(
        field(only_emitter(&system), "texture"),
        &VfxValue::Asset {
            path: TEXTURE.to_owned(),
            asset: Some(Placed::asset()),
        }
    );
}

#[test]
fn a_texture_nothing_places_keeps_its_path_and_no_asset() {
    let system = resolved();

    assert_eq!(
        field(only_emitter(&system), "falloffTexture"),
        &VfxValue::Asset {
            path: MISSING.to_owned(),
            asset: None,
        }
    );
}

/// `textureMult` is a field on the emitter and a field on the class it points at, under
/// one hash. Only the string inside is a path, and the block holding it stays a block.
#[test]
fn the_texture_mult_block_keeps_its_fields_and_only_its_own_name_is_placed() {
    let system = resolved();

    let VfxValue::Struct { fields, .. } = field(only_emitter(&system), "textureMult") else {
        panic!("textureMult is the block it points at");
    };

    assert_eq!(
        fields
            .iter()
            .find(|held| held.hash == hex(h("textureMult")))
            .map(|held| &held.value),
        Some(&VfxValue::Asset {
            path: TEXTURE.to_owned(),
            asset: Some(Placed::asset()),
        })
    );
}

#[test]
fn a_string_field_that_names_no_asset_stays_a_string() {
    let system = resolved();

    assert_eq!(
        field(only_emitter(&system), "emitterName"),
        &VfxValue::String {
            value: TEXTURE.to_owned()
        }
    );
}

#[test]
fn an_integer_leaf_answers_a_number() {
    let system = resolved();

    assert_eq!(
        field(only_emitter(&system), "blendMode"),
        &VfxValue::Number { value: 4.0 }
    );
}

#[test]
fn a_colour_leaf_answers_four_fractions() {
    let system = resolved();

    let VfxValue::Vector { values } = field(only_emitter(&system), "Color") else {
        panic!("a colour is no vector");
    };
    assert_eq!(
        values,
        &vec![255.0 / 255.0, 128.0 / 255.0, 0.0 / 255.0, 51.0 / 255.0]
    );
}

#[test]
fn a_null_pointer_answers_null_and_an_absent_optional_answers_none() {
    let system = resolved();
    let emitter = only_emitter(&system);

    assert_eq!(field(emitter, "primitive"), &VfxValue::Null);
    assert_eq!(field(emitter, "rate"), &VfxValue::None);
}

#[test]
fn a_present_optional_answers_what_it_holds() {
    let system = resolved();

    assert_eq!(
        field(only_emitter(&system), "lifetime"),
        &VfxValue::Number { value: 2.5 }
    );
}

#[test]
fn a_map_keys_a_named_hash_by_its_name_and_an_unnamed_one_by_its_hex() {
    let system = resolved();

    let VfxValue::Map { entries } = field(only_emitter(&system), "lookup") else {
        panic!("the lookup is no map");
    };
    let keys: Vec<&str> = entries.iter().map(|entry| entry.key.as_str()).collect();
    assert_eq!(keys, ["weapon", "0xdeadbeef"]);
}

#[test]
fn an_entry_the_document_does_not_hold_is_an_error() {
    let error = resolve_system(&document(), h("Vfx/Nowhere"), &named(), &()).unwrap_err();

    assert!(
        matches!(error, BinDocumentError::NodeNotFound { .. }),
        "unexpected error: {error:?}"
    );
}

#[test]
fn a_tree_past_the_value_cap_is_refused_rather_than_truncated() {
    let wide = BinObject::builder(h(SYSTEM), h("VfxSystemDefinitionData"))
        .property(
            h("wide"),
            values::Container::from(vec![values::F32::new(0.5); MAX_NODES]),
        )
        .build();

    let error = resolve_system(&document_of(vec![wide]), h(SYSTEM), &named(), &()).unwrap_err();

    assert!(
        matches!(error, BinDocumentError::ReadTooLarge),
        "unexpected error: {error:?}"
    );
}

#[test]
fn a_tree_past_the_depth_cap_is_refused() {
    let mut nest: PropertyValueEnum = values::I32::new(0).into();
    for _ in 0..=MAX_DEPTH {
        nest = embedded("Nest", vec![(h("inner"), nest)]).into();
    }
    let deep = BinObject::builder(h(SYSTEM), h("VfxSystemDefinitionData"))
        .property(h("deep"), nest)
        .build();

    let error = resolve_system(&document_of(vec![deep]), h(SYSTEM), &named(), &()).unwrap_err();

    assert!(
        matches!(error, BinDocumentError::ReadTooDeep),
        "unexpected error: {error:?}"
    );
}

/// The table is written as hashes, so nothing but this holds it to the names it claims.
#[test]
fn every_asset_field_is_the_hash_of_the_name_it_claims() {
    let names = [
        "texture",
        "falloffTexture",
        "particleColorTexture",
        "emissionMeshName",
        "mMeshName",
        "mMeshSkeletonName",
        "mSimpleMeshName",
        "textureMult",
        "paletteTexture",
        "erosionMapName",
        "normalMapTexture",
        "reflectionMapTexture",
    ];

    assert_eq!(ASSET_FIELDS.to_vec(), names.map(h).to_vec());
}

#[test]
fn every_resolver_hash_is_the_hash_of_the_name_it_claims() {
    assert_eq!(
        [
            CHILD_IDENTIFIER,
            EFFECT_KEY,
            RESOURCE_RESOLVER,
            RESOURCE_MAP
        ],
        [
            "VfxChildIdentifier",
            "effectKey",
            "ResourceResolver",
            "resourceMap"
        ]
        .map(h)
    );
}

const KEYED: &str = "Vfx/Keyed/System";

/// A resolver at `path` mapping each key to the object named beside it, a skin's own scope.
fn resolver(path: &str, entries: &[(&str, BinHash)]) -> BinObject {
    let map = values::Map::new(
        Kind::Hash,
        Kind::ObjectLink,
        entries
            .iter()
            .map(|(key, target)| {
                (
                    values::Hash::new(h(key)).into(),
                    values::ObjectLink::new(*target).into(),
                )
            })
            .collect(),
    )
    .unwrap();

    BinObject::builder(h(path), h("ResourceResolver"))
        .property(h("resourceMap"), map)
        .build()
}

/// A system whose one child identifier names its system by `key`.
fn keyed(key: &str) -> BinObject {
    keyed_on("VfxChildIdentifier", key)
}

/// A system holding one struct of `class` that writes `effectKey` as `key`.
fn keyed_on(class: &str, key: &str) -> BinObject {
    let holder = embedded(
        class,
        vec![(h("effectKey"), values::Hash::new(h(key)).into())],
    );
    BinObject::builder(h(KEYED), h("VfxSystemDefinitionData"))
        .property(h("child"), holder)
        .build()
}

#[test]
fn an_effect_key_outside_a_child_identifier_stays_a_hash() {
    let objects = vec![
        keyed_on("VfxOtherData", "Spark_Key"),
        child(),
        resolver("Vfx/Scope", &[("Spark_Key", h(CHILD))]),
    ];
    let system = resolve_system(&document_of(objects), h(KEYED), &named(), &()).unwrap();
    let key = field(field(&system.root, "child"), "effectKey");

    assert!(matches!(key, VfxValue::Hash { .. }), "{key:?}");
}

/// The keyed system's identifier as resolved, beside `resolvers` in document order.
fn keyed_child(resolvers: Vec<BinObject>) -> VfxValue {
    let mut objects = vec![keyed("Spark_Key"), child()];
    objects.extend(resolvers);
    let system = resolve_system(&document_of(objects), h(KEYED), &named(), &()).unwrap();
    field(field(&system.root, "child"), "effectKey").clone()
}

#[test]
fn an_effect_key_the_documents_resolver_maps_inlines_the_system_it_names() {
    let child = keyed_child(vec![resolver("Vfx/Scope", &[("Spark_Key", h(CHILD))])]);

    let VfxValue::Struct { class, .. } = &child else {
        panic!("the key did not inline: {child:?}");
    };
    assert_eq!(class.as_deref(), Some("VfxChildData"));
}

#[test]
fn an_effect_key_no_resolver_maps_to_an_object_of_the_document_stays_a_hash() {
    let unheld = keyed_child(vec![resolver("Vfx/Scope", &[("Other_Key", h(CHILD))])]);
    let elsewhere = keyed_child(vec![resolver(
        "Vfx/Scope",
        &[("Spark_Key", h("Vfx/Nowhere"))],
    )]);

    assert!(matches!(unheld, VfxValue::Hash { .. }), "{unheld:?}");
    assert!(matches!(elsewhere, VfxValue::Hash { .. }), "{elsewhere:?}");
}

/// A key mapped to a null link is a hit that suppresses the effect, so a later resolver
/// never gets to answer it.
#[test]
fn a_key_the_first_resolver_maps_to_nothing_stays_a_hash() {
    let suppressed = keyed_child(vec![
        resolver("Vfx/First", &[("Spark_Key", BinHash(0))]),
        resolver("Vfx/Second", &[("Spark_Key", h(CHILD))]),
    ]);

    assert!(
        matches!(suppressed, VfxValue::Hash { .. }),
        "{suppressed:?}"
    );
}
