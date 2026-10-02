//! The `@` scope's search over one document: by name, by value, within one object, capped.

use super::*;

const SKIN: &str = "Characters/Aatrox/Skins/Skin0/Resources";

fn found(entry: Option<&str>, query: &str) -> BinFindResult {
    document().find(entry.map(h), query, &named(), None)
}

fn paths(result: &BinFindResult) -> Vec<&str> {
    result.hits.iter().map(|hit| hit.path.as_str()).collect()
}

#[test]
fn a_name_matches_case_aside_and_marks_where() {
    let result = found(Some(SKIN), "ARMOR");

    assert_eq!(paths(&result), [hashed("armorMaterial")]);
    let hit = &result.hits[0];
    assert_eq!(hit.label, "armorMaterial");
    assert_eq!(hit.name, "armorMaterial");
    assert_eq!(hit.ranges, [(0, 5)]);
    assert_eq!(hit.entry, hex(h(SKIN)));
    assert_eq!(hit.object, SKIN);
}

#[test]
fn a_value_matches_by_the_text_its_row_draws() {
    let result = found(Some(SKIN), "sword");

    assert_eq!(
        paths(&result),
        [format!("{}{{{:08x}}}", hashed("lookup"), h("weapon"))]
    );
    let hit = &result.hits[0];
    assert_eq!(hit.label, "lookup{\"weapon\"}");
    assert!(hit.ranges.is_empty(), "the value matched, not the name");
    assert_eq!(hit.value.as_deref(), Some("sword"));
}

#[test]
fn a_hash_matches_by_its_name_and_by_its_hex() {
    let by_name = found(Some(SKIN), "aatrox_mat");
    let by_hex = found(Some(SKIN), &format!("{:08x}", h("Aatrox_Mat")));

    let material = format!("{}.{}", hashed("skinMeshProperties"), hashed("material"));
    assert_eq!(paths(&by_name), [material.as_str()]);
    assert_eq!(paths(&by_hex), [material.as_str()]);
    assert_eq!(by_hex.hits[0].value.as_deref(), Some("Aatrox_Mat"));
}

#[test]
fn a_leaf_under_an_option_is_found_on_the_option_row() {
    let result = found(Some(SKIN), "1.5");
    assert_eq!(paths(&result), [hashed("maybe")]);
}

#[test]
fn a_file_search_holds_the_object_rows_and_an_object_search_does_not() {
    let file = found(None, "characters/aatrox");
    let object = found(Some(SKIN), "characters/aatrox");

    assert_eq!(
        file.hits
            .iter()
            .filter(|hit| hit.path.is_empty())
            .map(|hit| hit.name.as_str())
            .collect::<Vec<_>>(),
        [SKIN, "Characters/Aatrox"],
        "each object row, named by its path"
    );
    assert!(object.hits.iter().all(|hit| !hit.path.is_empty()));
    assert_eq!(
        paths(&object),
        [hashed("link")],
        "the link names the object, and the object rows are the tab's header"
    );
}

#[test]
fn every_hit_is_a_row_the_document_draws() {
    let document = document();
    let entry = h(SKIN);
    let mut rows = Vec::new();
    let mut open = vec![String::new()];
    while let Some(path) = open.pop() {
        for row in document
            .children(entry, &path, 0, usize::MAX, &named(), None)
            .unwrap()
            .rows
        {
            rows.push(row.path.clone());
            open.push(row.path);
        }
    }

    for query in ["name", "p0", "part", "aatrox", "1"] {
        for hit in document.find(Some(entry), query, &named(), None).hits {
            assert!(
                rows.contains(&hit.path),
                "no row at {} for {query}",
                hit.path
            );
        }
    }
}

#[test]
fn a_search_caps_its_rows_and_counts_on_past_the_cap() {
    let object = BinObject::builder(h("Wide"), h("WideClass"))
        .property(
            h("items"),
            values::Container::from(vec![values::String::from("needle"); FIND_ROWS + 5]),
        )
        .build();
    let bin = Bin::builder().object(object).build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    let document = BinDocument::parse(out.into_inner()).unwrap();

    let result = document.find(Some(h("Wide")), "needle", &(), None);
    assert_eq!(result.hits.len(), FIND_ROWS);
    assert_eq!(result.total as usize, FIND_ROWS + 5);
    assert_eq!(result.hits[0].path, format!("{}[0]", hashed("items")));
}

#[test]
fn a_blank_query_matches_nothing() {
    assert_eq!(found(None, "  "), BinFindResult::default());
}
