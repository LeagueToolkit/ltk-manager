//! Translate one shader out of an installed `ShaderCache.dx11.wad.client`.
//!
//! ```text
//! cargo run -p hexshade --example translate -- <wad> <object path | vs file,ps file> <out dir> [--id N | NAME=VALUE ...]
//! ```
//!
//! Writes `<out dir>/<stage>.glsl` and `<out dir>/<stage>.json` for both stages. With
//! `--id`, the record of that shader id is taken from both TOCs. Otherwise the defines
//! select the permutation as the engine would. Two HLSL files joined by a comma name an
//! engine shader, `ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs,...LIT_UBER_PS.ps`.

use fs_err as fs;
use std::io::BufReader;
use std::path::Path;

use hexshade::bundle::{
    bundle_path, chunk_hash, index_in_bundle, permutation, read_toc, record, toc_path,
};
use hexshade::{Defines, ShaderPath, Stage, translate};
use ltk_wad::Wad;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [wad_path, object_path, out_dir, rest @ ..] = args.as_slice() else {
        eprintln!("usage: translate <wad> <object path> <out dir> [--id N | NAME=VALUE ...]");
        std::process::exit(2);
    };
    let by_id: Option<u32> = match rest {
        [flag, id] if flag == "--id" => Some(id.parse().expect("--id takes a number")),
        _ => None,
    };
    let defines: Defines = rest
        .iter()
        .filter(|arg| !arg.starts_with("--"))
        .map(|arg| match arg.split_once('=') {
            Some((name, value)) => (name, value),
            None => (arg.as_str(), ""),
        })
        .collect();

    let mut wad = Wad::mount(BufReader::new(
        fs::File::open(wad_path).expect("the wad opens"),
    ))
    .expect("the wad mounts");
    let mut read = |path: &str| -> Vec<u8> {
        let chunk = *wad
            .chunks()
            .get(chunk_hash(path).into())
            .unwrap_or_else(|| panic!("no chunk {path}"));
        wad.load_chunk_decompressed(&chunk)
            .expect("the chunk reads")
            .into_vec()
    };
    fs::create_dir_all(out_dir).expect("the out dir");

    for stage in [Stage::Vertex, Stage::Pixel] {
        let toc_path = match object_path.split_once(',') {
            Some((vertex, pixel)) => ShaderPath::Hlsl { vertex, pixel }.toc_path(stage),
            None => toc_path(object_path, stage),
        };
        let toc = read_toc(&read(&toc_path)).expect("a TOC");
        let id = match by_id {
            Some(id) => id,
            None => permutation(&toc, &defines).unwrap_or_else(|| {
                panic!(
                    "no permutation for {defines}; the TOC declares {:?}",
                    toc.base_defines
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                )
            }),
        };
        let bundle = read(&bundle_path(&toc_path, id));
        let blob = record(&bundle, index_in_bundle(id)).expect("a record");
        let name = stage.abbreviation();
        let started = std::time::Instant::now();
        let translated = translate(blob, stage).unwrap_or_else(|e| panic!("{name} id {id}: {e}"));
        eprintln!(
            "{name}: id {id}, {} bytes of DXBC, {} lines of GLSL, {:?}, {:.1} ms",
            blob.len(),
            translated.glsl.lines().count(),
            translated.applied,
            started.elapsed().as_secs_f64() * 1000.0
        );
        let out = Path::new(out_dir);
        fs::write(out.join(format!("{name}.glsl")), &translated.glsl).expect("write glsl");
        fs::write(out.join(format!("{name}.dxbc")), blob).expect("write dxbc");
        fs::write(
            out.join(format!("{name}.json")),
            serde_json::to_string_pretty(&translated.sidecar).expect("json"),
        )
        .expect("write json");
    }
}
