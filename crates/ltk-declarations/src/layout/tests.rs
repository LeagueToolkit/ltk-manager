use super::*;

const SKIN0: &str = "Characters/Teemo/Skins/Skin0";

const MANIFEST: &str = "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        skinMeshProperties.selfIllumination: 0.37 # glow
        skinMeshProperties:
          initialSubmeshToHide: Tail
        iconAvatar: !ref \"Characters/Teemo/Skins/Skin1:iconAvatar\"
  - target: data/characters/teemo/skins/skin0.bin
    Characters/Teemo/Skins/Skin0:
      -resourceMap: [Teemo_R]
    objects:
      Mods/Jade/Glow:
        class: VfxSystemDefinitionData
        set:
          particleName: Glow
  - target: data/characters/teemo/teemo.bin
    edits:
      - Characters/Teemo/CharacterRecords/Root:
          baseHP: 700
";

fn skin0() -> EntryName {
    EntryName::try_from(SKIN0).unwrap()
}

fn line_of(layout: &Layout, at: usize) -> &str {
    let text = layout.text();
    let start = text[..at].rfind('\n').map_or(0, |newline| newline + 1);
    let end = text[at..]
        .find('\n')
        .map_or(text.len(), |newline| at + newline);
    &text[start..end]
}

#[test]
fn a_dotted_key_is_found_with_its_value_and_line() {
    let layout = Layout::parse(MANIFEST).unwrap();

    let key = layout
        .key(
            BodyAt::Entries { module: 0 },
            Binding::Entry,
            &skin0(),
            "skinMeshProperties.selfIllumination",
        )
        .unwrap();

    assert_eq!(key.value, "0.37");
    assert_eq!(
        line_of(&layout, key.span.start).trim(),
        "skinMeshProperties.selfIllumination: 0.37 # glow"
    );
}

#[test]
fn a_block_key_spans_its_block_and_reads_as_the_block_text() {
    let layout = Layout::parse(MANIFEST).unwrap();

    let key = layout
        .key(
            BodyAt::Entries { module: 0 },
            Binding::Entry,
            &skin0(),
            "skinMeshProperties",
        )
        .unwrap();

    assert_eq!(key.value, "initialSubmeshToHide: Tail");
    assert!(layout.text()[key.span.clone()].ends_with("initialSubmeshToHide: Tail\n"));
}

#[test]
fn a_tagged_value_keeps_its_tag() {
    let layout = Layout::parse(MANIFEST).unwrap();

    let key = layout
        .key(
            BodyAt::Entries { module: 0 },
            Binding::Entry,
            &skin0(),
            "iconAvatar",
        )
        .unwrap();

    assert_eq!(
        key.value,
        "!ref \"Characters/Teemo/Skins/Skin1:iconAvatar\""
    );
}

#[test]
fn a_target_body_finds_entries_objects_and_listed_edits() {
    let layout = Layout::parse(MANIFEST).unwrap();
    let compact = BodyAt::Target { module: 1, edit: 0 };
    let glow = EntryName::try_from("Mods/Jade/Glow").unwrap();
    let root = EntryName::try_from("Characters/Teemo/CharacterRecords/Root").unwrap();

    let removal = layout
        .key(compact, Binding::Entry, &skin0(), "-resourceMap")
        .unwrap();
    let particle = layout
        .key(compact, Binding::Object, &glow, "particleName")
        .unwrap();
    let hp = layout
        .key(
            BodyAt::Target { module: 2, edit: 0 },
            Binding::Entry,
            &root,
            "baseHP",
        )
        .unwrap();

    assert_eq!(removal.value, "[Teemo_R]");
    assert_eq!(particle.value, "Glow");
    assert_eq!(hp.value, "700");
    assert!(layout.entry(compact, Binding::Entry, &glow).is_none());
}

#[test]
fn a_key_spelled_in_another_case_is_found_by_its_hashes() {
    let layout = Layout::parse(MANIFEST).unwrap();

    let key = layout.key(
        BodyAt::Entries { module: 0 },
        Binding::Entry,
        &skin0(),
        "SkinMeshProperties.SelfIllumination",
    );

    assert_eq!(key.map(|key| key.value).as_deref(), Some("0.37"));
}

#[test]
fn a_module_and_an_entry_span_their_first_line() {
    let layout = Layout::parse(MANIFEST.replace('\n', "\r\n").as_str()).unwrap();

    let module = layout.module(1).unwrap();
    let entry = layout
        .entry(BodyAt::Entries { module: 0 }, Binding::Entry, &skin0())
        .unwrap();

    assert_eq!(
        &layout.text()[module],
        "target: data/characters/teemo/skins/skin0.bin"
    );
    assert_eq!(&layout.text()[entry], "Characters/Teemo/Skins/Skin0:");
}
