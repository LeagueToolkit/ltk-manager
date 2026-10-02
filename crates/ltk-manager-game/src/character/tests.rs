//! Unit tests for which paths name a character.

use super::*;

#[test]
fn characters_are_the_named_records_in_any_case() {
    let paths = [
        "Characters/Ahri/CharacterRecords/Root",
        "characters/TFT15_Ahri/characterrecords/root",
        "Characters/Annie2/CharacterRecords/Root",
        "Characters/Annie10/CharacterRecords/Root",
        "characters/ahri/characterrecords/root",
        "Characters/Sejuani/Spells/SejuaniE",
        "Characters/Sejuani/CharacterRecords/Root/Deeper",
    ];

    assert_eq!(
        characters_named(paths.into_iter()),
        ["Ahri", "Annie2", "Annie10", "TFT15_Ahri"]
    );
}
