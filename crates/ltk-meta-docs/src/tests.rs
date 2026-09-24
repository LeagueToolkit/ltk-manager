use super::*;

/// The shape `/v1/docs/all` serves, trimmed to a mesh primitive, its base and one unnamed class.
const PAYLOAD: &str = r#"{
  "VfxPrimitiveMeshBase": {
    "name": "VfxPrimitiveMeshBase",
    "class": { "description": "Draws a mesh at every particle.\n" },
    "properties": {
      "mMesh": { "description": "The mesh settings." },
      "0x6aec9e7a": { "description": "Replaces the rotation.", "notes": ["Unnamed."] }
    }
  },
  "VfxPrimitiveMesh": {
    "name": "VfxPrimitiveMesh",
    "class": { "description": "Draws the mesh named in `mMesh`.", "notes": ["Reads no attachment."] },
    "properties": {}
  },
  "0x056bb851": {
    "name": "0x056bb851",
    "class": null,
    "properties": {
      "mMesh": { "description": "Shadowed by nothing." },
      "Empty": { "notes": [], "examples": [] }
    }
  }
}"#;

fn docs() -> MetaDocs {
    MetaDocs::parse(PAYLOAD.as_bytes()).expect("the fixture is the published shape")
}

fn hash(name: &str) -> BinHash {
    BinHash::from(name)
}

#[test]
fn a_class_reads_its_own_prose_and_the_property_prose_of_its_bases() {
    let docs = docs()
        .class_docs(&[hash("VfxPrimitiveMesh"), hash("VfxPrimitiveMeshBase")])
        .expect("the class is documented");

    assert_eq!(
        docs.class.and_then(|doc| doc.description).as_deref(),
        Some("Draws the mesh named in `mMesh`.")
    );
    let mesh = &docs.properties[&hex(hash("mMesh"))];
    assert_eq!(mesh.owner, "VfxPrimitiveMeshBase");
    assert_eq!(mesh.name, "mMesh");
}

#[test]
fn a_class_is_found_by_its_hash_whatever_the_case_of_its_name() {
    let docs = docs();

    assert!(docs.class_docs(&[hash("vfxprimitivemesh")]).is_some());
}

#[test]
fn an_unnamed_key_is_read_as_the_hash_it_spells() {
    let docs = docs()
        .class_docs(&[hash("VfxPrimitiveMeshBase")])
        .expect("the class is documented");

    let unnamed = &docs.properties["0x6aec9e7a"];
    assert_eq!(unnamed.name, "0x6aec9e7a");
    assert_eq!(unnamed.doc.notes, ["Unnamed."]);
}

#[test]
fn the_nearer_class_answers_for_a_property_two_of_them_document() {
    let docs = docs()
        .class_docs(&[BinHash(0x056b_b851), hash("VfxPrimitiveMeshBase")])
        .expect("the class is documented");

    assert_eq!(docs.properties[&hex(hash("mMesh"))].owner, "0x056bb851");
}

#[test]
fn an_entry_that_says_nothing_is_dropped() {
    let docs = docs()
        .class_docs(&[BinHash(0x056b_b851)])
        .expect("the class is documented");

    assert!(docs.class.is_none());
    assert!(!docs.properties.contains_key(&hex(hash("Empty"))));
}

#[test]
fn a_lineage_with_nothing_documented_answers_none() {
    let docs = docs();

    assert!(
        docs.class_docs(&[hash("VfxEmitterDefinitionData")])
            .is_none()
    );
    assert!(docs.class_docs(&[]).is_none());
}

#[test]
fn an_example_that_is_not_text_is_skipped() {
    let json =
        r#"{ "A": { "class": { "examples": ["kept", { "code": "x" }, 3] }, "properties": {} } }"#;

    let docs = MetaDocs::parse(json.as_bytes()).expect("the payload parses");

    let class = docs.class_docs(&[hash("A")]).and_then(|docs| docs.class);
    assert_eq!(class.map(|doc| doc.examples), Some(vec!["kept".to_owned()]));
}

#[test]
fn a_body_that_is_not_the_payload_is_refused() {
    assert!(MetaDocs::parse(b"[1, 2, 3]").is_err());
}
