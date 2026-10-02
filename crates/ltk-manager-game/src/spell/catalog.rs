//! A character's spells, found by the paths the hash tables name objects under.

use ltk_hash::{BinHash, Hash as _};
use serde::Serialize;

use ltk_manager_core::bin_document::hex;
use ltk_manager_core::object_index::{ObjectDeclaration, ObjectIndex};
use ltk_manager_core::utils::natural_order::compare_names;

/// One named spell and every file declaring its object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CharacterSpell {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The resolved object path.
    pub path: String,
    /// The path below `Characters/{character}/Spells`.
    pub name: String,
    /// The first nested segment, which suggests a group without implying cast order.
    pub group: Option<String>,
    /// Every declaration, including conflicting classes, in archive order.
    pub declarations: Vec<ObjectDeclaration>,
}

/// The install's named spells for one character, without a search result cap.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SpellCatalog {
    /// Spells in natural path order.
    pub spells: Vec<CharacterSpell>,
    /// Unnamed spell objects across the install, whose character cannot be established.
    pub unnamed: u32,
}

/// Every named spell in `index` below the spell path of `character`, with all its declarations.
///
/// Path segments match without regard to ASCII case. Unnamed spell objects are counted
/// separately because their hashes do not establish a character.
#[must_use]
pub fn character_spells(index: &ObjectIndex, character: &str) -> SpellCatalog {
    let spell_class = BinHash::hash_str("SpellObject");
    let is_spell = |object| index.declares_class(object, spell_class);

    let mut spells: Vec<CharacterSpell> = index
        .named_objects()
        .filter_map(|(object, path)| {
            let name = spell_name(path, character)?;
            is_spell(object).then(|| CharacterSpell {
                object_hash: hex(object),
                path: path.to_owned(),
                name: name.to_owned(),
                group: name.split_once('/').map(|(group, _)| group.to_owned()),
                declarations: index
                    .declared(object)
                    .map(|declared| declared.declarations)
                    .unwrap_or_default(),
            })
        })
        .collect();
    spells.sort_by(|a, b| compare_names(&a.name, &b.name));

    SpellCatalog {
        spells,
        unnamed: index
            .unnamed_objects()
            .filter(|hash| is_spell(*hash))
            .count() as u32,
    }
}

/// The part of `path` below `Characters/{character}/Spells`, where it lies there.
///
/// Matched by segment rather than through the case-sensitive path index, since the tables
/// name spell paths in mixed casing.
fn spell_name<'a>(path: &'a str, character: &str) -> Option<&'a str> {
    let mut segments = path.splitn(4, '/');
    let (Some(root), Some(owner), Some(folder), Some(name)) = (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) else {
        return None;
    };

    let under = root.eq_ignore_ascii_case("Characters")
        && owner.eq_ignore_ascii_case(character)
        && folder.eq_ignore_ascii_case("Spells")
        && !name.is_empty();
    under.then_some(name)
}

#[cfg(test)]
mod tests;
