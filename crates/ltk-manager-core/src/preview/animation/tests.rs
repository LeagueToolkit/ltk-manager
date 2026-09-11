use std::collections::HashMap;
use std::io::Cursor;

use glam::{Quat, Vec3, vec3};
use ltk_anim::Uncompressed;
use ltk_anim::asset::UncompressedFrame;

use super::*;

/// A pose buffer read back, so a round trip has two sides.
#[derive(Debug)]
struct Decoded {
    version: u32,
    fps: f32,
    frames: usize,
    joints: Vec<u32>,
    /// `frames * joints.len() * 10`.
    poses: Vec<f32>,
}

impl Decoded {
    /// The ten floats of `joint`'s pose at `frame`.
    fn pose(&self, frame: usize, joint: usize) -> &[f32] {
        let at = (frame * self.joints.len() + joint) * POSE_FLOATS;
        &self.poses[at..at + POSE_FLOATS]
    }
}

/// Reads the buffer [`render`] writes, off the layout the module documents.
///
/// Hand-written rather than shared with the encoder, so that the two can disagree.
fn decode(buffer: &[u8]) -> Decoded {
    let words: Vec<u32> = buffer
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| u32::from_le_bytes(*word))
        .collect();
    assert_eq!(buffer.len() % 4, 0, "every block is words");

    assert_eq!(words[0], MAGIC, "the buffer opens with LTKA");
    let frames = words[3] as usize;
    let joint_count = words[4] as usize;
    let joints = words[5..5 + joint_count].to_vec();
    let poses: Vec<f32> = words[5 + joint_count..]
        .iter()
        .map(|word| f32::from_bits(*word))
        .collect();

    assert_eq!(
        poses.len(),
        frames * joint_count * POSE_FLOATS,
        "the buffer ends where the layout does"
    );

    Decoded {
        version: words[1],
        fps: f32::from_bits(words[2]),
        frames,
        joints,
        poses,
    }
}

/// Two joints over three frames at 30 fps: `0x20` walks along a line and `0x10` holds
/// still under a half turn about `Y`.
fn clip() -> Vec<u8> {
    let turned = Quat::from_rotation_y(std::f32::consts::PI);
    let frame = |translation_id, rotation_id| UncompressedFrame {
        translation_id,
        scale_id: 3,
        rotation_id,
    };

    let mut joint_frames = HashMap::new();
    joint_frames.insert(0x20, vec![frame(0, 0), frame(1, 0), frame(2, 0)]);
    joint_frames.insert(0x10, vec![frame(4, 1), frame(4, 1), frame(4, 1)]);

    let animation = Uncompressed::new(
        30.0,
        vec![
            Vec3::ZERO,
            vec3(1.0, 2.0, 3.0),
            vec3(2.0, 4.0, 6.0),
            Vec3::ONE,
            vec3(0.0, 5.0, 0.0),
        ],
        vec![Quat::IDENTITY, turned],
        joint_frames,
    );

    let mut out = Cursor::new(Vec::new());
    animation.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn close(left: &[f32], right: &[f32]) -> bool {
    /* The writer quantizes a rotation to 15 bits a component. */
    left.len() == right.len() && left.iter().zip(right).all(|(a, b)| (a - b).abs() < 1e-3)
}

#[test]
fn a_clip_bakes_one_frame_per_step_of_its_rate_and_one_for_its_end() {
    let decoded = decode(&render(&clip()).unwrap());

    assert_eq!(decoded.version, VERSION);
    assert!((decoded.fps - 30.0).abs() < 1e-3, "{}", decoded.fps);
    assert_eq!(
        decoded.frames, 4,
        "three frames last a tenth of a second, and its end is a fourth sample"
    );
}

/// A joint's place in the table is its place in the hash list, so the viewport finds a
/// track by the hash the skeleton gives it.
#[test]
fn joints_are_listed_by_hash() {
    let decoded = decode(&render(&clip()).unwrap());

    assert_eq!(decoded.joints, vec![0x10, 0x20]);
}

#[test]
fn a_pose_is_translation_rotation_then_scale() {
    let decoded = decode(&render(&clip()).unwrap());
    let turned = Quat::from_rotation_y(std::f32::consts::PI).to_array();

    let walking = decoded.pose(1, 1);
    assert!(close(&walking[0..3], &[1.0, 2.0, 3.0]), "{walking:?}");
    assert!(close(&walking[3..7], &[0.0, 0.0, 0.0, 1.0]), "{walking:?}");
    assert!(close(&walking[7..10], &[1.0, 1.0, 1.0]), "{walking:?}");

    let still = decoded.pose(2, 0);
    assert!(close(&still[0..3], &[0.0, 5.0, 0.0]), "{still:?}");
    let dot: f32 = still[3..7].iter().zip(turned).map(|(a, b)| a * b).sum();
    assert!(
        (dot.abs() - 1.0).abs() < 1e-3,
        "a half turn either way round: {still:?}"
    );
}

#[test]
fn the_last_frame_is_the_clip_at_its_end() {
    let decoded = decode(&render(&clip()).unwrap());

    assert!(close(&decoded.pose(3, 1)[0..3], &[2.0, 4.0, 6.0]));
}

#[test]
fn a_length_or_rate_that_is_no_number_of_frames_is_refused() {
    for (duration, fps) in [
        (1.0, 0.0),
        (1.0, -30.0),
        (-1.0, 30.0),
        (f32::NAN, 30.0),
        (1.0, f32::INFINITY),
    ] {
        assert!(
            matches!(
                frame_count(duration, fps),
                Err(PreviewError::AnimationTiming)
            ),
            "{duration} s at {fps} fps"
        );
    }
}

#[test]
fn a_clip_longer_than_one_buffer_bakes_is_refused() {
    assert!(matches!(
        frame_count(1.0e9, 30.0),
        Err(PreviewError::AnimationTooLong)
    ));
    assert_eq!(
        frame_count(0.0, 30.0).unwrap(),
        1,
        "a still clip is one frame"
    );
}

#[test]
fn bytes_that_are_no_animation_are_unsupported() {
    let err = render(b"PROP\x00\x00\x00\x00").unwrap_err();

    assert!(
        matches!(err, PreviewError::Unsupported(_)),
        "unexpected error: {err}"
    );
}

#[test]
fn a_half_written_animation_is_reported_and_not_a_panic() {
    let whole = clip();

    let err = render(&whole[..whole.len() / 2]).unwrap_err();

    assert!(
        matches!(err, PreviewError::AnimationRead(_)),
        "unexpected error: {err}"
    );
}
