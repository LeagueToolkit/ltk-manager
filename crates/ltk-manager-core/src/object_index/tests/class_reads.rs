use super::*;

#[test]
fn an_object_is_declared_as_each_class_any_file_declares_it_as() {
    let path = "Characters/Sejuani/Spells/E/Missile";
    let first: &[Chunk<'_>] = &[("data/first.bin", prop(&[(path, "ResourceResolver")]))];
    let second: &[Chunk<'_>] = &[("data/second.bin", prop(&[(path, "SpellObject")]))];
    let (_tmp, index) = build(&[("A.wad.client", first), ("B.wad.client", second)], 1);
    let object = BinHash::hash_str(path);

    assert!(index.declares_class(object, BinHash::hash_str("SpellObject")));
    assert!(index.declares_class(object, BinHash::hash_str("ResourceResolver")));
    assert!(!index.declares_class(object, BinHash::hash_str("CharacterRecord")));
    assert!(!index.declares_class(
        BinHash::hash_str("Elsewhere"),
        BinHash::hash_str("SpellObject")
    ));
}

#[test]
fn the_named_objects_are_every_path_a_table_names_in_path_order() {
    let (_tmp, index) = named_index(&[
        ("Characters/Sejuani/Spells/SejuaniE", "SpellObject"),
        ("Characters/Ahri/CharacterRecords/Root", "CharacterRecord"),
    ]);

    assert_eq!(
        index.named_objects().collect::<Vec<_>>(),
        [
            (
                BinHash::hash_str("Characters/Ahri/CharacterRecords/Root"),
                "Characters/Ahri/CharacterRecords/Root"
            ),
            (
                BinHash::hash_str("Characters/Sejuani/Spells/SejuaniE"),
                "Characters/Sejuani/Spells/SejuaniE"
            ),
        ]
    );
}

#[test]
fn an_object_no_table_names_is_unnamed() {
    let chunks: &[Chunk<'_>] = &[(
        "data/spells.bin",
        prop(&[
            ("Characters/Sejuani/Spells/E", "SpellObject"),
            ("Characters/Other/Spells/Q", "SpellObject"),
        ]),
    )];
    let (_tmp, index) = build(&[("A.wad.client", chunks)], 1);
    let index = index.named(&TestNames::over(&["Characters/Sejuani/Spells/E"], &[]));

    assert_eq!(
        index.unnamed_objects().collect::<Vec<_>>(),
        [BinHash::hash_str("Characters/Other/Spells/Q")]
    );
    assert_eq!(index.named_objects().count(), 1);
}
