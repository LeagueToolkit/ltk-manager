//! One `.anm` baked into the pose table a viewport samples.
//!
//! `ltk_anim` evaluates the clip once per frame at the clip's own rate and the viewport
//! interpolates between two frames, so a pose is a function of time and a seek is a
//! sample, per decision 2.6 of docs/plans/vfx-particle-renderer.md.
//!
//! A compressed clip's opening keys come out wrong until `ltk_anim` reads its jump caches,
//! LeagueToolkit/league-toolkit#235.
//!
//! # The buffer
//!
//! Little-endian throughout, with no padding between blocks.
//!
//! ```text
//! magic       u32   0x414B544C, `LTKA`
//! version     u32   1
//! fps         f32
//! frameCount  u32
//! jointCount  u32
//! jointHashes u32 * jointCount
//! poses       f32 * frameCount * jointCount * 10
//! ```
//!
//! Frame `i` is the clip at `i / fps` seconds, and the last frame is its end. A frame
//! holds one pose per joint in `jointHashes` order: translation, the rotation as
//! `x y z w`, then scale, each in the joint's parent space. A joint hash is what the
//! skeleton buffer keys a joint by.

use std::collections::HashMap;
use std::io::Cursor;

use glam::{Quat, Vec3};
use ltk_anim::{Animation as _, AnimationAsset};
use ltk_file::LeagueFileKind;

use super::{PreviewError, count_of};

/// The word a pose buffer opens with, `LTKA` in the order the buffer is written in.
const MAGIC: u32 = 0x414B_544C;

/// The layout this module writes.
const VERSION: u32 = 1;

/// The floats one joint's pose takes: translation, rotation, scale.
const POSE_FLOATS: usize = 10;

/// The most joint poses one clip bakes to, about 80 MB of floats.
///
/// A twenty-second clip on a 120-joint rig at 30 fps is 72,000 poses, so this refuses only
/// a header no shipped clip was written with.
const MAX_POSES: usize = 1 << 21;

/// Read an animation and bake it into the buffer a viewport samples.
///
/// # Errors
///
/// Fails with [`PreviewError::Unsupported`] for bytes that are no animation, with
/// [`PreviewError::AnimationRead`] where the file does not parse, with
/// [`PreviewError::AnimationTiming`] where its length or rate is no number of frames, and
/// with [`PreviewError::AnimationTooLong`] where it bakes to more poses than one buffer
/// holds.
pub fn render(bytes: &[u8]) -> Result<Vec<u8>, PreviewError> {
    let clip = match LeagueFileKind::identify_from_bytes(bytes) {
        LeagueFileKind::Animation => AnimationAsset::from_reader(&mut Cursor::new(bytes))?,
        kind => return Err(PreviewError::Unsupported(kind)),
    };

    let fps = clip.fps();
    let frames = frame_count(clip.duration(), fps)?;
    let mut joints = clip.joints().into_owned();
    joints.sort_unstable();
    joints.dedup();

    let poses = usize::try_from(frames)
        .ok()
        .and_then(|frames| frames.checked_mul(joints.len()))
        .filter(|poses| *poses <= MAX_POSES)
        .ok_or(PreviewError::AnimationTooLong)?;

    let mut buffer = Vec::with_capacity(4 * (5 + joints.len() + poses * POSE_FLOATS));
    for word in [MAGIC, VERSION] {
        buffer.extend(word.to_le_bytes());
    }
    buffer.extend(fps.to_le_bytes());
    for word in [frames, count_of(joints.len())?] {
        buffer.extend(word.to_le_bytes());
    }
    for hash in &joints {
        buffer.extend(hash.to_le_bytes());
    }

    let time = |frame: u32| frame as f32 / fps;
    match &clip {
        /* One evaluator walks the frames once, where a fresh one per frame would seek from
        a jump cache every time. */
        AnimationAsset::Compressed(compressed) => {
            let mut evaluator = compressed.evaluator();
            for frame in 0..frames {
                write_poses(&mut buffer, &joints, &evaluator.evaluate(time(frame)));
            }
        }
        AnimationAsset::Uncompressed(uncompressed) => {
            for frame in 0..frames {
                write_poses(&mut buffer, &joints, &uncompressed.evaluate(time(frame)));
            }
        }
    }

    Ok(buffer)
}

/// How many frames `duration` seconds at `fps` bake to, the first and the last included.
///
/// # Errors
///
/// Fails with [`PreviewError::AnimationTiming`] where either is not a finite, non-negative
/// number and the rate is not above zero, and with [`PreviewError::AnimationTooLong`] past
/// [`MAX_POSES`] frames.
fn frame_count(duration: f32, fps: f32) -> Result<u32, PreviewError> {
    if !(duration.is_finite() && duration >= 0.0 && fps.is_finite() && fps > 0.0) {
        return Err(PreviewError::AnimationTiming);
    }

    let last = (duration * fps).round();
    if !last.is_finite() || last >= MAX_POSES as f32 {
        return Err(PreviewError::AnimationTooLong);
    }
    Ok(last as u32 + 1)
}

/// One frame's poses, in `joints` order, onto `buffer`.
///
/// A joint the evaluator leaves out holds the identity, which a palette index past the
/// palette is the one cause of.
fn write_poses(buffer: &mut Vec<u8>, joints: &[u32], poses: &HashMap<u32, (Quat, Vec3, Vec3)>) {
    for joint in joints {
        let (rotation, translation, scale) =
            poses
                .get(joint)
                .copied()
                .unwrap_or((Quat::IDENTITY, Vec3::ZERO, Vec3::ONE));
        let floats = translation
            .to_array()
            .into_iter()
            .chain(rotation.to_array())
            .chain(scale.to_array());
        for value in floats {
            buffer.extend(value.to_le_bytes());
        }
    }
}

#[cfg(test)]
mod tests;
