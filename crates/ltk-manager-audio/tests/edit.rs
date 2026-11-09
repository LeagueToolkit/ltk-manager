//! Edits of an open event bank, through the document and the bank set that checks them.

mod common;

use common::{FakeFiles, FakeNames, fixture};
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_audio::{
    AudioFile, BankEdit, BankEditError, BankSet, BankUnit, EditContext, EventBank,
    EventBankDocument, EventNode, NodeProperty, ObjectId, OpenedBank, SourceId,
};
use ltk_wwise::hierarchy::{ContainerFields, Object, PropertyId, Typed};
use ltk_wwise::{Bank, MediaIndex};

const MEDIA: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.bnk";
/// The one `DATA_BANK` sound of the fixture, which plays [`BANKED_SOURCE`].
const BANKED_SOUND: u32 = 556_000_103;
const BANKED_SOURCE: u32 = 879_168_912;
/// A streaming sound of the random container [`STREAMED_PARENT`].
const STREAMED_SOUND: u32 = 747_636_874;
/// The random container of the event 3553705574, whose one child is [`STREAMED_SOUND`].
const STREAMED_PARENT: u32 = 279_797_186;

const EVENTS: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_events.bnk";

/// A sound of the random container 414059032, without properties.
const SOUND: u32 = 103_146_397;
/// The random container of the event 339038649, with seven sounds.
const RANDOM: u32 = 414_059_032;
/// The Play action of the event 339038649, which plays [`RANDOM`].
const PLAY: u32 = 538_040_822;
/// The actor-mixer that holds every random container of the fixture.
const MIXER: u32 = 77_798_476;

fn document() -> EventBankDocument {
    EventBankDocument::parse(fixture("events_v145.bnk")).expect("parse the event fixture")
}

/// Returns the bank set of `document` alone, the document's current bytes as its first file.
fn set_of(document: &EventBankDocument) -> BankSet {
    set_with(document, FakeFiles::default(), &[])
}

/// Returns the bank set of `document` and the files `extra`, which `files` contains.
fn set_with(document: &EventBankDocument, files: FakeFiles, extra: &[&str]) -> BankSet {
    let files = files.with(EVENTS, document.bytes().to_vec());
    let mut bank_path = vec![EVENTS.to_owned()];
    bank_path.extend(extra.iter().map(|path| (*path).to_owned()));
    let unit = BankUnit {
        bank_path,
        ..BankUnit::default()
    };
    BankSet::open(&[unit], &files, None)
}

fn edit(document: &mut EventBankDocument, edit: BankEdit) {
    let set = set_of(document);
    document
        .edit(&edit, &EditContext::new(&set))
        .expect("apply the edit");
}

fn bank_of(bytes: &[u8]) -> Bank {
    Bank::from_reader(&mut &bytes[..]).expect("read the written bank")
}

fn object(bank: &Bank, id: u32) -> &Object {
    bank.hierarchy()
        .and_then(|hierarchy| hierarchy.get(ObjectId(id)))
        .unwrap_or_else(|| panic!("no object {id}"))
}

fn typed(bank: &Bank, id: u32) -> Typed {
    object(bank, id)
        .decode(bank.header().version)
        .expect("decode")
        .expect("typed")
}

/// Returns the IDs of the objects of `after` whose payload differs from `before`.
fn changed(before: &Bank, after: &Bank) -> Vec<u32> {
    let before = before.hierarchy().expect("hierarchy");
    after
        .hierarchy()
        .expect("hierarchy")
        .objects()
        .iter()
        .filter(|object| before.get(object.id()) != Some(*object))
        .map(|object| object.id().0)
        .collect()
}

#[test]
fn property_edit_changes_only_its_object() {
    let original = bank_of(&fixture("events_v145.bnk"));
    let mut document = document();

    edit(
        &mut document,
        BankEdit::Property {
            object: SOUND,
            property: NodeProperty::Volume,
            value: -6.0,
        },
    );

    let written = bank_of(document.bytes());
    assert_eq!(changed(&original, &written), [SOUND]);
    let Typed::Sound(sound) = typed(&written, SOUND) else {
        panic!("not a sound");
    };
    assert_eq!(sound.node.props.f32(PropertyId::VOLUME), Some(-6.0));
    assert!(document.is_dirty());
    assert_eq!(document.edited(), [ObjectId(SOUND)]);
}

#[test]
fn undo_restores_original_bytes_and_redo_reapplies() {
    let original = fixture("events_v145.bnk");
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Property {
            object: RANDOM,
            property: NodeProperty::Pitch,
            value: 300.0,
        },
    );
    let edited = document.bytes().to_vec();

    assert!(document.undo().expect("undo"));
    assert_eq!(document.bytes(), original);
    assert!(document.edited().is_empty());
    assert!(document.is_dirty());

    assert!(document.redo().expect("redo"));
    assert_eq!(document.bytes(), edited);
    assert!(!document.redo().expect("redo"));
}

#[test]
fn saved_document_is_base_of_its_bytes_and_clean() {
    let mut document = document();
    assert!(document.is_base(&fixture("events_v145.bnk")));
    edit(
        &mut document,
        BankEdit::Property {
            object: PLAY,
            property: NodeProperty::Delay,
            value: 0.25,
        },
    );

    let written = document.bytes().to_vec();
    document.mark_saved();

    assert!(!document.is_dirty());
    assert!(document.is_base(&written));
    assert!(!document.is_base(&fixture("events_v145.bnk")));
    let Typed::Action(action) = typed(&bank_of(&written), PLAY) else {
        panic!("not an action");
    };
    assert_eq!(action.props.i32(PropertyId::DELAY_TIME), Some(250));
}

#[test]
fn property_edit_removes_property_at_default_value() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Property {
            object: SOUND,
            property: NodeProperty::LoopCount,
            value: 0.0,
        },
    );
    edit(
        &mut document,
        BankEdit::Property {
            object: SOUND,
            property: NodeProperty::LoopCount,
            value: 1.0,
        },
    );

    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.revision(), 2);
}

#[test]
fn property_edit_refuses_out_of_range_value() {
    let mut document = document();
    let set = set_of(&document);

    let refused = document.edit(
        &BankEdit::Property {
            object: SOUND,
            property: NodeProperty::Lpf,
            value: 150.0,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(refused, Err(BankEditError::Value { .. })));
}

#[test]
fn property_edit_sets_make_up_gain_and_hpf_of_container() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Property {
            object: RANDOM,
            property: NodeProperty::MakeUpGain,
            value: -4.5,
        },
    );
    edit(
        &mut document,
        BankEdit::Property {
            object: RANDOM,
            property: NodeProperty::Hpf,
            value: 20.0,
        },
    );

    let Typed::Container(container) = typed(&bank_of(document.bytes()), RANDOM) else {
        panic!("not a container");
    };
    assert_eq!(
        container.node.props.f32(PropertyId::MAKE_UP_GAIN),
        Some(-4.5)
    );
    assert_eq!(container.node.props.f32(PropertyId::HPF), Some(20.0));
}

#[test]
fn property_edit_refuses_hpf_out_of_range() {
    let mut document = document();
    let set = set_of(&document);

    let refused = document.edit(
        &BankEdit::Property {
            object: SOUND,
            property: NodeProperty::Hpf,
            value: -1.0,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(refused, Err(BankEditError::Value { .. })));
}

#[test]
fn property_edit_refuses_loop_count_of_container() {
    let mut document = document();
    let set = set_of(&document);

    let refused = document.edit(
        &BankEdit::Property {
            object: RANDOM,
            property: NodeProperty::LoopCount,
            value: 2.0,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(refused, Err(BankEditError::Property { .. })));
}

#[test]
fn target_edit_points_play_action_at_another_node() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Target {
            action: PLAY,
            target: SOUND,
        },
    );

    let Typed::Action(action) = typed(&bank_of(document.bytes()), PLAY) else {
        panic!("not an action");
    };
    assert_eq!(action.target, ObjectId(SOUND));
    assert_eq!(document.edited(), [ObjectId(PLAY)]);
}

#[test]
fn target_edit_refuses_dangling_target() {
    let mut document = document();
    let set = set_of(&document);

    let refused = document.edit(
        &BankEdit::Target {
            action: PLAY,
            target: 12_345,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(refused, Err(BankEditError::NoNode(12_345))));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.revision(), 0);
}

#[test]
fn delete_drops_child_from_children_and_playlist_and_removes_it() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Delete {
            object: SOUND,
            parent: Some(RANDOM),
        },
    );

    let written = bank_of(document.bytes());
    let (children, playlist) = random_lists(&written, RANDOM);
    assert!(!children.contains(&SOUND));
    assert!(!playlist.iter().any(|(child, _)| *child == SOUND));
    assert_eq!(children.len(), 6);
    assert_eq!(playlist.len(), 6);
    assert!(
        written
            .hierarchy()
            .expect("hierarchy")
            .get(ObjectId(SOUND))
            .is_none()
    );
}

#[test]
fn add_child_moves_child_in_id_order_and_appends_playlist_item() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::AddChild {
            container: RANDOM,
            child: STREAMED_SOUND,
        },
    );

    let written = bank_of(document.bytes());
    let (children, playlist) = random_lists(&written, RANDOM);
    let mut sorted = children.clone();
    sorted.sort_unstable();
    assert_eq!(children, sorted);
    assert!(children.contains(&STREAMED_SOUND));
    assert_eq!(playlist.last(), Some(&(STREAMED_SOUND, 50_000)));
    assert!(random_lists(&written, STREAMED_PARENT).0.is_empty());
    assert_eq!(parent_of(&written, STREAMED_SOUND), RANDOM);
    assert_eq!(
        document.edited(),
        [
            ObjectId(STREAMED_SOUND),
            ObjectId(STREAMED_PARENT),
            ObjectId(RANDOM)
        ]
    );
}

#[test]
fn add_child_refuses_held_child_and_dangling_child() {
    let mut document = document();
    let set = set_of(&document);

    let held = document.edit(
        &BankEdit::AddChild {
            container: RANDOM,
            child: SOUND,
        },
        &EditContext::new(&set),
    );
    let dangling = document.edit(
        &BankEdit::AddChild {
            container: MIXER,
            child: 1,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(held, Err(BankEditError::AlreadyChild { .. })));
    assert!(matches!(dangling, Err(BankEditError::NoNode(1))));
    assert_eq!(document.revision(), 0);
}

#[test]
fn move_child_moves_playlist_item_to_index() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::MoveChild {
            container: RANDOM,
            child: SOUND,
            index: 3,
        },
    );

    let (_, playlist) = random_lists(&bank_of(document.bytes()), RANDOM);
    assert_eq!(playlist[3].0, SOUND);
    assert_eq!(playlist.len(), 7);
}

#[test]
fn weight_edit_sets_weight_and_turns_on_weights() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Weight {
            container: RANDOM,
            child: SOUND,
            weight: 90_000,
        },
    );

    let Typed::Container(container) = typed(&bank_of(document.bytes()), RANDOM) else {
        panic!("not a container");
    };
    let ContainerFields::RandomSequence(fields) = container.fields else {
        panic!("not a random container");
    };
    assert_eq!(fields.bits & 1, 1);
    let item = fields
        .playlist
        .iter()
        .find(|item| item.child == ObjectId(SOUND))
        .expect("item");
    assert_eq!(item.weight, 90_000);
}

#[test]
fn source_edit_points_banked_sound_at_media_of_set() {
    let mut media = MediaIndex::new();
    media.insert(SourceId(42), vec![0; 12]);
    let mut media_bank = Vec::new();
    Bank::media_only(MEDIA, media)
        .to_writer(&mut media_bank)
        .expect("write media bank");
    let mut document = document();
    let set = set_with(
        &document,
        FakeFiles::default().with(MEDIA, media_bank),
        &[MEDIA],
    );

    document
        .edit(
            &BankEdit::Source {
                sound: BANKED_SOUND,
                source: 42,
            },
            &EditContext::new(&set),
        )
        .expect("a source that the media bank contains");

    let Typed::Sound(sound) = typed(&bank_of(document.bytes()), BANKED_SOUND) else {
        panic!("not a sound");
    };
    assert_eq!(sound.source.source_id, SourceId(42));
    assert_eq!(sound.source.in_memory_size, 12);
}

#[test]
fn source_edit_refuses_media_outside_set_and_wrong_container() {
    let mut document = document();
    let set = set_with(
        &document,
        FakeFiles::default().with_fixture(MEDIA, "media_v145.bnk"),
        &[MEDIA],
    );

    let dangling = document.edit(
        &BankEdit::Source {
            sound: BANKED_SOUND,
            source: 42,
        },
        &EditContext::new(&set),
    );
    let streamed = document.edit(
        &BankEdit::Source {
            sound: STREAMED_SOUND,
            source: BANKED_SOURCE,
        },
        &EditContext::new(&set),
    );

    assert!(matches!(dangling, Err(BankEditError::NoMedia { .. })));
    assert!(matches!(streamed, Err(BankEditError::NoMedia { .. })));
    assert_eq!(document.revision(), 0);
}

#[test]
fn legacy_bank_can_upgrade_and_takes_edits() {
    let mut document =
        EventBankDocument::parse(fixture("events_v134.bnk")).expect("parse the legacy fixture");
    let set = set_of(&document);

    assert!(document.can_upgrade());
    assert!(document.is_editable());
    assert_eq!(document.version(), 134);

    let result = document.edit(
        &BankEdit::NewEvent {
            name: "test_new_event".to_owned(),
        },
        &EditContext::new(&set),
    );

    assert!(
        result.is_ok(),
        "edit failed with: {:?}",
        result.unwrap_err()
    );
    assert_eq!(document.version(), 145);
}

#[test]
fn event_bank_of_edited_bytes_resolves_edited_tree_and_properties() {
    let mut document = document();
    edit(
        &mut document,
        BankEdit::Delete {
            object: SOUND,
            parent: Some(RANDOM),
        },
    );
    edit(
        &mut document,
        BankEdit::Property {
            object: RANDOM,
            property: NodeProperty::Volume,
            value: -4.5,
        },
    );

    let bank = EventBank::open(
        OpenedBank {
            path: EVENTS.to_owned(),
            file: AudioFile {
                asset: AssetRef::File {
                    path: EVENTS.to_owned(),
                },
                contents: document.bytes().to_vec(),
            },
            media: Vec::new(),
            names: Vec::new(),
        },
        &[],
        &FakeFiles::default(),
        None,
        &FakeNames::default(),
    );
    let tree = bank
        .event(ObjectId(339_038_649))
        .expect("resolve")
        .expect("event");
    let Some(EventNode::Random { children, .. }) = &tree.actions[0].node else {
        panic!("not a random container");
    };
    assert_eq!(children.len(), 6);

    let properties = bank.properties(&tree);
    let random = properties
        .iter()
        .find(|object| object.id == RANDOM)
        .expect("properties of the container");
    assert!(random.editable);
    let volume = random
        .values
        .iter()
        .find(|value| value.property == NodeProperty::Volume)
        .expect("volume");
    assert!((volume.value - -4.5).abs() < f32::EPSILON);
    assert_eq!(
        random.weights.as_ref().map(|weights| weights.items.len()),
        Some(6)
    );
    assert!(!bank.nodes().iter().any(|node| node.id == SOUND));
}

/// Returns the children of the random container `id` and its playlist as `(child, weight)`.
fn random_lists(bank: &Bank, id: u32) -> (Vec<u32>, Vec<(u32, u32)>) {
    let Typed::Container(container) = typed(bank, id) else {
        panic!("not a container");
    };
    let ContainerFields::RandomSequence(fields) = container.fields else {
        panic!("not a random container");
    };
    (
        container.children.iter().map(|child| child.0).collect(),
        fields
            .playlist
            .iter()
            .map(|item| (item.child.0, item.weight))
            .collect(),
    )
}

/// Returns the `parent` field of the sound or container `id`.
fn parent_of(bank: &Bank, id: u32) -> u32 {
    match typed(bank, id) {
        Typed::Sound(sound) => sound.node.parent.0,
        Typed::Container(container) => container.node.parent.0,
        _ => panic!("{id} is not a node"),
    }
}
