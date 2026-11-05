//! Repairs the hashtables a fantome declares before an import reads them.

use fs_err as fs;
use ltk_fantome::{FantomeHashtable, FantomeReader};
use ltk_hashtable::Hashtable;
use ltk_manager_base::error::{AppError, AppResult};
use std::collections::{HashMap, HashSet};
use std::io::{BufReader, Read, Seek, Write};
use std::path::Path;
use zip::ZipArchive;

const INFO_ENTRY: &str = "META/info.json";
const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";

/// Why a hashtable declaration was dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dropped {
    /// The archive does not contain the declared file.
    Absent,
    /// The declared file at the zip `index` is not a valid hashtable.
    Unreadable { index: usize },
}

/// Writes a copy of the fantome at `source` into `temp_dir` whose declared hashtables every
/// reader accepts.
///
/// Drops each manifest declaration whose table file is absent, drops each declaration and
/// file that is not a valid hashtable, and removes a UTF-8 byte order mark from each table
/// that remains. Every other entry is copied raw. Returns `None` if the archive needs no
/// repair.
///
/// # Errors
///
/// Fails if the archive or its manifest cannot be read, or the copy cannot be written.
pub fn repair_declared_hashtables(
    source: &Path,
    temp_dir: &Path,
) -> AppResult<Option<tempfile::NamedTempFile>> {
    let mut reader = FantomeReader::new(BufReader::new(fs::File::open(source)?))?;
    let mut info = reader.read_info()?;
    drop(reader);

    let mut archive = ZipArchive::new(BufReader::new(fs::File::open(source)?))?;
    let mut replacements = HashMap::new();
    let mut removed = HashSet::new();
    let mut any_dropped = false;
    let declared = std::mem::take(&mut info.hashtables);

    for table in declared {
        match inspect(&mut archive, &table)? {
            Inspection::Keep => info.hashtables.push(table),
            Inspection::StripBom { index, content } => {
                replacements.insert(index, content);
                info.hashtables.push(table);
            }
            Inspection::Drop(reason) => {
                tracing::warn!(
                    archive = %source.display(),
                    table = %table.path,
                    ?reason,
                    "Dropped a hashtable declaration from the imported archive"
                );
                any_dropped = true;

                if let Dropped::Unreadable { index } = reason {
                    removed.insert(index);
                }
            }
        }
    }

    if any_dropped {
        let info_index = (0..archive.len()).find(|&index| {
            archive
                .name_for_index(index)
                .is_some_and(|name| name.eq_ignore_ascii_case(INFO_ENTRY))
        });
        let manifest = serde_json::to_vec_pretty(&info)
            .map_err(|e| AppError::Other(format!("Failed to write {INFO_ENTRY}: {e}")))?;

        if let Some(index) = info_index {
            replacements.insert(index, manifest);
        }
    }

    if replacements.is_empty() && removed.is_empty() {
        return Ok(None);
    }

    let mut repaired = tempfile::NamedTempFile::new_in(temp_dir)?;
    let mut writer = zip::ZipWriter::new(repaired.as_file_mut());
    writer.set_raw_comment(archive.comment().into());

    for index in 0..archive.len() {
        if removed.contains(&index) {
            continue;
        }

        let entry = archive.by_index_raw(index)?;
        if let Some(content) = replacements.get(&index) {
            writer.start_file(entry.name(), entry.options())?;
            writer.write_all(content)?;
        } else {
            writer.raw_copy_file(entry)?;
        }
    }

    writer.finish()?;
    Ok(Some(repaired))
}

/// What an import does with one declared hashtable.
enum Inspection {
    Keep,
    StripBom { index: usize, content: Vec<u8> },
    Drop(Dropped),
}

/// Reads the table `table` declares and decides whether the import keeps it.
fn inspect<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    table: &FantomeHashtable,
) -> AppResult<Inspection> {
    if table.to_entry().is_none() {
        return Ok(Inspection::Keep);
    }

    let index = (0..archive.len()).find(|&index| {
        archive
            .name_for_index(index)
            .is_some_and(|name| name.eq_ignore_ascii_case(&table.path))
    });
    let Some(index) = index else {
        return Ok(Inspection::Drop(Dropped::Absent));
    };

    let mut content = Vec::new();
    archive.by_index(index)?.read_to_end(&mut content)?;

    let body = content.strip_prefix(UTF8_BOM);
    if Hashtable::from_reader(body.unwrap_or(&content)).is_err() {
        return Ok(Inspection::Drop(Dropped::Unreadable { index }));
    }

    match body {
        Some(body) => Ok(Inspection::StripBom {
            index,
            content: body.to_vec(),
        }),
        None => Ok(Inspection::Keep),
    }
}

#[cfg(test)]
mod tests;
