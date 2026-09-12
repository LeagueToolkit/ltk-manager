use glam::{Vec3, vec2, vec3};
use ltk_mesh::mem::{IndexBuffer, VertexBuffer, VertexBufferDescription};
use ltk_mesh::{SkinnedMesh, SkinnedMeshRange, SkinnedMeshVertexType, StaticMesh, StaticMeshFace};

use super::*;

/// A geometry buffer read back, so a round trip has two sides.
#[derive(Debug, PartialEq)]
struct Decoded {
    version: u32,
    flags: u32,
    positions: Vec<f32>,
    normals: Option<Vec<f32>>,
    uvs: Option<Vec<f32>>,
    skin_indices: Option<Vec<u8>>,
    skin_weights: Option<Vec<f32>>,
    indices: Vec<u32>,
    submeshes: Vec<(String, u32, u32)>,
}

/// A position in a geometry buffer, for the decoder to walk.
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

    fn floats(&mut self, count: usize) -> Vec<f32> {
        (0..count).map(|_| f32::from_bits(self.word())).collect()
    }

    fn bytes(&mut self, count: usize) -> Vec<u8> {
        let bytes = self.buffer[self.at..self.at + count].to_vec();
        self.at += count;
        bytes
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

    assert_eq!(reader.word(), MAGIC, "the buffer opens with LTKG");
    let version = reader.word();
    let flags = reader.word();
    let vertex_count = reader.word() as usize;
    let index_count = reader.word() as usize;
    let submesh_count = reader.word() as usize;

    let positions = reader.floats(vertex_count * 3);
    let normals = (flags & HAS_NORMALS != 0).then(|| reader.floats(vertex_count * 3));
    let uvs = (flags & HAS_UVS != 0).then(|| reader.floats(vertex_count * 2));
    let skin_indices = (flags & HAS_SKIN != 0).then(|| reader.bytes(vertex_count * 4));
    let skin_weights = (flags & HAS_SKIN != 0).then(|| reader.floats(vertex_count * 4));
    let indices = (0..index_count).map(|_| reader.word()).collect();
    let submeshes = (0..submesh_count)
        .map(|_| (reader.text(), reader.word(), reader.word()))
        .collect();

    assert_eq!(
        reader.at,
        buffer.len(),
        "the buffer ends where the layout does"
    );

    Decoded {
        version,
        flags,
        positions,
        normals,
        uvs,
        skin_indices,
        skin_weights,
        indices,
        submeshes,
    }
}

/// One 52-byte `Basic` vertex bound wholly to shader joint zero.
fn vertex(position: [f32; 3], normal: [f32; 3], uv: [f32; 2]) -> Vec<u8> {
    bound_vertex(position, [0; 4], [1.0, 0.0, 0.0, 0.0], normal, uv)
}

/// One 52-byte `Basic` vertex: position, blend indices, blend weights, normal, uv.
fn bound_vertex(
    position: [f32; 3],
    joints: [u8; 4],
    weights: [f32; 4],
    normal: [f32; 3],
    uv: [f32; 2],
) -> Vec<u8> {
    let floats =
        |values: &[f32]| -> Vec<u8> { values.iter().flat_map(|f| f.to_le_bytes()).collect() };

    let mut bytes = floats(&position);
    bytes.extend(joints);
    bytes.extend(floats(&weights));
    bytes.extend(floats(&normal));
    bytes.extend(floats(&uv));
    bytes
}

/// One `.skn` of `ranges`, over `count` vertices indexed in order.
///
/// Vertex `i` sits at `(i, 2i, 3i)` with a normal of `(0, 1, 0)` and a uv of `(i, -i)`,
/// so a decoded block is read against arithmetic rather than a table.
fn skn(count: u16, ranges: Vec<SkinnedMeshRange>) -> Vec<u8> {
    let vertices: Vec<u8> = (0..count)
        .flat_map(|i| {
            let i = f32::from(i);
            vertex([i, i * 2.0, i * 3.0], [0.0, 1.0, 0.0], [i, -i])
        })
        .collect();
    let indices: Vec<u8> = (0..count).flat_map(u16::to_le_bytes).collect();

    let mesh = SkinnedMesh::from_absolute_indices(
        ranges,
        VertexBuffer::new(
            VertexBufferDescription::from(SkinnedMeshVertexType::Basic),
            vertices,
        ),
        IndexBuffer::<u16>::new(indices),
    );

    let mut bytes = Vec::new();
    mesh.to_writer(&mut bytes).unwrap();
    bytes
}

/// One `.skn` whose index buffer is `indices` rather than one index per vertex.
fn skn_indexed(count: u16, ranges: Vec<SkinnedMeshRange>, indices: Vec<u16>) -> Vec<u8> {
    let vertices: Vec<u8> = (0..count)
        .flat_map(|i| {
            let i = f32::from(i);
            vertex([i, i * 2.0, i * 3.0], [0.0, 1.0, 0.0], [i, -i])
        })
        .collect();

    let mesh = SkinnedMesh::from_absolute_indices(
        ranges,
        VertexBuffer::new(
            VertexBufferDescription::from(SkinnedMeshVertexType::Basic),
            vertices,
        ),
        IndexBuffer::<u16>::new(indices.into_iter().flat_map(u16::to_le_bytes).collect()),
    );

    let mut bytes = Vec::new();
    mesh.to_writer(&mut bytes).unwrap();
    bytes
}

/// One `.scb` of `faces` over `vertices`, through `ltk_mesh`'s own writer.
fn scb(vertices: Vec<Vec3>, faces: Vec<StaticMeshFace>) -> Vec<u8> {
    let mut bytes = Vec::new();
    StaticMesh::new("preview", vertices, faces)
        .to_writer(&mut bytes)
        .unwrap();
    bytes
}

/// A unit quad's four corners, which two faces index.
fn quad() -> Vec<Vec3> {
    vec![
        vec3(0.0, 0.0, 0.0),
        vec3(1.0, 0.0, 0.0),
        vec3(1.0, 1.0, 0.0),
        vec3(0.0, 1.0, 0.0),
    ]
}

#[test]
fn a_skinned_mesh_round_trips_through_the_buffer() {
    let bytes = skn(3, vec![SkinnedMeshRange::new("body", 0, 3, 0, 3)]);

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(
        decoded,
        Decoded {
            version: VERSION,
            flags: HAS_NORMALS | HAS_UVS | HAS_SKIN,
            positions: vec![0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 2.0, 4.0, 6.0],
            normals: Some(vec![0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0]),
            uvs: Some(vec![0.0, 0.0, 1.0, -1.0, 2.0, -2.0]),
            skin_indices: Some(vec![0; 12]),
            skin_weights: Some([1.0, 0.0, 0.0, 0.0].repeat(3)),
            indices: vec![0, 1, 2],
            submeshes: vec![("body".to_owned(), 0, 3)],
        }
    );
}

/// The influences are what a skeleton poses the mesh by, so each vertex keeps its own
/// four in the order the file gives them.
#[test]
fn a_vertex_keeps_its_joints_and_weights() {
    let vertices: Vec<u8> = [
        ([3, 1, 0, 0], [0.75, 0.25, 0.0, 0.0]),
        ([2, 4, 6, 8], [0.4, 0.3, 0.2, 0.1]),
        ([5, 0, 0, 0], [1.0, 0.0, 0.0, 0.0]),
    ]
    .into_iter()
    .flat_map(|(joints, weights)| {
        bound_vertex([0.0; 3], joints, weights, [0.0, 1.0, 0.0], [0.0; 2])
    })
    .collect();
    let mesh = SkinnedMesh::from_absolute_indices(
        vec![SkinnedMeshRange::new("body", 0, 3, 0, 3)],
        VertexBuffer::new(
            VertexBufferDescription::from(SkinnedMeshVertexType::Basic),
            vertices,
        ),
        IndexBuffer::<u16>::new(
            [0_u16, 1, 2]
                .into_iter()
                .flat_map(u16::to_le_bytes)
                .collect(),
        ),
    );
    let mut bytes = Vec::new();
    mesh.to_writer(&mut bytes).unwrap();

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(
        decoded.skin_indices,
        Some(vec![3, 1, 0, 0, 2, 4, 6, 8, 5, 0, 0, 0])
    );
    assert_eq!(
        decoded.skin_weights,
        Some(vec![
            0.75, 0.25, 0.0, 0.0, 0.4, 0.3, 0.2, 0.1, 1.0, 0.0, 0.0, 0.0
        ])
    );
}

/// A `.skn` stores every index relative to the range that owns it, and a viewport
/// indexes one flat vertex list.
#[test]
fn a_second_range_keeps_its_indices_absolute() {
    let bytes = skn(
        6,
        vec![
            SkinnedMeshRange::new("body", 0, 3, 0, 3),
            SkinnedMeshRange::new("cape", 3, 3, 3, 3),
        ],
    );

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(decoded.indices, vec![0, 1, 2, 3, 4, 5]);
    assert_eq!(
        decoded.submeshes,
        vec![("body".to_owned(), 0, 3), ("cape".to_owned(), 3, 3)],
        "each range owns one contiguous run of the flat index block"
    );
}

#[test]
fn a_submesh_name_survives_the_buffer() {
    let bytes = skn(
        3,
        vec![SkinnedMeshRange::new("lambert1_Ionia_VFX", 0, 3, 0, 3)],
    );

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(decoded.submeshes[0].0, "lambert1_Ionia_VFX");
}

/// A static mesh carries no normal and keys its uvs per face corner, so one flag bit
/// stays clear and the vertices are the corners rather than the file's own list.
#[test]
fn a_static_mesh_has_uvs_and_no_normals() {
    let bytes = scb(
        quad(),
        vec![
            StaticMeshFace::new(
                "mat",
                [0, 1, 2],
                [vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0)],
            ),
            StaticMeshFace::new(
                "mat",
                [0, 2, 3],
                [vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0)],
            ),
        ],
    );

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(
        decoded.flags, HAS_UVS,
        "no bit is set for absent normals or skin"
    );
    assert_eq!(decoded.normals, None);
    assert_eq!(decoded.skin_indices, None);
    assert_eq!(decoded.positions.len(), 6 * 3, "one vertex per face corner");
    assert_eq!(decoded.uvs.as_ref().unwrap().len(), 6 * 2);
    assert_eq!(decoded.indices, vec![0, 1, 2, 3, 4, 5]);
    assert_eq!(decoded.submeshes, vec![("mat".to_owned(), 0, 6)]);
}

/// The faces a `.scb` interleaves by material come back grouped, because a submesh is
/// one run and `mSubmeshesToDraw` filters by its name.
#[test]
fn interleaved_materials_group_into_contiguous_submeshes() {
    let uvs = [vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0)];
    let bytes = scb(
        quad(),
        vec![
            StaticMeshFace::new("glow", [0, 1, 2], uvs),
            StaticMeshFace::new("core", [0, 2, 3], uvs),
            StaticMeshFace::new("glow", [1, 2, 3], uvs),
        ],
    );

    let decoded = decode(&render(&bytes).unwrap());

    assert_eq!(
        decoded.submeshes,
        vec![("glow".to_owned(), 0, 6), ("core".to_owned(), 6, 3)],
        "a material's faces are one run, ordered by where the file first names it"
    );
}

/// The resolution chain reaches `.tmesh` and `.gmesh` wherever an artist authored one,
/// and this build has a reader for neither.
#[test]
fn a_format_this_build_does_not_read_names_itself() {
    for (magic, format) in [(b"GMSH", ".gmesh"), (b"TMSH", ".tmesh")] {
        let mut bytes = magic.to_vec();
        bytes.extend(1_u32.to_le_bytes());

        let err = render(&bytes).unwrap_err();

        assert!(
            matches!(err, PreviewError::UnsupportedMesh(named) if named == format),
            "unexpected error for {format}: {err}"
        );
    }
}

#[test]
fn bytes_that_are_no_mesh_are_unsupported_rather_than_a_panic() {
    let err = render(b"PROP\x00\x00\x00\x00").unwrap_err();

    assert!(
        matches!(err, PreviewError::Unsupported(_)),
        "unexpected error: {err}"
    );
}

#[test]
fn a_half_written_mesh_is_reported_and_not_a_panic() {
    let whole = skn(3, vec![SkinnedMeshRange::new("body", 0, 3, 0, 3)]);

    let err = render(&whole[..whole.len() / 2]).unwrap_err();

    assert!(
        matches!(err, PreviewError::MeshRead(_)),
        "unexpected error: {err}"
    );
}

/// A range can name a vertex the file does not hold, and the buffer would otherwise
/// go to the GPU with an index nothing backs.
#[test]
fn a_range_past_the_vertices_is_an_error_rather_than_a_buffer_the_gpu_reads_off() {
    let bytes = skn_indexed(
        3,
        vec![SkinnedMeshRange::new("body", 0, 3, 0, 3)],
        vec![0, 1, 9],
    );

    let err = render(&bytes).unwrap_err();

    assert!(
        matches!(err, PreviewError::MeshOutOfBounds),
        "unexpected error: {err}"
    );
}

/// A face can name a vertex the file does not hold, and the buffer would otherwise
/// carry whatever sat at that offset.
#[test]
fn a_face_past_the_vertices_is_an_error_rather_than_a_partial_mesh() {
    let bytes = scb(
        quad(),
        vec![StaticMeshFace::new(
            "mat",
            [0, 1, 9],
            [vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0)],
        )],
    );

    let err = render(&bytes).unwrap_err();

    assert!(
        matches!(err, PreviewError::MeshOutOfBounds),
        "unexpected error: {err}"
    );
}
