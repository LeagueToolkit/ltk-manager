//! `audio/bank-version` - an audio bank the game's reader will not load.
//!
//! The reader gates a bank on the generator version in its header, and the gate
//! is conditional on what the bank holds. The version it takes as current loads
//! whatever it carries. An older version, down to a floor, loads only if it
//! carries nothing beyond its media index and its media blob - so a legacy
//! media bank loads, and a legacy bank carrying the objects that hold events
//! and sounds does not.
//!
//! A rejected bank is dropped **silently**. Nothing is written to the log and
//! nothing is shown, so a mod whose sounds never play looks like a mod that
//! works, which is why this is worth a check at all.
//!
//! Two things keep the rule honest, and both are refusals:
//!
//! - **The version alone is not the predicate.** Most legacy banks in the wild
//!   are media-only and load perfectly, and the game itself ships hundreds of
//!   them. A rule keyed on the version would report every one.
//! - **The rule judges downwards only.** [`CURRENT_VERSION`] is written down
//!   rather than read from the install, and a bank at or above it is never
//!   reported. Read the other way, the release after Riot moves the version
//!   would call every newly authored bank defective - a false positive on a
//!   health check, which is the failure the whole check exists to avoid.
//!   Judged downwards a stale constant goes quiet instead, and the class this
//!   reports stays reported, because a bank at an old version does not become
//!   valid later.
//!
//! What that buys out is a bank authored against a newer toolchain than the
//! player's game, which needs the player's own current version to catch.
//!
//! # The repair
//!
//! An overlay archive is the game's own archive with the mod's overrides
//! layered over it, so removing a mod's bank does not leave a hole - it leaves
//! the bank the game shipped. On the ordinary sound mod that is not a
//! consolation prize: the mod ships its media bank as well, that one loads, and
//! the game's own events then fire against the mod's media. **The repair does
//! not restore the game's audio, it makes the mod play the audio its author
//! shipped.**
//!
//! What deletion has to answer is therefore not "does anything reference this
//! file" but *after removing it, can every request for it still be answered*.
//! Those give different answers, and the difference is the whole guard:
//!
//! | Asked for by a bank unit | The install holds the path | Verdict                        |
//! | ------------------------ | -------------------------- | ------------------------------ |
//! | yes                      | yes                        | remove - the game's own answers |
//! | yes                      | no                         | refuse - nothing would answer   |
//! | no                       | either                     | remove - nobody asks            |
//!
//! Reference alone is the wrong axis. It says who asks, and only the install
//! says who can answer.

mod requests;

use ltk_hash::{Hash as _, WadHash};

use crate::problems::budget;
use crate::problems::game::GameContent;
use crate::problems::{
    Applied, Detail, FileHandle, FixError, FixPreview, FixRun, Problem, ProjectFiles, Report, Rule,
    RuleId, Severity, Site,
};
use crate::workshop::WorkshopFileKind;

use requests::BankRequests;

/// The suffix naming a layer directory that is one of the mod's WADs.
///
/// A file under one is a chunk the game addresses by hash, which is the only
/// shape this repair can reason about. Anything else - a `RAW/` entry, say -
/// reaches the game another way, and what would answer for it is a different
/// question.
const WAD_DIR_SUFFIX: &str = ".wad.client";

/// The diagnostics code a request nothing can answer is recorded under.
const UNANSWERED_CODE: &str = "ALE-9B39AA45";

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("audio/bank-version");

/// The version the game's reader takes as current.
///
/// Written down rather than read from the install. Reading it means walking
/// archives until a current bank turns up, to learn a number that moves twice a
/// year, and the predicate is one-sided precisely so that a stale value here
/// costs silence rather than noise.
const CURRENT_VERSION: u32 = 145;

/// The oldest version the reader will look at.
///
/// A property of the reader rather than of any patch, so this one does not
/// move.
const LEGACY_FLOOR: u32 = 118;

/// Bytes of a bank the check reads before falling back to the whole file.
///
/// Every bank of a 179-bank corpus resolves inside 2,684 of them. The shape
/// that does not is a hierarchy sitting behind a large media blob, which the
/// game ships and no mod yet does.
const HEAD_BYTES: usize = 8 * 1024;

/// A chunk id, as the four bytes the file holds.
type ChunkId = [u8; 4];

/// The chunk carrying the header, which the reader consumes before its loop.
const HEADER: ChunkId = *b"BKHD";

/// The media index and the media blob, the only two a legacy bank may carry.
const MEDIA: [ChunkId; 2] = [*b"DIDX", *b"DATA"];

/// Every chunk id the reader's own loop handles.
///
/// An id outside this is a bank the walk cannot account for, and a walk that
/// cannot account for a bank reports nothing rather than reporting wrongly.
const KNOWN: [ChunkId; 9] = [
    HEADER, *b"DIDX", *b"DATA", *b"HIRC", *b"STID", *b"STMG", *b"INIT", *b"ENVS", *b"PLAT",
];

/// An id and a length, which is what precedes every chunk body.
const CHUNK_HEADER: usize = 8;

/// Where the version sits, counted from the start of the bank.
///
/// The first field of the header chunk's body, which begins where that chunk's
/// own id and length end.
const VERSION_AT: usize = CHUNK_HEADER;

/// Reports an audio bank the game drops without saying so.
#[derive(Debug, Default)]
pub struct AudioBankVersion;

impl AudioBankVersion {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Rule for AudioBankVersion {
    fn id(&self) -> RuleId {
        ID
    }

    fn title(&self) -> &'static str {
        "Audio bank the game will not load"
    }

    fn description(&self) -> &'static str {
        "An audio bank at a format version the game's reader rejects. It is dropped without a message, so the mod is silent rather than broken"
    }

    fn unfixable_description(&self) -> &'static str {
        "Couldn't remove because something would still be asking for the file"
    }

    fn check(&self, project: &ProjectFiles, report: &mut Report) {
        let handles: Vec<_> = project.of_kind(WorkshopFileKind::WwiseBank).collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            /* The fallback holds the whole bank, and that is the read worth
            reserving for. */
            |handle| handle.size_bytes(),
            rejection_of,
        );

        let mut rejected = Vec::new();
        for (handle, found) in handles.iter().zip(read) {
            let site = || Site::file(handle.layer(), handle.path());
            match found {
                Some(Ok(Some(bank))) => rejected.push((handle, bank)),
                Some(Ok(None)) => {}
                Some(Err(e)) => report.failure(ID, Some(site()), e),
                /* Cancelled before this file was reached. Saying nothing about
                it is what keeps a partial run from reading as a clean one. */
                None => report.failure(ID, Some(site()), "The check was cancelled"),
            }
        }

        if rejected.is_empty() {
            return;
        }

        // Every bin of the mod, parsed a second time. Worth it only now that
        // there is something to ask about.
        let asked = BankRequests::of(project);
        for (handle, bank) in rejected {
            report.problem(
                ID,
                Severity::Warning,
                Site::file(handle.layer(), handle.path()),
                bank.detail(removable(handle, project.game(), &asked)),
            );
        }
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        // The mod as it is now, because the guard is a claim about the rest of
        // it and the rest of it may have changed since the check.
        let project = match ProjectFiles::read(run.project_root(), run.config(), run.game()) {
            Ok(project) => project,
            Err(e) => {
                tracing::warn!(
                    "Removing nothing from {}, which would not read: {e}",
                    run.project_root().display()
                );
                return Ok(skip_all(problems, run));
            }
        };
        let asked = BankRequests::of(&project);

        let mut applied = Applied::default();
        for problem in problems {
            let (layer, path) = (problem.site.layer.clone(), problem.site.path.clone());

            // Found in the tree before it is read, because a bank a previous
            // run already removed has no bytes to judge and is not an error.
            let handle = project
                .files()
                .find(|handle| handle.layer() == layer && handle.path() == path);
            let removes = match handle {
                Some(handle) if removable(&handle, project.game(), &asked).is_ok() => {
                    still_rejected(&run.read(&layer, &path)?)
                }
                _ => false,
            };
            if !removes {
                applied.skipped += 1;
                run.skipped(&layer, &path, 1);
                continue;
            }

            run.remove(&layer, &path, 1)?;
            applied.applied += 1;
        }

        Ok(applied)
    }
}

/// Record every problem as skipped, for a repair that cannot be derived at all.
fn skip_all(problems: &[&Problem], run: &mut FixRun<'_>) -> Applied {
    for problem in problems {
        run.skipped(&problem.site.layer, &problem.site.path, 1);
    }
    Applied {
        applied: 0,
        skipped: problems.len() as u32,
    }
}

/// Whether the bytes on disk are still a bank the reader refuses.
fn still_rejected(bytes: &[u8]) -> bool {
    let Some(version) = version_in(bytes) else {
        return false;
    };
    matches!(
        judged(version, bytes, bytes.len() as u64),
        Judged::Answered(Some(_))
    )
}

/// What would answer for this bank once it is gone, or why nothing would.
fn removable(
    handle: &FileHandle<'_>,
    game: Option<&dyn GameContent>,
    asked: &BankRequests,
) -> Result<Removed, String> {
    let Some(chunk) = chunk_hash(handle) else {
        return Err(String::from(
            "This file is not inside one of the mod's WADs, so the manager cannot tell what would answer for it once it is gone.",
        ));
    };

    let Some(game) = game else {
        return Err(String::from(
            "Removing this bank is only safe where the game holds one at the same path, and there is no League install configured to ask.",
        ));
    };

    if game.holds(chunk) {
        return Ok(Removed::GameAnswers);
    }
    if asked.asks_for(chunk) {
        return Err(format!(
            "A bank unit in this mod asks for this file and your game holds nothing at that path, so removing it would leave a request nothing can answer - the crash a log records as {UNANSWERED_CODE}.",
        ));
    }
    Ok(Removed::NobodyAsks)
}

/// What answers for a removed bank.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Removed {
    /// The install holds a bank at the same path.
    GameAnswers,
    /// No bank unit of the mod asks for the path at all.
    NobodyAsks,
}

impl Removed {
    /// What a row says the repair will do.
    fn note(self) -> &'static str {
        match self {
            Self::GameAnswers => {
                "Removed, and your game's own bank answers the request instead - so the mod's media still plays"
            }
            Self::NobodyAsks => "Removed. Nothing in the mod asks for this file",
        }
    }
}

/// The hash the WAD holding this file addresses it by.
///
/// `None` for a file that is not inside one of the mod's WADs, which is a file
/// no bank unit could be asking for by chunk path either.
fn chunk_hash(handle: &FileHandle<'_>) -> Option<WadHash> {
    if let Some(chunk) = handle.chunk() {
        return Some(chunk.hash);
    }

    let (wad, inside) = handle.path().split_once('/')?;
    if !wad.to_ascii_lowercase().ends_with(WAD_DIR_SUFFIX) {
        return None;
    }

    // An unpack writes a chunk no table named as the hex of its hash, which is
    // the hash itself rather than a path to hash.
    let relative = camino::Utf8Path::new(inside);
    if ltk_wad::is_hex_chunk_path(relative) {
        return relative
            .file_stem()
            .and_then(|hex| u64::from_str_radix(hex, 16).ok())
            .map(WadHash);
    }
    Some(WadHash::hash_str(inside))
}

/// What the reader will refuse about one bank, or `None` for one it loads.
///
/// # Errors
///
/// Reports a file it could not read, and one whose first bytes are not a bank
/// at all.
fn rejection_of(handle: &FileHandle<'_>) -> Result<Option<Rejected>, String> {
    let head = handle.head(HEAD_BYTES)?;
    let version = version_in(&head).ok_or_else(|| String::from("This is not an audio bank"))?;

    match judged(version, &head, handle.size_bytes()) {
        Judged::Answered(rejected) => Ok(rejected),
        /* The shape where the hierarchy sits behind a large media blob: the
        chunk list runs past the prefix, and only the bytes say what is there. */
        Judged::NeedsWholeFile => {
            // The bytes in hand are what the walk measures against now, where
            // the listing's recorded size was before.
            let whole = handle.bytes()?;
            Ok(match judged(version, &whole, whole.len() as u64) {
                Judged::Answered(rejected) => rejected,
                /* A chunk header straddling the last byte of the file, which
                is as unaccountable as a desync and answered the same way. */
                Judged::NeedsWholeFile => None,
            })
        }
    }
}

/// What `bytes` say about a bank of `size`, where `bytes` may be a prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Judged {
    Answered(Option<Rejected>),
    /// The chunk list runs past `bytes`.
    NeedsWholeFile,
}

fn judged(version: u32, bytes: &[u8], size: u64) -> Judged {
    if version >= CURRENT_VERSION {
        return Judged::Answered(None);
    }
    if version < LEGACY_FLOOR {
        return Judged::Answered(Some(Rejected {
            version,
            reason: Reason::BelowTheFloor,
        }));
    }

    match walked(bytes, size) {
        Walk::Chunks(ids) => {
            let carries_more = ids.iter().any(|id| *id != HEADER && !MEDIA.contains(id));
            Judged::Answered(carries_more.then_some(Rejected {
                version,
                reason: Reason::ContentAtAnOlderVersion,
            }))
        }
        Walk::NeedsMore => Judged::NeedsWholeFile,
        Walk::Desynced => Judged::Answered(None),
    }
}

/// The generator version, or `None` where these are not a bank's first bytes.
fn version_in(bytes: &[u8]) -> Option<u32> {
    if bytes.get(..4)? != HEADER {
        return None;
    }
    let version = bytes.get(VERSION_AT..VERSION_AT + 4)?;
    Some(u32::from_le_bytes(version.try_into().ok()?))
}

/// How far a walk of the chunk list got.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Walk {
    /// Every chunk accounted for, from the first byte to the last.
    Chunks(Vec<ChunkId>),
    /// The next chunk header sits past what was read.
    NeedsMore,
    /// A chunk id the reader's loop does not handle, or a length past the end.
    Desynced,
}

/// Walk the chunk list of a bank of `size`, over as much of it as `bytes` hold.
///
/// Bodies are stepped over rather than read, so a bank whose last chunk ends
/// the file is accounted for without ever holding that chunk - which is what
/// keeps a media bank of tens of megabytes to a read of its first bytes.
///
/// Chunks are not always contiguous in the wild and a chunk header does not
/// always land on a four-byte boundary. The reader tolerates that and this walk
/// does not, so a bank it cannot account for is one the rule says nothing
/// about.
fn walked(bytes: &[u8], size: u64) -> Walk {
    let mut ids = Vec::new();
    let mut at = 0u64;

    loop {
        if at == size {
            return Walk::Chunks(ids);
        }

        let Some(header) = bytes
            .get(at as usize..)
            .and_then(|rest| rest.get(..CHUNK_HEADER))
        else {
            return Walk::NeedsMore;
        };

        let id: ChunkId = header[..4]
            .try_into()
            .expect("four bytes of a chunk header");
        let length = u32::from_le_bytes(header[4..].try_into().expect("four more"));
        let end = at + CHUNK_HEADER as u64 + u64::from(length);
        if !KNOWN.contains(&id) || end > size {
            return Walk::Desynced;
        }

        ids.push(id);
        at = end;
    }
}

/// A bank the game's reader will not load, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rejected {
    version: u32,
    reason: Reason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reason {
    /// Older than the reader will read at all.
    BelowTheFloor,
    /// An older version, carrying more than the reader takes at one.
    ContentAtAnOlderVersion,
}

impl Rejected {
    /// What this one finding says, and what removing the bank would leave.
    fn detail(&self, removal: Result<Removed, String>) -> Detail {
        let mut message = self.sentence();
        match removal {
            Ok(removed) => Detail {
                mismatch: None,
                message: Some(message),
                fix: Some(FixPreview::note(removed.note())),
            },
            Err(why) => {
                message.push(' ');
                message.push_str(&why);
                Detail::new(message)
            }
        }
    }

    /// Why the reader refuses this bank, in one sentence.
    fn sentence(&self) -> String {
        match self.reason {
            Reason::BelowTheFloor => format!(
                "Version {} is older than the game's audio reader will read at all, so it drops the bank without a message and nothing in it plays.",
                self.version
            ),
            Reason::ContentAtAnOlderVersion => format!(
                "The game's audio reader takes a bank at version {} only if it carries nothing but its media. This one carries its events and sounds too, so the reader drops the whole bank without a message and the mod is silent.",
                self.version
            ),
        }
    }
}

#[cfg(test)]
mod tests;
