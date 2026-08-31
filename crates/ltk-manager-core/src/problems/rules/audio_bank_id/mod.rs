//! `audio/bank-id` - a Wwise bank carrying no soundbank id.
//!
//! A bank's header carries the id the runtime addresses it by, and the Wwise
//! toolchain derives that id from the bank's name when it builds one. A bank
//! carrying zero was written by something that never assigned one.
//!
//! **The id is the signal, and the version is not.** A census of the shipped
//! game read the header of 7,829 banks: not one carries an unset id, and the
//! versions run 125 through 145, so a rule keyed on the version would report
//! the game's own content. Zero is the value the game never ships.
//!
//! What the runtime does with it is not claimed. What the two measured
//! specimens have in common is a rebuilt SFX media bank at a real game path and
//! audio that does not play, and whether the runtime also faults is inference.
//!
//! There is no repair. The id is the toolchain's to assign, and inventing one
//! would give the bank an identity nothing in the mod refers to - so the whole
//! of the finding is that the bank has to be built again.

use crate::problems::budget;
use crate::problems::{
    Applied, Detail, FileHandle, FixError, FixRun, Problem, ProjectFiles, Report, Rule, RuleId,
    Severity, Site,
};
use crate::workshop::WorkshopFileKind;

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("audio/bank-id");

/// The four bytes a bank opens with, naming its header chunk.
const HEADER: [u8; 4] = *b"BKHD";

/// The header, magic through soundbank id, which is all the check reads.
const HEADER_BYTES: usize = 16;

/// Where the soundbank id sits, counted from the start of the bank.
///
/// The header chunk's own id and length come first, then the generator version,
/// then this.
const BANK_ID_AT: usize = 12;

/// Reports a Wwise bank nothing can address.
#[derive(Debug, Default)]
pub struct AudioBankId;

impl AudioBankId {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Rule for AudioBankId {
    fn id(&self) -> RuleId {
        ID
    }

    fn title(&self) -> &'static str {
        "Audio bank with no id of its own"
    }

    fn description(&self) -> &'static str {
        "An audio bank whose header carries no soundbank id. The tool that builds a bank assigns one, so a bank without it was written by something that did not, and nothing can ask for it by name"
    }

    fn unfixable_description(&self) -> &'static str {
        "Couldn't set an id because only the tool that builds a bank assigns one"
    }

    fn check(&self, project: &ProjectFiles, report: &mut Report) {
        let handles: Vec<_> = project.of_kind(WorkshopFileKind::WwiseBank).collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            |_| HEADER_BYTES as u64,
            bank_id_of,
        );

        for (handle, found) in handles.iter().zip(read) {
            let site = || Site::file(handle.layer(), handle.path());
            match found {
                Some(Ok(Some(0))) => report.problem(ID, Severity::Error, site(), detail()),
                Some(Ok(_)) => {}
                Some(Err(e)) => report.failure(ID, Some(site()), e),
                /* Cancelled before this file was reached. Saying nothing about
                it is what keeps a partial run from reading as a clean one. */
                None => report.failure(ID, Some(site()), "The check was cancelled"),
            }
        }
    }

    /// Records every problem as skipped.
    ///
    /// The rule derives no repair, so a caller reaches this only by naming a
    /// finding that never offered one.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        for problem in problems {
            run.skipped(&problem.site.layer, &problem.site.path, 1);
        }
        Ok(Applied {
            applied: 0,
            skipped: problems.len() as u32,
        })
    }
}

/// The soundbank id in one bank's header.
///
/// `None` for a bank whose header is shorter than the field, which is a file
/// the rule says nothing about rather than one it reports.
///
/// # Errors
///
/// Reports a file it could not read, and one whose first bytes are not a bank
/// at all.
fn bank_id_of(handle: &FileHandle<'_>) -> Result<Option<u32>, String> {
    let head = handle.head(HEADER_BYTES)?;
    if head.first_chunk::<4>() != Some(&HEADER) {
        return Err(String::from("This is not an audio bank"));
    }

    Ok(head
        .get(BANK_ID_AT..BANK_ID_AT + 4)
        .and_then(|id| id.try_into().ok())
        .map(u32::from_le_bytes))
}

/// What every one of this rule's findings says.
///
/// The same sentence on each of them, because an unset id is one state and
/// there is nothing about a given bank that changes what to do about it.
fn detail() -> Detail {
    Detail::new(
        "Every bank the game ships carries an id, and this one carries none, so nothing can ask for it by name and the sounds in it never play. The id is stamped in when a bank is built, so this has to be exported from Wwise again rather than edited.",
    )
}

#[cfg(test)]
mod tests;
