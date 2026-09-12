//! One `.skl` as the joint buffer a viewport builds its skeleton from.
//!
//! Transforms keep the file's own space and units, which is the space `mesh.rs` leaves a
//! `.skn` in, so the skeleton poses the mesh where it lies.
//!
//! # The buffer
//!
//! Little-endian throughout, with no padding between blocks.
//!
//! ```text
//! magic          u32   0x534B544C, `LTKS`
//! version        u32   1
//! jointCount     u32
//! influenceCount u32
//! joints         jointCount * {
//!                  nameLen u32, name utf8[nameLen], hash u32, parent i32,
//!                  translation f32 * 3, rotation f32 * 4, scale f32 * 3,
//!                  inverseBind f32 * 16
//!                }
//! influences     u32 * influenceCount
//! ```
//!
//! `hash` is the ELF hash of the lowercased name, which is what an `.anm` names a track
//! by. `parent` is a slot of the joint block, and `-1` for a root. The local transform is
//! translation, the rotation as `x y z w`, then scale, and `inverseBind` is column-major.
//! An influence is the joint slot a shader joint names, which is what a mesh's skin index
//! points into.

use std::collections::HashMap;
use std::io::Cursor;

use ltk_anim::{Joint, RigResource};
use ltk_file::LeagueFileKind;

use super::{PreviewError, count_of};

/// The word a joint buffer opens with, `LTKS` in the order the buffer is written in.
const MAGIC: u32 = 0x534B_544C;

/// The layout this module writes.
const VERSION: u32 = 1;

/// Read a skeleton into the buffer a viewport builds its skeleton from.
///
/// # Errors
///
/// Fails with [`PreviewError::Unsupported`] for bytes that are no skeleton, with
/// [`PreviewError::SkeletonRead`] where the file does not parse, and with
/// [`PreviewError::SkeletonOutOfBounds`] where a parent or an influence names a joint the
/// file does not hold.
pub fn render(bytes: &[u8]) -> Result<Vec<u8>, PreviewError> {
    match LeagueFileKind::identify_from_bytes(bytes) {
        LeagueFileKind::Skeleton => encode(&RigResource::from_reader(&mut Cursor::new(bytes))?),
        kind => Err(PreviewError::Unsupported(kind)),
    }
}

/// The rig as the buffer this module documents.
fn encode(rig: &RigResource) -> Result<Vec<u8>, PreviewError> {
    let joints = rig.joints();
    /* A parent and an influence name a joint by its id, where the buffer names a slot. */
    let slots: HashMap<i16, usize> = joints
        .iter()
        .enumerate()
        .map(|(slot, joint)| (joint.id(), slot))
        .collect();
    let slot_of = |id: i16| {
        slots
            .get(&id)
            .copied()
            .ok_or(PreviewError::SkeletonOutOfBounds)
    };

    let mut buffer = Vec::new();
    for word in [
        MAGIC,
        VERSION,
        count_of(joints.len())?,
        count_of(rig.influences().len())?,
    ] {
        buffer.extend(word.to_le_bytes());
    }
    for joint in joints {
        let parent = match joint.parent_id() {
            id if id < 0 => -1,
            id => i32::try_from(slot_of(id)?).map_err(|_| PreviewError::BufferTooLarge)?,
        };
        write_joint(&mut buffer, joint, parent)?;
    }
    for &influence in rig.influences() {
        buffer.extend(count_of(slot_of(influence)?)?.to_le_bytes());
    }

    Ok(buffer)
}

/// One joint's record, onto `buffer`.
fn write_joint(buffer: &mut Vec<u8>, joint: &Joint, parent: i32) -> Result<(), PreviewError> {
    let name = joint.name();
    buffer.extend(count_of(name.len())?.to_le_bytes());
    buffer.extend(name.as_bytes());
    buffer.extend(track_hash(name).to_le_bytes());
    buffer.extend(parent.to_le_bytes());

    let floats = joint
        .local_translation()
        .to_array()
        .into_iter()
        .chain(joint.local_rotation().to_array())
        .chain(joint.local_scale().to_array())
        .chain(joint.inverse_bind_transform().to_cols_array());
    for value in floats {
        buffer.extend(value.to_le_bytes());
    }

    Ok(())
}

/// The hash an `.anm` names `name`'s track by: ELF over the lowercased name.
fn track_hash(name: &str) -> u32 {
    let hash = ltk_hash::elf::elf(name.to_ascii_lowercase());
    u32::try_from(hash).expect("an ELF hash clears its top four bits after every byte")
}

#[cfg(test)]
mod tests;
