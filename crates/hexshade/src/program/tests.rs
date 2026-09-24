use std::collections::HashMap;

use xxhash_rust::xxh64::xxh64;

use super::*;

const SHADER: &str = "Shaders/SkinnedMesh/Diffuse_Bloom";

/// Chunks by path, with a count of each read.
#[derive(Default)]
struct Chunks {
    held: HashMap<String, Vec<u8>>,
    reads: HashMap<String, usize>,
}

impl ShaderSource for Chunks {
    fn chunk(&mut self, path: &str) -> Result<Vec<u8>, SourceError> {
        *self.reads.entry(path.to_owned()).or_default() += 1;
        self.held.get(path).cloned().ok_or(SourceError::Missing)
    }
}

fn sized(out: &mut Vec<u8>, text: &str) {
    out.extend(u32::try_from(text.len()).unwrap().to_le_bytes());
    out.extend(text.as_bytes());
}

/// A `TOC3.0` with no base defines and one permutation, shader id 0.
fn toc_bytes() -> Vec<u8> {
    let mut out = Vec::new();
    sized(&mut out, "TOC3.0");
    for count in [1u32, 0, 1, 0] {
        out.extend(count.to_le_bytes());
    }
    sized(&mut out, "baseDefines");
    sized(&mut out, "shaders");
    out.extend(xxh64(b"", 0).to_le_bytes());
    out.extend(0u32.to_le_bytes());
    out
}

#[test]
fn a_missing_toc_names_the_chunk_path() {
    let mut chunks = Chunks::default();
    let translations = TranslationCache::default();

    let error = ShaderCache::new(&mut chunks, &translations)
        .program(ShaderPath::Generated(SHADER), &Defines::default())
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "Nothing on this machine holds \
         assets/shaders/generated/shaders/skinnedmesh/diffuse_bloom.vs-dx11"
    );
}

#[test]
fn each_toc_and_bundle_is_read_once_per_cache() {
    let toc = bundle::toc_path(SHADER, Stage::Vertex);
    let bundle = bundle::bundle_path(&toc, 0);
    let mut chunks = Chunks::default();
    chunks.held.insert(toc.clone(), toc_bytes());
    chunks.held.insert(bundle.clone(), Vec::new());
    let translations = TranslationCache::default();

    let mut cache = ShaderCache::new(&mut chunks, &translations);
    let first = cache
        .program(ShaderPath::Generated(SHADER), &Defines::default())
        .unwrap_err();
    let second = cache
        .program(ShaderPath::Generated(SHADER), &Defines::default())
        .unwrap_err();

    assert!(
        matches!(first, ProgramError::NoRecord { id: 0, .. }),
        "{first}"
    );
    assert!(
        matches!(second, ProgramError::NoRecord { id: 0, .. }),
        "{second}"
    );
    assert_eq!(chunks.reads, HashMap::from([(toc, 1), (bundle, 1)]));
}

#[test]
fn an_hlsl_shader_reads_the_toc_of_each_stage_file() {
    let mut chunks = Chunks::default();
    let translations = TranslationCache::default();
    let shader = ShaderPath::Hlsl {
        vertex: "ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs",
        pixel: "ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_PS.ps",
    };

    let error = ShaderCache::new(&mut chunks, &translations)
        .program(shader, &Defines::default())
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "Nothing on this machine holds assets/shaders/hlsl/skinnedmesh/lit_uber_vs.vs-dx11"
    );
    assert_eq!(
        shader.toc_path(Stage::Pixel),
        "assets/shaders/hlsl/skinnedmesh/lit_uber_ps.ps-dx11"
    );
}
