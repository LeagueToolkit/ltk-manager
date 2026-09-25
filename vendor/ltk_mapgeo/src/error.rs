//! Error types for map geometry parsing

/// Errors that can occur when writing a map geometry file
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum WriteError {
    /// A mesh refers to a vertex buffer the asset does not have.
    #[error("mesh {mesh} refers to vertex buffer {index}, which does not exist")]
    MissingVertexBuffer { mesh: usize, index: usize },

    /// A mesh refers to an index buffer the asset does not have.
    #[error("mesh {mesh} refers to index buffer {index}, which does not exist")]
    MissingIndexBuffer { mesh: usize, index: usize },

    /// A vertex buffer does not hold the vertex count of a mesh that uses it.
    #[error("vertex buffer {buffer} holds {actual} vertices, but mesh {mesh} says {expected}")]
    VertexCountMismatch {
        mesh: usize,
        buffer: usize,
        expected: usize,
        actual: usize,
    },

    /// A mesh uses more indices than its index buffer holds.
    #[error("mesh {mesh} uses {index_count} indices, but its index buffer holds {buffer_len}")]
    IndexCountOutOfBounds {
        mesh: usize,
        index_count: usize,
        buffer_len: usize,
    },

    /// No mesh uses a vertex buffer, so a reader could not tell its layout.
    #[error("vertex buffer {index} is not used by any mesh")]
    UnreferencedVertexBuffer { index: usize },

    /// A vertex layout has more elements than a declaration has slots.
    #[error("a vertex layout has {count} elements, but declarations hold at most 15")]
    TooManyVertexElements { count: usize },

    /// A scene graph is disabled, which the client refuses to load.
    #[error("scene graph {index} is disabled")]
    DisabledSceneGraph { index: usize },

    /// A count or size does not fit its field.
    #[error("too many {0} for the format")]
    TooLarge(&'static str),

    /// An IO error occurred
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Errors that can occur when parsing a map geometry file
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// The file signature is invalid (expected "OEGM")
    #[error("Invalid file signature")]
    InvalidFileSignature,

    /// The file version is not supported
    #[error("Unsupported file version: {0}")]
    UnsupportedVersion(u32),

    /// An invalid vertex element name was encountered
    #[error("Invalid vertex element name: {0}")]
    InvalidElementName(u32),

    /// An invalid vertex element format was encountered
    #[error("Invalid vertex element format: {0}")]
    InvalidElementFormat(u32),

    /// A vertex buffer reference is out of bounds
    #[error("Vertex buffer index out of bounds: {index} (max: {max})")]
    VertexBufferIndexOutOfBounds { index: usize, max: usize },

    /// An index buffer reference is out of bounds
    #[error("Index buffer index out of bounds: {index} (max: {max})")]
    IndexBufferIndexOutOfBounds { index: usize, max: usize },

    /// A vertex declaration reference is out of bounds
    #[error("Vertex declaration index out of bounds: {index} (max: {max})")]
    VertexDeclarationIndexOutOfBounds { index: usize, max: usize },

    /// Vertex declarations reserve space for 15 elements; counts above that are invalid.
    #[error("Invalid vertex element count in declaration: {count} (max: 15)")]
    InvalidVertexElementCount { count: u32 },

    /// A vertex buffer was present in the file but never referenced by any mesh,
    /// so we cannot infer its vertex declaration (elements/stride).
    #[error("Vertex buffer {index} is not referenced by any mesh")]
    UnreferencedVertexBuffer { index: usize },

    /// A vertex buffer was referenced by meshes with conflicting vertex declarations.
    #[error("Vertex buffer {index} is referenced with conflicting vertex declarations")]
    AmbiguousVertexBufferDeclaration { index: usize },

    /// A vertex buffer's decoded vertex count does not match the mesh's declared vertex count.
    #[error("Vertex buffer {index} vertex count mismatch: decoded={decoded}, expected={expected}")]
    VertexBufferVertexCountMismatch {
        index: usize,
        decoded: usize,
        expected: usize,
    },

    /// An IO error occurred
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// A string encoding error occurred
    #[error("UTF-8 error: {0}")]
    Utf8(#[from] std::str::Utf8Error),

    /// A reader extension error occurred
    #[error("Reader error: {0}")]
    Reader(#[from] ltk_io_ext::ReaderError),
}
