//! The replacement of a media at its source ID, the rename of an event and the bank ID of a
//! retargeted Play action, through the document.

mod common;

use common::{FakeFiles, fixture, packaged_sources};
use ltk_manager_audio::{
    BankEdit, BankEditError, BankSet, BankUnit, EditContext, EventBankDocument, ObjectId,
    SoundStream,
};
use ltk_wwise::hierarchy::{Hierarchy, Typed};
use ltk_wwise::{Bank, BankId, Package, SourceId};

const EVENTS: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_events.bnk";
const MEDIA: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.bnk";
const PACKAGE: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.wpk";
const OTHER: &str = "assets/sounds/wwise2016/sfx/shared/other_events.bnk";

/// The one `DATA_BANK` sound of the fixture, which plays [`BANKED_SOURCE`].
const BANKED_SOUND: u32 = 556_000_103;
const BANKED_SOURCE: u32 = 879_168_912;
/// The event of [`PLAY`].
const EVENT: u32 = 339_038_649;
/// The Play action of [`EVENT`], which plays a random container of the opened bank.
const PLAY: u32 = 538_040_822;
/// The sound of the bank at [`OTHER`].
const OTHER_SOUND: u32 = 1_234_567;
/// The bank ID in the header of the bank at [`OTHER`].
const OTHER_BANK: u32 = 99;

fn document() -> EventBankDocument {
    EventBankDocument::parse(fixture("events_v145.bnk")).expect("parse the event fixture")
}

/// A bank of [`OTHER_BANK`] that holds one sound, [`OTHER_SOUND`].
fn other_bank() -> Vec<u8> {
    let mut bank = Bank::from_reader(&mut &fixture("events_v145.bnk")[..]).expect("read");
    let version = bank.header().version;
    bank.header_mut().bank_id = BankId(OTHER_BANK);
    let hierarchy = bank.hierarchy_mut().expect("hierarchy");
    let Some(Typed::Sound(mut sound)) = hierarchy
        .get(ObjectId(BANKED_SOUND))
        .expect("sound")
        .decode(version)
        .expect("decode")
    else {
        panic!("not a sound");
    };
    sound.id = ObjectId(OTHER_SOUND);
    let mut only = Hierarchy::new();
    only.push(Typed::Sound(sound).encode(version).expect("encode"));
    *hierarchy = only;

    let mut bytes = Vec::new();
    bank.to_writer(&mut bytes).expect("write");
    bytes
}

fn files() -> FakeFiles {
    FakeFiles::default()
        .with_fixture(MEDIA, "media_v145.bnk")
        .with_fixture(PACKAGE, "package.wpk")
        .with(OTHER, other_bank())
}

fn set_of(document: &EventBankDocument, rest: &[&str]) -> BankSet {
    let mut files = files().with(EVENTS, document.bytes().to_vec());
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

fn replace(
    document: &mut EventBankDocument,
    source: u32,
    wem: Vec<u8>,
) -> Result<(), BankEditError> {
    let set = set_of(document, &[MEDIA, PACKAGE]);
    let files = files();
    document.replace(source, wem, &EditContext::new(&set).with_files(&files))
}

fn sound(bytes: &[u8], id: u32) -> ltk_wwise::hierarchy::Sound {
    let bank = Bank::from_reader(&mut &bytes[..]).expect("read");
    match bank
        .hierarchy()
        .and_then(|hierarchy| hierarchy.get(ObjectId(id)))
        .expect("object")
        .decode(bank.header().version)
        .expect("decode")
    {
        Some(Typed::Sound(sound)) => sound,
        _ => panic!("{id} is not a sound"),
    }
}

fn play_bank(bytes: &[u8], id: u32) -> Option<BankId> {
    let bank = Bank::from_reader(&mut &bytes[..]).expect("read");
    match bank
        .hierarchy()
        .and_then(|hierarchy| hierarchy.get(ObjectId(id)))
        .expect("object")
        .decode(bank.header().version)
        .expect("decode")
    {
        Some(Typed::Action(action)) => action.play_bank(),
        _ => panic!("{id} is not an action"),
    }
}

#[test]
fn replace_keeps_source_id_and_sets_in_memory_size() {
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();

    replace(&mut document, BANKED_SOURCE, wem.clone()).expect("replace");

    let [media] = document.media() else {
        panic!("not one media file");
    };
    let bank = Bank::from_reader(&mut &media.bytes()[..]).expect("read media bank");
    assert_eq!(
        bank.media()
            .and_then(|media| media.get(SourceId(BANKED_SOURCE))),
        Some(&wem[..])
    );
    assert_eq!(
        sound(document.bytes(), BANKED_SOUND).source.in_memory_size as usize,
        wem.len()
    );
    assert_eq!(document.edited(), [ObjectId(BANKED_SOUND)]);
    assert_eq!(document.replaced(), [BANKED_SOURCE]);
}

#[test]
fn undo_of_replace_restores_both_files() {
    let mut document = document();
    replace(&mut document, BANKED_SOURCE, fixture("clipped_vorbis.wem")).expect("replace");

    assert!(document.undo().expect("undo"));

    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
    assert_eq!(document.media()[0].bytes(), fixture("media_v145.bnk"));
    assert!(document.replaced().is_empty());

    assert!(document.redo().expect("redo"));
    assert_eq!(document.replaced(), [BANKED_SOURCE]);
}

#[test]
fn replace_of_packaged_media_writes_package_entry_and_keeps_bank() {
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();
    let streamed = packaged_sources()[0].0;

    replace(&mut document, streamed, wem.clone()).expect("replace");

    let [package] = document.media() else {
        panic!("not one media file");
    };
    assert!(package.is_package());
    let read = Package::from_reader(&mut &package.bytes()[..]).expect("read package");
    assert_eq!(read.wem(SourceId(streamed)), Some(&wem[..]));
    assert_eq!(read.len(), 2);
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
}

#[test]
fn replacement_lists_sounds_that_play_media() {
    let wem = fixture("clipped_vorbis.wem");
    let document = document();
    let set = set_of(&document, &[MEDIA, PACKAGE]);
    let files = files();

    let replacement = document
        .replacement(
            BANKED_SOURCE,
            &wem,
            &EditContext::new(&set).with_files(&files),
        )
        .expect("replacement");

    assert_eq!(replacement.path, MEDIA);
    let [sound] = replacement.sounds[..] else {
        panic!("not one sound");
    };
    assert_eq!(sound.id, BANKED_SOUND);
    assert_eq!(sound.stream, SoundStream::DataBank);
    assert!(sound.opened);
    assert_eq!(sound.new_size as usize, wem.len());
    assert_eq!(replacement.after.size_bytes as usize, wem.len());
}

#[test]
fn replace_refuses_media_that_a_sound_of_another_bank_reads_from_a_bank() {
    let mut document = document();
    let set = set_of(&document, &[MEDIA, OTHER]);
    let files = files();

    let refused = document.replace(
        BANKED_SOURCE,
        fixture("clipped_vorbis.wem"),
        &EditContext::new(&set).with_files(&files),
    );

    assert!(matches!(
        refused,
        Err(BankEditError::SharedSound {
            sound: OTHER_SOUND,
            ..
        })
    ));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
}

#[test]
fn replace_refuses_wem_of_other_codec() {
    let mut document = document();
    let mut unsupported = fixture("clipped_vorbis.wem");
    unsupported[20..22].copy_from_slice(&0x1234u16.to_le_bytes());

    let refused = replace(&mut document, BANKED_SOURCE, unsupported);

    assert!(matches!(refused, Err(BankEditError::Codec(0x1234))));
    assert!(document.media().is_empty());
}

#[test]
fn delete_of_sound_drops_unused_replaced_media() {
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();
    replace(&mut document, BANKED_SOURCE, wem).expect("replace");
    let set = set_of(&document, &[MEDIA, PACKAGE]);
    let parent = sound(document.bytes(), BANKED_SOUND).node.parent.0;

    document
        .edit(
            &BankEdit::Delete {
                object: BANKED_SOUND,
                parent: Some(parent),
            },
            &EditContext::new(&set),
        )
        .expect("delete");

    assert!(document.replaced().is_empty());
    assert!(!document.media()[0].contains(SourceId(BANKED_SOURCE)));

    assert!(document.undo().expect("undo"));
    assert_eq!(document.replaced(), [BANKED_SOURCE]);
    assert!(document.media()[0].contains(SourceId(BANKED_SOURCE)));
}

#[test]
fn delete_of_sound_keeps_media_that_another_bank_plays() {
    let wem = fixture("clipped_vorbis.wem");
    let mut document = document();
    replace(&mut document, BANKED_SOURCE, wem).expect("replace");
    let set = set_of(&document, &[MEDIA, PACKAGE, OTHER]);
    let parent = sound(document.bytes(), BANKED_SOUND).node.parent.0;

    document
        .edit(
            &BankEdit::Delete {
                object: BANKED_SOUND,
                parent: Some(parent),
            },
            &EditContext::new(&set),
        )
        .expect("delete");

    assert_eq!(document.replaced(), [BANKED_SOURCE]);
    assert!(document.media()[0].contains(SourceId(BANKED_SOURCE)));
}

#[test]
fn delete_of_sound_drops_original_media() {
    let mut document = document();
    let set = set_of(&document, &[MEDIA, PACKAGE]);
    let files = files();
    let parent = sound(document.bytes(), BANKED_SOUND).node.parent.0;

    document
        .edit(
            &BankEdit::Delete {
                object: BANKED_SOUND,
                parent: Some(parent),
            },
            &EditContext::new(&set).with_files(&files),
        )
        .expect("delete");

    assert_eq!(document.media().len(), 1);
    assert_eq!(document.media()[0].path(), MEDIA);
    assert!(!document.media()[0].contains(SourceId(BANKED_SOURCE)));
    assert!(document.media()[0].is_changed());

    assert!(document.undo().expect("undo"));
    assert!(document.media()[0].contains(SourceId(BANKED_SOURCE)));
    assert!(!document.media()[0].is_changed());
}


#[test]
fn rename_event_gives_event_id_of_name_in_its_place() {
    let mut document = document();
    let set = set_of(&document, &[MEDIA]);
    let before = document.events();

    document
        .edit(
            &BankEdit::RenameEvent {
                event: EVENT,
                name: "Play_sfx_Mod_Renamed".to_owned(),
            },
            &EditContext::new(&set),
        )
        .expect("rename");

    let renamed = ObjectId::from_name("Play_sfx_Mod_Renamed").0;
    let after = document.events();
    let at = before.iter().position(|id| *id == EVENT).expect("event");
    assert_eq!(after[at], renamed);
    assert_eq!(after.len(), before.len());
    assert_eq!(document.created_names(), ["Play_sfx_Mod_Renamed"]);

    assert!(document.undo().expect("undo"));
    assert_eq!(document.bytes(), fixture("events_v145.bnk"));
}

#[test]
fn rename_event_refuses_name_of_existing_event() {
    let mut document = document();
    let set = set_of(&document, &[MEDIA]);
    let other = *document
        .events()
        .iter()
        .find(|id| **id != EVENT)
        .expect("another event");
    document
        .edit(
            &BankEdit::RenameEvent {
                event: other,
                name: "Play_sfx_Mod_Taken".to_owned(),
            },
            &EditContext::new(&set),
        )
        .expect("rename");
    let set = set_of(&document, &[MEDIA]);

    let refused = document.edit(
        &BankEdit::RenameEvent {
            event: EVENT,
            name: "Play_sfx_Mod_Taken".to_owned(),
        },
        &EditContext::new(&set),
    );

    assert!(matches!(refused, Err(BankEditError::EventExists(_))));
}

#[test]
fn target_in_other_bank_sets_play_bank() {
    let mut document = document();
    let opened = play_bank(document.bytes(), PLAY);
    let set = set_of(&document, &[MEDIA, OTHER]);

    document
        .edit(
            &BankEdit::Target {
                action: PLAY,
                target: OTHER_SOUND,
            },
            &EditContext::new(&set),
        )
        .expect("retarget");

    assert_eq!(play_bank(document.bytes(), PLAY), Some(BankId(OTHER_BANK)));
    assert_ne!(opened, Some(BankId(OTHER_BANK)));
}

#[test]
fn target_in_opened_bank_keeps_play_bank() {
    let mut document = document();
    let opened = play_bank(document.bytes(), PLAY);
    let set = set_of(&document, &[MEDIA]);

    document
        .edit(
            &BankEdit::Target {
                action: PLAY,
                target: BANKED_SOUND,
            },
            &EditContext::new(&set),
        )
        .expect("retarget");

    assert_eq!(play_bank(document.bytes(), PLAY), opened);
}
