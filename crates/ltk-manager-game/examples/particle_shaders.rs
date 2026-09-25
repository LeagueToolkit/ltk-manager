//! Find every stage of every engine particle shader in an installed shader cache.
//!
//! ```text
//! cargo run --release -p ltk-manager-game --example particle_shaders -- <shader cache wad> [--dump <out.json>] [--tocs <out.json>]
//! ```
//!
//! `<shader cache wad>` is `ShaderCache.dx11.wad.client`. One line per stage: its TOC path,
//! its permutation count and the [`ParticleDefine`]s its base defines declare. Exits with 1
//! when a TOC is missing.
//!
//! `--dump` also reads the program of each pair for every set of the defines its two TOCs
//! declare, and writes them to `<out.json>` as `[{ shader, defines, program }]`, the
//! [`PassProgram`] the viewport binds.
//!
//! `--tocs` writes each stage's base defines and every subset of them its TOC has a
//! permutation for, as `{ shader: { vertex: { base, present }, pixel } }`, which the
//! particle define sweep in `particleShader.sweep.test.ts` checks emitters against.

use std::cell::RefCell;
use std::io::BufReader;

use fs_err as fs;
use hexshade::bundle::{ShaderToc, chunk_hash, permutation, read_toc};
use hexshade::{Defines, Stage, TranslationCache};
use ltk_hash::{Hash as _, WadHash};
use ltk_manager_core::bin_document::AssetLookup;
use ltk_manager_core::error::{AppError, AppResult};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_game::program::{
    ParticleDefine, ParticleShader, PassProgram, ProgramOptions, ProgramRead, read_particle_program,
};
use ltk_wad::Wad;
use serde::Serialize;
use serde_json::{Map, Value, json};

const SHADER_CACHE: &str = "ShaderCache.dx11.wad.client";

type CacheWad = Wad<BufReader<fs::File>>;

/// One pair's program for one define set.
#[derive(Serialize)]
struct Dumped {
    shader: ParticleShader,
    defines: Vec<ParticleDefine>,
    program: PassProgram,
}

/// The shader cache alone, located and read by chunk hash.
struct ShaderCacheLookup {
    wad: RefCell<CacheWad>,
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

    /// The TOC of `shader`'s `stage`, and none where the cache has no such chunk.
    fn toc(&self, shader: ParticleShader, stage: Stage) -> Option<ShaderToc> {
        let path = shader.path().toc_path(stage);
        let mut wad = self.wad.borrow_mut();
        let chunk = *wad.chunks().get(chunk_hash(&path).into())?;
        let bytes = wad
            .load_chunk_decompressed(&chunk)
            .expect("the chunk reads")
            .into_vec();
        Some(read_toc(&bytes).expect("a TOC"))
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
    let mut rest = args.iter();
    let Some(wad_path) = rest.next() else { usage() };
    let mut dump = None;
    let mut tocs_out = None;
    while let Some(flag) = rest.next() {
        let slot = match flag.as_str() {
            "--dump" => &mut dump,
            "--tocs" => &mut tocs_out,
            _ => usage(),
        };
        *slot = Some(rest.next().unwrap_or_else(|| usage()));
    }

    let lookup = ShaderCacheLookup {
        wad: RefCell::new(
            Wad::mount(BufReader::new(
                fs::File::open(wad_path).expect("the wad opens"),
            ))
            .expect("the wad mounts"),
        ),
    };

    let mut missing = 0usize;
    let mut declared_by = Vec::new();
    let mut tocs = Map::new();
    for shader in ParticleShader::ALL {
        let mut stages = Map::new();
        let mut pair_defines = Vec::new();
        for stage in [Stage::Vertex, Stage::Pixel] {
            let path = shader.path().toc_path(stage);
            let Some(toc) = lookup.toc(shader, stage) else {
                println!("{} {stage}: MISSING {path}", shader.name());
                missing += 1;
                continue;
            };

            let declared: Vec<ParticleDefine> = ParticleDefine::ALL
                .into_iter()
                .filter(|define| {
                    toc.base_defines
                        .iter()
                        .any(|base| base.name == define.name())
                })
                .collect();
            let names: Vec<&str> = declared.iter().map(|define| define.name()).collect();
            println!(
                "{} {stage}: {path} {} [{}]",
                shader.name(),
                toc.shader_ids.len(),
                names.join(" ")
            );
            pair_defines.extend(declared);
            stages.insert(stage.to_string(), toc_sets(&toc));
        }
        pair_defines.sort_unstable();
        pair_defines.dedup();
        declared_by.push((shader, pair_defines));
        let key = serde_json::to_value(shader).expect("a shader name");
        tocs.insert(
            key.as_str().unwrap_or_default().to_owned(),
            Value::Object(stages),
        );
    }

    if missing > 0 {
        eprintln!("{missing} TOC(s) missing");
        std::process::exit(1);
    }

    if let Some(out) = tocs_out {
        fs::write(out, Value::Object(tocs).to_string()).expect("write the TOCs");
    }

    let Some(out) = dump else { return };

    let translations = TranslationCache::default();
    let mut dumped = Vec::new();
    let mut failed = 0usize;
    for (shader, declared) in declared_by {
        for mask in 0..1u32 << declared.len() {
            let defines: Vec<ParticleDefine> = declared
                .iter()
                .enumerate()
                .filter(|(bit, _)| mask & (1 << bit) != 0)
                .map(|(_, define)| *define)
                .collect();
            let program = read_particle_program(
                &lookup,
                shader,
                &defines,
                ProgramOptions::default(),
                &translations,
                &mut |asset| lookup.read(asset),
            );
            if let ProgramRead::Failed { reason } = &program.program {
                eprintln!("{} {defines:?}: {reason}", shader.name());
                failed += 1;
            }
            dumped.push(Dumped {
                shader,
                defines,
                program,
            });
        }
    }

    fs::write(out, serde_json::to_string(&dumped).expect("json")).expect("write the dump");
    eprintln!("{} programs, {failed} failed", dumped.len());
    if failed > 0 {
        std::process::exit(1);
    }
}

/// The base defines of `toc`, and each subset of them it has a permutation for.
fn toc_sets(toc: &ShaderToc) -> Value {
    let base: Vec<&str> = toc
        .base_defines
        .iter()
        .map(|define| define.name.as_str())
        .collect();
    let present: Vec<Vec<&str>> = (0..1u32 << toc.base_defines.len())
        .filter_map(|mask| {
            let chosen: Vec<_> = toc
                .base_defines
                .iter()
                .enumerate()
                .filter(|(bit, _)| mask & (1 << bit) != 0)
                .map(|(_, define)| define)
                .collect();
            let defines: Defines = chosen
                .iter()
                .map(|define| (define.name.as_str(), define.value.as_str()))
                .collect();
            permutation(toc, &defines)?;

            let mut names: Vec<&str> = chosen.iter().map(|define| define.name.as_str()).collect();
            names.sort_unstable();
            Some(names)
        })
        .collect();
    json!({ "base": base, "present": present })
}

fn usage() -> ! {
    eprintln!("usage: particle_shaders <shader cache wad> [--dump <out.json>] [--tocs <out.json>]");
    std::process::exit(2);
}
