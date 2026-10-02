//! Unit tests for which paths name a character or one of its spells.

use super::*;

#[test]
fn a_spell_name_matches_whole_segments_in_any_case() {
    assert_eq!(
        spell_name("Characters/Sejuani/Spells/SejuaniEAbility", "SEJUANI"),
        Some("SejuaniEAbility")
    );
    assert_eq!(
        spell_name("characters/sejuani/spells/Deep/Folder/Child", "Sejuani"),
        Some("Deep/Folder/Child")
    );

    assert_eq!(
        spell_name("Characters/Sejuani/SpellsExtra/Wrong", "Sejuani"),
        None
    );
    assert_eq!(
        spell_name("Characters/SejuaniExtra/Spells/Wrong", "Sejuani"),
        None
    );
    assert_eq!(spell_name("Characters/Other/Spells/Wrong", "Sejuani"), None);
    assert_eq!(spell_name("Characters/Sejuani/Spells/", "Sejuani"), None);
    assert_eq!(spell_name("Characters/Sejuani/Spells", "Sejuani"), None);
}

#[test]
fn a_character_with_a_slash_or_no_name_matches_no_spell() {
    let path = "Characters/Sejuani/Spells/SejuaniE";

    assert_eq!(spell_name(path, "Sejuani/Spells"), None);
    assert_eq!(spell_name(path, ""), None);
}
