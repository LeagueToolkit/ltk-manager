use std::io::Cursor;

use glam::{Mat4, Quat, vec3};

use super::*;

/// One joint read back out of a buffer.
#[derive(Debug)]
struct DecodedJoint {
    name: String,
    hash: u32,
    parent: i32,
    translation: [f32; 3],
    rotation: [f32; 4],
    scale: [f32; 3],
    inverse_bind: [f32; 16],
}

/// A joint buffer read back, so a round trip has two sides.
#[derive(Debug)]
struct Decoded {
    version: u32,
    joints: Vec<DecodedJoint>,
    influences: Vec<u32>,
}

/// A position in a joint buffer, for the decoder to walk.
struct Reader<'a> {
    buffer: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn word(&mut self) -> u32 {
        let value = u32::from_le_bytes(self.buffer[self.at..self.at + 4].try_into().unwrap());
        self.at += 4;
        value
    }

    fn text(&mut self) -> String {
        let length = self.word() as usize;
        let text = String::from_utf8(self.buffer[self.at..self.at + length].to_vec()).unwrap();
        self.at += length;
        text
    }
}

/// Reads the buffer [`render`] writes, off the layout the module documents.
///
/// Hand-written rather than shared with the encoder, so that the two can disagree.
fn decode(buffer: &[u8]) -> Decoded {
    let mut reader = Reader { buffer, at: 0 };

    assert_eq!(reader.word(), MAGIC, "the buffer opens with LTKS");
    let version = reader.word();
    let joint_count = reader.word() as usize;
    let influence_count = reader.word() as usize;

    let mut joints = Vec::with_capacity(joint_count);
    for _ in 0..joint_count {
        let name = reader.text();
        let hash = reader.word();
        let parent = reader.word().cast_signed();
        let mut floats = [0.0; 26];
        for float in &mut floats {
            *float = f32::from_bits(reader.word());
        }
        joints.push(DecodedJoint {
            name,
            hash,
            parent,
            translation: floats[0..3].try_into().unwrap(),
            rotation: floats[3..7].try_into().unwrap(),
            scale: floats[7..10].try_into().unwrap(),
            inverse_bind: floats[10..26].try_into().unwrap(),
        });
    }
    let influences = (0..influence_count).map(|_| reader.word()).collect();

    assert_eq!(
        reader.at,
        buffer.len(),
        "the buffer ends where the layout does"
    );

    Decoded {
        version,
        joints,
        influences,
    }
}

/// The ELF hash of the lowercased name, written out apart from the module's own.
fn lowercased_elf(name: &str) -> u32 {
    let mut hash: u32 = 0;
    for byte in name.bytes().map(|byte| byte.to_ascii_lowercase()) {
        hash = (hash << 4).wrapping_add(u32::from(byte));
        let high = hash & 0xF000_0000;
        if high != 0 {
            hash ^= high >> 24;
        }
        hash &= !high;
    }
    hash
}

/// A root, and one child of it that the mesh is bound to.
fn rig() -> RigResource {
    RigResource::builder("rig", "rig")
        .with_root_joint(
            Joint::builder("Root")
                .with_local_transform(Mat4::from_translation(vec3(0.0, 10.0, 0.0)))
                .with_inverse_bind_transform(Mat4::from_translation(vec3(0.0, -10.0, 0.0)))
                .with_children([Joint::builder("L_Hand")
                    .with_influence(true)
                    .with_local_transform(Mat4::from_scale_rotation_translation(
                        vec3(2.0, 2.0, 2.0),
                        Quat::IDENTITY,
                        vec3(5.0, 0.0, 0.0),
                    ))
                    .with_inverse_bind_transform(Mat4::from_translation(vec3(-5.0, -10.0, 0.0)))]),
        )
        .build()
}

fn skl(rig: &RigResource) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    rig.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn close(left: &[f32], right: &[f32]) -> bool {
    left.len() == right.len() && left.iter().zip(right).all(|(a, b)| (a - b).abs() < 1e-5)
}

#[test]
fn a_skeleton_round_trips_through_the_buffer() {
    let decoded = decode(&render(&skl(&rig())).unwrap());

    assert_eq!(decoded.version, VERSION);
    let names: Vec<&str> = decoded
        .joints
        .iter()
        .map(|joint| joint.name.as_str())
        .collect();
    assert_eq!(names, ["Root", "L_Hand"]);
    assert_eq!(decoded.joints[0].parent, -1, "a root names no parent");
    assert_eq!(decoded.joints[1].parent, 0);

    let hand = &decoded.joints[1];
    assert!(close(&hand.translation, &[5.0, 0.0, 0.0]), "{hand:?}");
    assert!(close(&hand.rotation, &[0.0, 0.0, 0.0, 1.0]), "{hand:?}");
    assert!(close(&hand.scale, &[2.0, 2.0, 2.0]), "{hand:?}");
    assert!(
        close(
            &hand.inverse_bind,
            &Mat4::from_translation(vec3(-5.0, -10.0, 0.0)).to_cols_array()
        ),
        "{hand:?}"
    );
}

/// An `.anm` names a track by the lowercased name's hash, and a raw-case hash binds
/// only the joints whose names are lowercase already.
#[test]
fn a_joint_carries_the_hash_its_track_is_named_by() {
    let decoded = decode(&render(&skl(&rig())).unwrap());

    assert_eq!(decoded.joints[0].hash, lowercased_elf("root"));
    assert_eq!(decoded.joints[1].hash, lowercased_elf("l_hand"));
}

/// A skin index names a shader joint, and the influence table turns it into a joint.
#[test]
fn an_influence_is_the_slot_of_the_joint_it_names() {
    let decoded = decode(&render(&skl(&rig())).unwrap());

    assert_eq!(decoded.influences, vec![1]);
}

#[test]
fn an_influence_past_the_joints_is_an_error_rather_than_a_skin_bound_to_nothing() {
    let mut bytes = skl(&rig());
    let influences =
        usize::try_from(i32::from_le_bytes(bytes[28..32].try_into().unwrap())).unwrap();
    bytes[influences..influences + 2].copy_from_slice(&7_i16.to_le_bytes());

    let err = render(&bytes).unwrap_err();

    assert!(
        matches!(err, PreviewError::SkeletonOutOfBounds),
        "unexpected error: {err}"
    );
}

#[test]
fn bytes_that_are_no_skeleton_are_unsupported() {
    let err = render(b"PROP\x00\x00\x00\x00").unwrap_err();

    assert!(
        matches!(err, PreviewError::Unsupported(_)),
        "unexpected error: {err}"
    );
}

#[test]
fn a_half_written_skeleton_is_reported_and_not_a_panic() {
    let whole = skl(&rig());

    let err = render(&whole[..64]).unwrap_err();

    assert!(
        matches!(err, PreviewError::SkeletonRead(_)),
        "unexpected error: {err}"
    );
}
