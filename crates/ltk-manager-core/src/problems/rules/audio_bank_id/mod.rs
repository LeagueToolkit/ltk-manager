//! `audio/bank-id` - a Wwise bank carrying no soundbank id.
//!
//! A bank's header carries an id, and the Wwise toolchain derives it from the
//! bank's own name when it builds one. A bank carrying zero was written by
//! something that never assigned one.
//!
//! **The name survives an unpack in the bin that asks for the bank.** A chunk
//! no hashtable named is written out as the hex of its own hash, and hashing
//! that would write an id belonging to nothing. A bank unit lists the bank's
//! path in plaintext, so that is what resolves the hash back - and a bank no
//! unit lists is one the game never asks for and so never loads.
//!
//! **The id is the signal, and the version is not.** Across 7,829 shipped
//! banks the versions run 125 through 145, so a version check would report the
//! game's own content. Zero is the value the game never ships.
//!
//! **What it costs is not established, so this reports at `Info`.**

use crate::problems::bank_units::BankUnits;
use crate::problems::{
    Applied, Detail, FileHandle, FixError, FixPreview, FixRun, Pass, Problem, ProblemSeverity,
    Rule, RuleId, RuleMeta, Site,
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

/// The offset basis of the 32-bit FNV hash.
const FNV_BASIS: u32 = 0x811C_9DC5;

/// The prime of the 32-bit FNV hash.
const FNV_PRIME: u32 = 0x0100_0193;

/// Reports a Wwise bank carrying no soundbank id.
#[derive(Debug, Default)]
pub struct AudioBankId;

impl AudioBankId {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// The rule as the catalogue lists it.
const META: RuleMeta = RuleMeta {
    id: ID,
    title: "Unset soundbank id",
    description: "The audio bank has no id",
    unfixable: "Couldn't derive an id because the bank's intended name is unknown",
    severity: Some(ProblemSeverity::Info),
};

impl Rule for AudioBankId {
    fn meta(&self) -> &RuleMeta {
        &META
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let ids = pass
            .files(WorkshopFileKind::WwiseBank)
            .head(HEADER_BYTES)
            .collect(|head| bank_id_in(head.bytes()));
        let units = pass.demand::<BankUnits>();
        pass.finish(move |finish| {
            let units = finish.fact(units);
            for (handle, id) in finish.take(ids) {
                if id != Some(0) {
                    continue;
                }
                let detail = detail(&handle, units);
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file(handle.layer(), handle.path()),
                    detail,
                );
            }
        });
    }

    /// Writes the id the bank's own name hashes to.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        // The mod as the run has left it, because a bank unit naming a
        // hash-named chunk is a fact about the rest of it and the rest of it
        // may have changed.
        let units = run.fact::<BankUnits>().unwrap_or_default();

        run.per_file(problems, |run, layer, path| {
            let id = run
                .project()
                .ok()
                .and_then(|project| bank_id_for(&project.file(layer, path)?, &units));
            let Some(id) = id else {
                return Ok(false);
            };

            let mut bytes = run.read(layer, path)?;
            // Re-read from the file rather than trusted from the check, so a
            // bank rebuilt since the run keeps the id its builder gave it.
            if !carries_no_id(&bytes) {
                return Ok(false);
            }

            bytes[BANK_ID_AT..BANK_ID_AT + 4].copy_from_slice(&id.to_le_bytes());
            run.write(layer, path, &bytes, 1, 0)?;
            Ok(true)
        })
    }
}

/// The soundbank id in one bank's header, `head` being its first bytes.
///
/// `None` for a bank whose header is shorter than the field, which is a file
/// the rule says nothing about rather than one it reports.
///
/// # Errors
///
/// Reports a file whose first bytes are not a bank at all.
fn bank_id_in(head: &[u8]) -> Result<Option<u32>, String> {
    if head.first_chunk::<4>() != Some(&HEADER) {
        return Err(String::from("This is not an audio bank"));
    }

    Ok(head
        .get(BANK_ID_AT..BANK_ID_AT + 4)
        .and_then(|id| id.try_into().ok())
        .map(u32::from_le_bytes))
}

/// Whether `bytes` is still a bank whose header carries no id.
fn carries_no_id(bytes: &[u8]) -> bool {
    bytes.first_chunk::<4>() == Some(&HEADER)
        && bytes
            .get(BANK_ID_AT..BANK_ID_AT + 4)
            .and_then(|id| id.try_into().ok())
            .map(u32::from_le_bytes)
            == Some(0)
}

/// The id the engine will address `handle`'s bank by.
///
/// An unpack names a chunk by the hash of its path, and hashing 16 hex digits
/// would write an id belonging to nothing. A bank unit names the file in
/// plaintext, so that hash resolves back to the path its author wrote.
///
/// `None` where no unit names it either, which is a bank the game never asks
/// for and so never loads.
fn bank_id_for(handle: &FileHandle<'_>, units: &BankUnits) -> Option<u32> {
    if let Some(stem) = named_stem(handle.path()) {
        return Some(bank_id_of_name(stem));
    }
    let named = units.path_of(handle.wad_hash()?)?;
    named_stem(named).map(bank_id_of_name)
}

/// The bank's own name in `path`, without its extension.
///
/// `None` where the last segment is a WAD chunk hash rather than a name, which
/// is what an unpack leaves behind for a path no hashtable resolved.
fn named_stem(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next()?;
    let stem = name.rsplit_once('.').map_or(name, |(before, _)| before);
    (!stem.is_empty() && !is_hash_named(stem)).then_some(stem)
}

/// Whether `stem` is a WAD chunk hash written as hex rather than a bank name.
fn is_hash_named(stem: &str) -> bool {
    stem.len() == 16 && stem.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `FNV-1` over the ASCII-lowercased bytes of `name`.
///
/// This is FNV-1 and not FNV-1a: the multiply comes first and the xor second,
/// and swapping them gives an unrelated value.
fn bank_id_of_name(name: &str) -> u32 {
    name.bytes().fold(FNV_BASIS, |hash, byte| {
        hash.wrapping_mul(FNV_PRIME) ^ u32::from(byte.to_ascii_lowercase())
    })
}

/// What one finding says, and what the repair would write into it.
fn detail(handle: &FileHandle<'_>, units: &BankUnits) -> Detail {
    let message = String::from(
        "The header holds zero where the format wants FNV-1 of the bank's own name. Nothing is known to read the field, and the repair writes the value that name hashes to.",
    );

    match bank_id_for(handle, units) {
        Some(id) => Detail {
            mismatch: None,
            message: Some(message),
            fix: Some(FixPreview::value("0", format!("{id:#010X}"))),
        },
        None => Detail::new(message),
    }
}

#[cfg(test)]
mod tests;
