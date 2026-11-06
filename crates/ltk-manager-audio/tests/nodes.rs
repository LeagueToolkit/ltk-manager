//! Edits that add, copy, wrap and delete objects, and the import of a WEM, through the document.

mod common;

use std::collections::HashSet;

use common::{FakeFiles, FakeNames, fixture};
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_audio::{
    AudioFile, AudioIndex, BankEdit, BankEditError, BankSet, BankUnit, BinAudio, ContainerKind,
    EditContext, EventBank, EventBankDocument, EventNode, MediaContainer, NewNode, NodeParent,
    ObjectId, OpenedBank, OpenedFile, SourceId, sound,
};
use ltk_wwise::hierarchy::{ContainerFields, ContainerMode, Object, ObjectKind, StreamType, Typed};
use ltk_wwise::{Bank, Package};

const EVENTS: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_events.bnk";
const MEDIA: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.bnk";
const PACKAGE: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.wpk";

/// The event of [`PLAY`], which plays [`RANDOM`].
const EVENT: u32 = 339_038_649;
const PLAY: u32 = 538_040_822;
/// A random container of seven sounds under [`MIXER`].
const RANDOM: u32 = 414_059_032;
/// A sound of [`RANDOM`].
const SOUND: u32 = 103_146_397;
/// The actor-mixer that holds every random container of the fixture.
const MIXER: u32 = 77_798_476;
/// The event of three Play actions, whose second plays [`RANDOM_THREE`].
const THREE_EVENT: u32 = 3_890_987_893;
/// A random container of three sounds.
const RANDOM_THREE: u32 = 621_322_984;
/// The source ID of the one `DATA_BANK` sound of the fixture, which `media_v145.bnk` holds.
const BANKED_SOURCE: u32 = 879_168_912;
/// The bank ID in the header of `events_v145.bnk`.
const BANK_ID: u32 = 2_282_428_251;

fn document() -> EventBankDocument {
    EventBankDocument::parse(fixture("events_v145.bnk")).expect("parse the event fixture")
}

/// The files of a set: the media bank, and the package if `package`.
fn files(package: bool) -> FakeFiles {
    let files = FakeFiles::default().with_fixture(MEDIA, "media_v145.bnk");
    if package {
        files.with_fixture(PACKAGE, "package.wpk")
    } else {
        files
    }
}

/// Returns the bank set of `document`: its bytes, its media files, and the files of `rest`.
fn set_of(document: &EventBankDocument, rest: &[&str]) -> BankSet {
    let mut files = files(rest.contains(&PACKAGE)).with(EVENTS, document.bytes().to_vec());
    for file in document.media() {
        files = files.with(file.path(), file.bytes().to_vec());
    }

    let mut bank_path = vec![EVENTS.to_owned()];
    bank_path.extend(rest.iter().map(|path| (*path).to_owned()));
    let unit = BankUnit {
        bank_path,
        ..BankUnit::default()
    };
    BankSet::open(&[unit], &files, None)
}

fn edit(document: &mut EventBankDocument, change: BankEdit) {
    try_edit(document, change).expect("apply the edit");
}

fn try_edit(document: &mut EventBankDocument, change: BankEdit) -> Result<(), BankEditError> {
    let set = set_of(document, &[MEDIA]);
    document.edit(&change, &EditContext::new(&set))
}

fn bank_of(bytes: &[u8]) -> Bank {
    Bank::from_reader(&mut &bytes[..]).expect("read the written bank")
}

fn typed(bank: &Bank, id: u32) -> Typed {
    bank.hierarchy()
        .and_then(|hierarchy| hierarchy.get(ObjectId(id)))
        .unwrap_or_else(|| panic!("no object {id}"))
        .decode(bank.header().version)
        .expect("decode")
        .expect("typed")
}

fn has(bank: &Bank, id: u32) -> bool {
    bank.hierarchy()
        .is_some_and(|hierarchy| hierarchy.get(ObjectId(id)).is_some())
}

fn ids(bank: &Bank) -> HashSet<u32> {
    bank.hierarchy()
        .expect("hierarchy")
        .objects()
        .iter()
        .map(|object| object.id().0)
        .collect()
}

/// Returns the IDs of the objects of `after` that `before` does not hold.
fn added(before: &Bank, after: &Bank) -> Vec<u32> {
    let before = ids(before);
    after
        .hierarchy()
        .expect("hierarchy")
        .objects()
        .iter()
        .map(|object| object.id().0)
        .filter(|id| !before.contains(id))
        .collect()
}

/// Fails unless `written` reads back, passes `Bank::check`, decodes every object, keeps the
/// bytes of every object of `original` but `touched`, and links every child both ways.
fn assert_round_trip(original: &Bank, written: &[u8], touched: &[u32]) {
    let bank = bank_of(written);
    bank.check().expect("the client accepts the bank");
    let version = bank.header().version;
    let hierarchy = bank.hierarchy().expect("hierarchy");

    for object in original.hierarchy().expect("hierarchy").objects() {
        if touched.contains(&object.id().0) {
            continue;
        }
        let kept = hierarchy.get(object.id());
        assert!(
            kept.is_none() || kept == Some(object),
            "object {} changed",
            object.id()
        );
    }

    for object in hierarchy.objects() {
        let Some(Typed::Container(container)) = object.decode(version).expect("decode") else {
            continue;
        };
        for child in &container.children {
            let Some(listed) = hierarchy.get(*child) else {
                continue;
            };
            assert_eq!(
                parent_field(listed, version),
                Some(container.id.0),
                "child {child} of {} names another parent",
                container.id
            );
        }
    }
}

fn parent_field(object: &Object, version: ltk_wwise::bank::BankVersion) -> Option<u32> {
    match object.decode(version).ok()?? {
        Typed::Sound(sound) => Some(sound.node.parent.0),
        Typed::Container(container) => Some(container.node.parent.0),
        _ => None,
    }
}

fn children(bank: &Bank, id: u32) -> Vec<u32> {
    let Typed::Container(container) = typed(bank, id) else {
        panic!("{id} is not a container");
    };
    container.children.iter().map(|child| child.0).collect()
}

fn actions(bank: &Bank, id: u32) -> Vec<u32> {
    let Typed::Event(event) = typed(bank, id) else {
        panic!("{id} is not an event");
    };
    event.actions.iter().map(|action| action.0).collect()
}

fn target(bank: &Bank, id: u32) -> u32 {
    let Typed::Action(action) = typed(bank, id) else {
        panic!("{id} is not an action");
    };
    action.target.0
}

fn parent(bank: &Bank, id: u32) -> u32 {
    parent_field(
        bank.hierarchy()
            .and_then(|h| h.get(ObjectId(id)))
            .expect("object"),
        bank.header().version,
    )
    .expect("a node")
}

#[test]
fn new_event_takes_hash_of_name_and_keeps_other_objects() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::NewEvent {
            name: "Play_sfx_Mod_Cast".to_owned(),
        },
    );

    let id = ObjectId::from_name("Play_sfx_Mod_Cast").0;
    let written = bank_of(document.bytes());
    assert_eq!(added(&original, &written), [id]);
    assert!(actions(&written, id).is_empty());
    assert_eq!(document.created_names(), ["Play_sfx_Mod_Cast"]);
    assert_round_trip(&original, document.bytes(), &[]);
}

#[test]
fn new_event_refuses_name_of_existing_event() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::NewEvent {
            name: "Play_sfx_Mod_Cast".to_owned(),
        },
    );

    let again = try_edit(
        &mut document,
        BankEdit::NewEvent {
            name: "play_sfx_mod_cast".to_owned(),
        },
    );

    assert!(matches!(again, Err(BankEditError::EventExists(_))));
    assert_eq!(document.revision(), 1);
}

#[test]
fn new_event_refuses_name_that_index_names() {
    let mut document = document();
    let mut builder = AudioIndex::builder();
    builder.add_bin(
        "data/characters/ahri/skins/skin0.bin",
        BinAudio {
            event_names: vec!["Play_vo_Ahri_Attack".to_owned()],
            ..BinAudio::default()
        },
    );
    let index = builder.build();
    let indexes = [&index];
    let set = set_of(&document, &[MEDIA]);

    let refused = document.edit(
        &BankEdit::NewEvent {
            name: "Play_vo_Ahri_Attack".to_owned(),
        },
        &EditContext::new(&set).with_indexes(&indexes),
    );

    assert!(matches!(refused, Err(BankEditError::EventExists(_))));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
}

#[test]
fn new_object_id_skips_id_that_index_names() {
    let mut document = document();
    let mut builder = AudioIndex::builder();
    builder.add_bin(
        "data/taken.bin",
        BinAudio {
            event_names: vec![format!("ltk-manager/{BANK_ID}/0")],
            ..BinAudio::default()
        },
    );
    let index = builder.build();
    let indexes = [&index];
    let set = set_of(&document, &[MEDIA]);

    document
        .edit(
            &BankEdit::AddNode {
                parent: NodeParent::Container { container: RANDOM },
                node: NewNode::Container {
                    container: ContainerKind::Random,
                },
            },
            &EditContext::new(&set).with_indexes(&indexes),
        )
        .expect("add a container");

    let written = bank_of(document.bytes());
    let taken = ObjectId::from_name(&format!("ltk-manager/{BANK_ID}/0")).0;
    let next = ObjectId::from_name(&format!("ltk-manager/{BANK_ID}/1")).0;
    assert!(!has(&written, taken));
    assert!(children(&written, RANDOM).contains(&next));
}

#[test]
fn add_node_under_event_plays_new_container_in_mixer() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::AddNode {
            parent: NodeParent::Event { event: EVENT },
            node: NewNode::Container {
                container: ContainerKind::Sequence,
            },
        },
    );

    let written = bank_of(document.bytes());
    let new = added(&original, &written);
    assert_eq!(new.len(), 2);
    let play = *actions(&written, EVENT).last().expect("an action");
    let container = target(&written, play);
    assert!(new.contains(&play) && new.contains(&container));
    assert_eq!(parent(&written, container), MIXER);
    assert!(children(&written, MIXER).contains(&container));
    let Typed::Container(sequence) = typed(&written, container) else {
        panic!("not a container");
    };
    let ContainerFields::RandomSequence(fields) = sequence.fields else {
        panic!("not a random or sequence container");
    };
    assert_eq!(fields.mode, ContainerMode::SEQUENCE);
    assert!(sequence.node.props.iter().next().is_none());
    assert_round_trip(&original, document.bytes(), &[EVENT, MIXER]);
}

#[test]
fn add_node_sound_plays_media_of_set_under_container() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::AddNode {
            parent: NodeParent::Container { container: RANDOM },
            node: NewNode::Sound {
                source: BANKED_SOURCE,
            },
        },
    );

    let written = bank_of(document.bytes());
    let [new] = added(&original, &written)[..] else {
        panic!("not one new object");
    };
    let Typed::Sound(sound) = typed(&written, new) else {
        panic!("not a sound");
    };
    assert_eq!(sound.source.source_id, SourceId(BANKED_SOURCE));
    assert_eq!(sound.source.stream_type, StreamType::DATA_BANK);
    assert_eq!(sound.node.parent, ObjectId(RANDOM));
    assert!(children(&written, RANDOM).contains(&new));
    assert_round_trip(&original, document.bytes(), &[RANDOM]);
}

#[test]
fn duplicate_copies_subtree_with_fresh_ids_beside_original_play() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Duplicate {
            object: RANDOM,
            parent: PLAY,
        },
    );

    let written = bank_of(document.bytes());
    let new = added(&original, &written);
    assert_eq!(new.len(), 1 + 7 + 1);
    let [first, copy_play] = actions(&written, EVENT)[..] else {
        panic!("not two actions");
    };
    assert_eq!(first, PLAY);
    let copy = target(&written, copy_play);
    assert_ne!(copy, RANDOM);
    assert_eq!(parent(&written, copy), MIXER);
    assert!(children(&written, MIXER).contains(&copy));
    let copied = children(&written, copy);
    assert_eq!(copied.len(), 7);
    assert!(copied.iter().all(|child| new.contains(child)));
    assert_round_trip(&original, document.bytes(), &[EVENT, MIXER]);
}

#[test]
fn delete_keeps_object_that_another_play_references() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();
    edit(
        &mut document,
        BankEdit::AddNode {
            parent: NodeParent::Event { event: THREE_EVENT },
            node: NewNode::Existing { node: SOUND },
        },
    );

    edit(
        &mut document,
        BankEdit::Delete {
            object: SOUND,
            parent: Some(RANDOM),
        },
    );

    let written = bank_of(document.bytes());
    assert!(has(&written, SOUND));
    assert!(!children(&written, RANDOM).contains(&SOUND));
    assert_eq!(parent(&written, SOUND), MIXER);
    assert!(children(&written, MIXER).contains(&SOUND));
    assert_round_trip(
        &original,
        document.bytes(),
        &[RANDOM, SOUND, MIXER, THREE_EVENT],
    );
}

#[test]
fn delete_event_removes_its_unreferenced_objects() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Delete {
            object: EVENT,
            parent: None,
        },
    );

    let written = bank_of(document.bytes());
    for gone in [EVENT, PLAY, RANDOM, SOUND] {
        assert!(!has(&written, gone), "{gone} is kept");
    }
    assert!(has(&written, MIXER));
    assert!(!children(&written, MIXER).contains(&RANDOM));
    assert!(has(&written, RANDOM_THREE));
    assert_round_trip(&original, document.bytes(), &[MIXER]);
}

#[test]
fn delete_of_play_target_removes_play_from_event() {
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Delete {
            object: RANDOM_THREE,
            parent: Some(518_918_670),
        },
    );

    let written = bank_of(document.bytes());
    assert_eq!(actions(&written, THREE_EVENT), [152_754_888, 877_463_259]);
    assert!(!has(&written, 518_918_670));
    assert!(!has(&written, RANDOM_THREE));
}

#[test]
fn wrap_puts_new_container_in_place_of_child() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Wrap {
            objects: vec![SOUND],
            parent: RANDOM,
            container: ContainerKind::Random,
        },
    );

    let written = bank_of(document.bytes());
    let [wrapper] = added(&original, &written)[..] else {
        panic!("not one new object");
    };
    assert!(children(&written, RANDOM).contains(&wrapper));
    assert!(!children(&written, RANDOM).contains(&SOUND));
    assert_eq!(children(&written, wrapper), [SOUND]);
    assert_eq!(parent(&written, SOUND), wrapper);
    assert_eq!(parent(&written, wrapper), RANDOM);
    assert_round_trip(&original, document.bytes(), &[RANDOM, SOUND]);
}

#[test]
fn batch_is_one_undo_step() {
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Batch {
            edits: vec![
                BankEdit::Duplicate {
                    object: SOUND,
                    parent: RANDOM,
                },
                BankEdit::Wrap {
                    objects: vec![SOUND],
                    parent: RANDOM,
                    container: ContainerKind::Random,
                },
            ],
        },
    );
    assert!(document.undo().expect("undo"));

    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert!(!document.undo().expect("undo"));
}

#[test]
fn refused_batch_leaves_document_unchanged() {
    let mut document = document();

    let refused = try_edit(
        &mut document,
        BankEdit::Batch {
            edits: vec![
                BankEdit::Duplicate {
                    object: SOUND,
                    parent: RANDOM,
                },
                BankEdit::Delete {
                    object: 1,
                    parent: None,
                },
            ],
        },
    );

    assert!(matches!(refused, Err(BankEditError::NoObject(1))));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.revision(), 0);
}

fn import(
    document: &mut EventBankDocument,
    rest: &[&str],
    parent: NodeParent,
    wem: Vec<u8>,
) -> Result<u32, BankEditError> {
    let set = set_of(document, rest);
    let files = files(rest.contains(&PACKAGE));
    document
        .import(&parent, wem, &EditContext::new(&set).with_files(&files))
        .map(|imported| imported.sound)
}

#[test]
fn import_returns_source_that_new_sound_plays() {
    let mut document = document();
    let set = set_of(&document, &[MEDIA]);
    let files = files(false);
    let context = EditContext::new(&set).with_files(&files);

    let imported = document
        .import(
            &NodeParent::Container { container: RANDOM },
            fixture("clipped_vorbis.wem"),
            &context,
        )
        .expect("import");

    let written = bank_of(document.bytes());
    let Typed::Sound(sound) = typed(&written, imported.sound) else {
        panic!("not a sound");
    };
    assert_eq!(sound.source.source_id, SourceId(imported.source));
}

/// Returns the event bank of `document` with its media files, as the shell opens it.
fn event_bank(document: &EventBankDocument, rest: &[&str]) -> EventBank {
    let asset = |path: &str| AssetRef::File {
        path: path.to_lowercase(),
    };
    let opened = OpenedBank {
        path: EVENTS.to_owned(),
        file: AudioFile {
            asset: asset(EVENTS),
            contents: document.bytes().to_vec(),
        },
        media: document
            .media()
            .iter()
            .map(|file| OpenedFile {
                path: file.path().to_owned(),
                file: AudioFile {
                    asset: file.asset().clone(),
                    contents: file.bytes().to_vec(),
                },
            })
            .collect(),
        names: document.created_names().to_vec(),
    };

    let mut builder = AudioIndex::builder();
    builder.add_bin(
        "data/maps/shipping/map22/map22.bin",
        BinAudio {
            units: vec![ltk_manager_audio::SitedUnit {
                unit: BankUnit {
                    bank_path: [EVENTS]
                        .iter()
                        .chain(rest)
                        .map(|p| (*p).to_owned())
                        .collect(),
                    ..BankUnit::default()
                },
                ..ltk_manager_audio::SitedUnit::default()
            }],
            ..BinAudio::default()
        },
    );
    let index = builder.build();
    EventBank::open(
        opened,
        &[&index],
        &files(rest.contains(&PACKAGE)),
        None,
        &FakeNames::default(),
    )
}

#[test]
fn import_adds_media_bank_media_and_sound_that_tree_plays() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();
    edit(
        &mut document,
        BankEdit::NewEvent {
            name: "Play_sfx_Mod_Cast".to_owned(),
        },
    );
    let event = ObjectId::from_name("Play_sfx_Mod_Cast").0;

    let sound_id = import(
        &mut document,
        &[MEDIA],
        NodeParent::Event { event },
        wem.clone(),
    )
    .expect("import");

    let written = bank_of(document.bytes());
    let Typed::Sound(new) = typed(&written, sound_id) else {
        panic!("not a sound");
    };
    assert_eq!(new.source.stream_type, StreamType::DATA_BANK);
    assert_eq!(new.source.in_memory_size as usize, wem.len());
    assert_eq!(new.source.plugin_id, 0x0004_0001);
    assert_eq!(new.node.parent, ObjectId(MIXER));
    assert_round_trip(&original, document.bytes(), &[MIXER]);

    let [media] = document.media() else {
        panic!("not one media file");
    };
    assert_eq!(media.path(), MEDIA);
    let media_bank = bank_of(media.bytes());
    assert_eq!(
        media_bank
            .media()
            .and_then(|index| index.get(new.source.source_id)),
        Some(&wem[..])
    );

    let bank = event_bank(&document, &[MEDIA]);
    let tree = bank
        .event(ObjectId(event))
        .expect("resolve")
        .expect("event");
    assert_eq!(tree.name.as_deref(), Some("Play_sfx_Mod_Cast"));
    let Some(EventNode::Sound {
        media: Some(location),
        ..
    }) = &tree.actions[0].node
    else {
        panic!("the new sound has no media");
    };
    assert_eq!(location.container, MediaContainer::Bank);
    assert_eq!(location.path, MEDIA);
    sound(media.bytes(), SourceId(location.source)).expect("the media decodes");
}

#[test]
fn import_into_streamed_container_adds_package_entry() {
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();

    let sound_id = import(
        &mut document,
        &[MEDIA, PACKAGE],
        NodeParent::Container { container: RANDOM },
        wem.clone(),
    )
    .expect("import");

    let Typed::Sound(new) = typed(&bank_of(document.bytes()), sound_id) else {
        panic!("not a sound");
    };
    assert_eq!(new.source.stream_type, StreamType::STREAMING);
    let [package] = document.media() else {
        panic!("not one media file");
    };
    assert!(package.is_package());
    let read = Package::from_reader(&mut &package.bytes()[..]).expect("read the package");
    assert_eq!(read.wem(new.source.source_id), Some(&wem[..]));
    assert_eq!(read.len(), 3);
}

#[test]
fn undo_of_import_restores_both_files() {
    let mut document = document();
    import(
        &mut document,
        &[MEDIA],
        NodeParent::Container { container: RANDOM },
        fixture("clipped_vorbis.wem"),
    )
    .expect("import");
    assert!(document.media()[0].is_changed());

    assert!(document.undo().expect("undo"));

    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.media()[0].bytes(), fixture("media_v145.bnk"));
    assert!(!document.media()[0].is_changed());

    assert!(document.redo().expect("redo"));
    assert!(document.media()[0].is_changed());
}

#[test]
fn delete_of_imported_sound_drops_its_media() {
    let mut document = document();
    let sound_id = import(
        &mut document,
        &[MEDIA],
        NodeParent::Container { container: RANDOM },
        fixture("clipped_vorbis.wem"),
    )
    .expect("import");

    edit(
        &mut document,
        BankEdit::Delete {
            object: sound_id,
            parent: Some(RANDOM),
        },
    );

    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.media()[0].bytes(), fixture("media_v145.bnk"));
}

#[test]
fn delete_of_imported_streamed_sound_drops_its_package_entry() {
    let mut document = document();
    let sound_id = import(
        &mut document,
        &[MEDIA, PACKAGE],
        NodeParent::Container { container: RANDOM },
        fixture("clipped_vorbis.wem"),
    )
    .expect("import");

    let read_before = Package::from_reader(&mut &document.media()[0].bytes()[..]).expect("read");
    assert_eq!(read_before.len(), 3);

    edit(
        &mut document,
        BankEdit::Delete {
            object: sound_id,
            parent: Some(RANDOM),
        },
    );

    let read_after = Package::from_reader(&mut &document.media()[0].bytes()[..]).expect("read");
    assert_eq!(read_after.len(), 2);
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.media()[0].bytes(), fixture("package.wpk"));
}

#[test]
fn import_refuses_wem_of_other_codec() {
    let mut document = document();
    let unsupported = unsupported_wem();

    let refused = import(
        &mut document,
        &[MEDIA],
        NodeParent::Container { container: RANDOM },
        unsupported,
    );

    assert!(matches!(refused, Err(BankEditError::Codec(0x1234))));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert!(document.media().is_empty());
}

#[test]
fn import_refuses_file_that_is_not_wem() {
    let mut document = document();

    let refused = import(
        &mut document,
        &[MEDIA],
        NodeParent::Container { container: RANDOM },
        b"not a wem".to_vec(),
    );

    assert!(matches!(refused, Err(BankEditError::Wem(_))));
}

/// A RIFF `WAVE` of an unsupported codec 0x1234.
fn unsupported_wem() -> Vec<u8> {
    let data = [0u8; 8];
    let mut wem = Vec::new();
    wem.extend_from_slice(b"RIFF");
    wem.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wem.extend_from_slice(b"WAVEfmt ");
    wem.extend_from_slice(&16u32.to_le_bytes());
    wem.extend_from_slice(&0x1234u16.to_le_bytes());
    wem.extend_from_slice(&1u16.to_le_bytes());
    wem.extend_from_slice(&48_000u32.to_le_bytes());
    wem.extend_from_slice(&96_000u32.to_le_bytes());
    wem.extend_from_slice(&2u16.to_le_bytes());
    wem.extend_from_slice(&16u16.to_le_bytes());
    wem.extend_from_slice(b"data");
    wem.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wem.extend_from_slice(&data);
    wem
}

#[test]
fn objects_keep_kind_after_copy() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::CopyEvent {
            event: EVENT,
            name: "Play_sfx_Copy".to_owned(),
        },
    );

    let written = bank_of(document.bytes());
    let copy = ObjectId::from_name("Play_sfx_Copy").0;
    let [play] = actions(&written, copy)[..] else {
        panic!("not one action");
    };
    let container = target(&written, play);
    assert_ne!(container, RANDOM);
    assert_eq!(
        written
            .hierarchy()
            .and_then(|h| h.get(ObjectId(container)))
            .map(Object::kind),
        Some(ObjectKind::RANDOM_SEQUENCE_CONTAINER)
    );
    assert_eq!(children(&written, container).len(), 7);
}
