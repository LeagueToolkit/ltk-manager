//! Print every `StaticMaterialDef` of a bin inside a WAD with its shaders translated.
//!
//! ```text
//! cargo run --release -p ltk-manager-game --example dump_programs -- <wad> <chunk path> <shaders wad> <shader cache wad> <cache dir> [--low]
//! ```
//!
//! One JSON line per material, the [`MaterialProgram`] the viewport binds, with no names
//! and only the shader cache's chunks located. `<shaders wad>` is `Global.wad.client`,
//! `<shader cache wad>` is `ShaderCache.dx11.wad.client`, and `<cache dir>` is where the
//! translations are kept between runs. A summary per pass goes to stderr.

use std::cell::RefCell;
use std::io::BufReader;
use std::path::Path;
use std::time::Instant;

use fs_err as fs;
use hexshade::TranslationCache;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_manager_core::bin_document::{AssetLookup, BinDocument};
use ltk_manager_core::error::{AppError, AppResult};
use ltk_manager_core::material::SHADER_DEFS_PATH;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_game::program::{
    MaterialProgram, ProgramOptions, ProgramRead, Resolution, read_programs,
};
use ltk_wad::Wad;

const SHADER_CACHE: &str = "ShaderCache.dx11.wad.client";

/// The shader cache alone, located by chunk hash and read by the same.
struct ShaderCacheLookup {
    wad: RefCell<Wad<BufReader<fs::File>>>,
}

impl ShaderCacheLookup {
    fn read(&self, asset: &AssetRef) -> AppResult<Vec<u8>> {
        let AssetRef::GameChunk { path_hash, .. } = asset else {
            return Err(AppError::InvalidPath(format!("{asset:?}")));
        };
        let hash = u64::from_str_radix(path_hash, 16)
            .map_err(|e| AppError::InvalidPath(format!("{path_hash}: {e}")))?;
        let mut wad = self.wad.borrow_mut();
        let chunk = *wad
            .chunks()
            .get(ltk_wad::WadHash(hash))
            .ok_or_else(|| AppError::InvalidPath(path_hash.clone()))?;
        Ok(wad
            .load_chunk_decompressed(&chunk)
            .map_err(|e| AppError::Other(e.to_string()))?
            .into_vec())
    }
}

impl AssetLookup for ShaderCacheLookup {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        self.locate_chunk(WadHash::hash_str(path))
    }

    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        self.wad
            .borrow()
            .chunks()
            .get(ltk_wad::WadHash(hash.0))
            .map(|_| AssetRef::GameChunk {
                wad: SHADER_CACHE.to_owned(),
                path_hash: format!("{:016x}", hash.0),
                project: None,
            })
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let low_quality = args.iter().any(|arg| arg == "--low");
    let plain: Vec<&String> = args.iter().filter(|arg| !arg.starts_with("--")).collect();
    let [wad_path, chunk_path, shaders_wad, cache_wad, cache_dir] = plain.as_slice() else {
        eprintln!(
            "usage: dump_programs <wad> <chunk path> <shaders wad> <shader cache wad> <cache dir> [--low]"
        );
        std::process::exit(2);
    };

    let document = BinDocument::parse(chunk(wad_path, chunk_path)).expect("parse bin");
    let shaders = BinDocument::parse(chunk(shaders_wad, SHADER_DEFS_PATH)).expect("parse shaders");
    let lookup = ShaderCacheLookup {
        wad: RefCell::new(
            Wad::mount(BufReader::new(fs::File::open(cache_wad).expect("open wad")))
                .expect("mount wad"),
        ),
    };
    let translations = TranslationCache::new(Some(Path::new(cache_dir)));

    let material_class = BinHash::hash_str("StaticMaterialDef");
    let entries: Vec<BinHash> = document
        .entries()
        .filter(|entry| {
            document
                .object_at(*entry)
                .is_some_and(|object| object.class_hash == material_class)
        })
        .collect();
    let started = Instant::now();
    let programs = read_programs(
        Resolution {
            document: &document,
            names: &(),
            assets: &lookup,
            shaders: Some(&shaders),
        },
        &entries,
        ProgramOptions { low_quality },
        &translations,
        &mut |asset| lookup.read(asset),
    );
    let elapsed = started.elapsed();

    let mut ready = 0usize;
    for program in programs.iter().flatten() {
        report(program, &mut ready);
        println!("{}", serde_json::to_string(program).expect("serialize"));
    }
    eprintln!(
        "{} materials, {ready} passes ready, {:.1} ms",
        programs.len(),
        elapsed.as_secs_f64() * 1000.0
    );
}

fn report(program: &MaterialProgram, ready: &mut usize) {
    for pass in &program.passes {
        match &pass.program {
            ProgramRead::Ready {
                vertex,
                pixel,
                defines,
            } => {
                *ready += 1;
                eprintln!(
                    "{} {}: vs {}{} {} lines, ps {}{} {} lines, {} defines",
                    program.hash,
                    pass.pass.shader.as_deref().unwrap_or("-"),
                    vertex.id,
                    if vertex.cached { " (cached)" } else { "" },
                    vertex.glsl.lines().count(),
                    pixel.id,
                    if pixel.cached { " (cached)" } else { "" },
                    pixel.glsl.lines().count(),
                    defines.len()
                );
            }
            ProgramRead::Failed { reason } => {
                eprintln!(
                    "{} {}: FAILED {reason}",
                    program.hash,
                    pass.pass.shader.as_deref().unwrap_or("-")
                );
            }
        }
    }
}

fn chunk(wad_path: &str, chunk_path: &str) -> Vec<u8> {
    let file = fs::File::open(wad_path).expect("open wad");
    let mut wad = Wad::mount(file).expect("mount wad");
    /* A chunk no table names is given as its hash, `0x` and sixteen hex digits. */
    let chunk_hash = chunk_path
        .strip_prefix("0x")
        .and_then(|hex| u64::from_str_radix(hex, 16).ok())
        .unwrap_or_else(|| ltk_modpkg::ChunkPath::new(chunk_path).hash().value());
    let chunk = *wad
        .chunks()
        .get(ltk_wad::WadHash(chunk_hash))
        .expect("chunk in wad");
    wad.load_chunk_decompressed(&chunk)
        .expect("read chunk")
        .into_vec()
}
