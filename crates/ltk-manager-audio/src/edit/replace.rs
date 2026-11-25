//! The replacement of a media of the bank set at its source ID, and the sounds that it rewrites.
//!
//! "Replacing media" in `docs/ux/AUDIO.md`. The media keeps its source ID, so every sound that
//! plays it plays the new media.

use ltk_wwise::SourceId;
use ltk_wwise::bank::BankVersion;
use ltk_wwise::hierarchy::{Object, ObjectKind, StreamType, Typed};
use serde::Serialize;

use super::history::Tx;
use super::media_file::MediaFile;
use super::structure::{plugin_id_for_codec, read_media_file};
use super::{BankEditError, EditContext};
use crate::bank_set::BankContent;
use crate::events::SoundStream;
use crate::media::{MediaRow, media_row};

/// A media of the bank set, the WEM that replaces it, and the sounds that play it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MediaReplacement {
    /// The game path of the file that holds the media.
    pub path: String,
    /// The media as the file holds it now.
    pub before: MediaRow,
    /// The WEM that replaces it.
    pub after: MediaRow,
    /// The sounds of the bank set that play the media, those of the opened bank first.
    pub sounds: Vec<ReplacedSound>,
}

/// A sound that plays a replaced media, and the `in_memory_size` that the replacement writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReplacedSound {
    /// The object ID of the sound.
    pub id: u32,
    /// Where the media of the sound is stored.
    pub stream: SoundStream,
    /// `true` if the sound is in the opened bank, which the replacement rewrites.
    pub opened: bool,
    /// The `in_memory_size` of the sound now.
    pub size: u32,
    /// The `in_memory_size` after the replacement.
    pub new_size: u32,
}

/// What a replacement writes: the replacement, and the files that hold the media.
pub(super) struct Plan {
    pub replacement: MediaReplacement,
    /// The set file that holds the whole media, and `true` if it is a package.
    home: (String, bool),
    /// The bank of the set that holds the prefetched start, and the length of the start.
    prefix: Option<(String, usize)>,
}

/// Returns what replacing the media `source` with `wem` writes, read against `context`.
///
/// `objects` are those of the opened bank at `version`, and `media` the document's media files.
/// Fails if no file of the set holds the media, if the opened bank holds it, or if a sound of
/// another bank would need another `in_memory_size`.
pub(super) fn plan(
    objects: &[Object],
    version: BankVersion,
    context: &EditContext<'_>,
    media: &[MediaFile],
    source: SourceId,
    wem: &[u8],
) -> Result<Plan, BankEditError> {
    let set = context.set;
    let (home, package) = match set.package_with_media(source) {
        Some(file) => (file, true),
        None => (
            set.bank_with_media(source).ok_or(BankEditError::NoMedia {
                media: source.0,
                container: "media index or package",
            })?,
            false,
        ),
    };
    if home == 0 {
        return Err(BankEditError::OpenedMedia(source.0));
    }
    let path = set.files()[home].path().to_owned();

    let sounds = playing_sounds(objects, version, context, source, wem.len())?;
    let prefix = match sounds
        .iter()
        .find(|sound| sound.stream == SoundStream::Prefetch)
    {
        Some(sound) => {
            let file = set.bank_with_media(source).ok_or(BankEditError::NoMedia {
                media: source.0,
                container: "media index",
            })?;
            if file == 0 {
                return Err(BankEditError::OpenedMedia(source.0));
            }
            let length = usize::try_from(sound.new_size).unwrap_or(usize::MAX);
            Some((set.files()[file].path().to_owned(), length))
        }
        None => None,
    };

    let current = held_media(media, context, &path, package, source)?;
    Ok(Plan {
        replacement: MediaReplacement {
            path: path.clone(),
            before: media_row(source.0, &current),
            after: media_row(source.0, wem),
            sounds,
        },
        home: (path, package),
        prefix,
    })
}

/// Replaces the media `source` with `wem` in `tx`, and rewrites the sounds of the opened bank
/// that play it.
pub(super) fn replace(
    tx: &mut Tx<'_, '_>,
    source: SourceId,
    wem: Vec<u8>,
) -> Result<(), BankEditError> {
    let info = super::structure::check_wem(&wem)?;
    let plugin_id = plugin_id_for_codec(info.codec).ok_or(BankEditError::Codec(info.codec.0))?;

    let Plan {
        replacement,
        home: (path, package),
        prefix,
    } = plan(
        tx.objects(),
        tx.version,
        tx.context,
        &tx.media[..],
        source,
        &wem,
    )?;

    if let Some((bank, length)) = prefix {
        let at = read_media_file(tx, &bank, false)?;
        let start = wem.get(..length).unwrap_or(&wem).to_vec();
        tx.set_media(at, source, start);
    }
    let file = read_media_file(tx, &path, package)?;
    tx.set_media(file, source, wem);

    for sound in replacement.sounds.iter().filter(|sound| sound.opened) {
        let Typed::Sound(mut typed) = tx.typed(ltk_wwise::ObjectId(sound.id))? else {
            continue;
        };
        typed.source.in_memory_size = sound.new_size;
        typed.source.plugin_id = plugin_id;
        tx.put(&Typed::Sound(typed))?;
    }
    Ok(())
}

/// Returns the sounds of the opened bank and of the other banks of the set that play `source`,
/// with the size that a WEM of `length` bytes gives each.
fn playing_sounds(
    objects: &[Object],
    version: BankVersion,
    context: &EditContext<'_>,
    source: SourceId,
    length: usize,
) -> Result<Vec<ReplacedSound>, BankEditError> {
    let length = u32::try_from(length).unwrap_or(u32::MAX);
    let mut sounds = Vec::new();
    let mut collect = |objects: &[Object], version: BankVersion, opened: bool, path: &str| {
        for object in objects.iter().filter(|o| o.kind() == ObjectKind::SOUND) {
            let Ok(Some(Typed::Sound(sound))) = object.decode(version) else {
                continue;
            };
            if sound.source.source_id != source {
                continue;
            }

            let size = sound.source.in_memory_size;
            let new_size = match sound.source.stream_type {
                StreamType::DATA_BANK => length,
                StreamType::PREFETCH => size.min(length),
                _ => 0,
            };
            if !opened && new_size != size {
                return Err(BankEditError::SharedSound {
                    sound: sound.id.0,
                    path: path.to_owned(),
                });
            }
            sounds.push(ReplacedSound {
                id: sound.id.0,
                stream: sound.source.stream_type.into(),
                opened,
                size,
                new_size,
            });
        }
        Ok(())
    };

    collect(objects, version, true, "")?;
    for file in context.set.files().iter().skip(1) {
        if let BankContent::Bank { bank } = file.content()
            && let Some(hierarchy) = bank.hierarchy()
        {
            collect(
                hierarchy.objects(),
                bank.header().version,
                false,
                file.path(),
            )?;
        }
    }
    Ok(sounds)
}

/// Returns the bytes of the media `source` of the set file `path`: the document's copy if it
/// holds the file, else the file read through the files of `context`.
fn held_media(
    media: &[MediaFile],
    context: &EditContext<'_>,
    path: &str,
    package: bool,
    source: SourceId,
) -> Result<Vec<u8>, BankEditError> {
    let missing = || BankEditError::NoMedia {
        media: source.0,
        container: "media index or package",
    };
    if let Some(file) = media.iter().find(|file| file.path() == path) {
        return file.media(source).map(<[u8]>::to_vec).ok_or_else(missing);
    }

    let files = context.files.ok_or(BankEditError::NoMediaFile)?;
    let read = files
        .read(path)
        .map_err(|error| BankEditError::MediaRead(error.to_string()))?
        .ok_or(BankEditError::NoMediaFile)?;
    let file = MediaFile::read(path, read.asset, read.contents, package)?;
    file.media(source).map(<[u8]>::to_vec).ok_or_else(missing)
}
