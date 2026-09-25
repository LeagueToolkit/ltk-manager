//! Resolve every VFX system of every property bin in some WADs, for the particle shader sweep.
//!
//! ```text
//! cargo run --release -p ltk-manager-core --example vfx_systems -- <out.jsonl> <wad>...
//! ```
//!
//! One JSON line per `VfxSystemDefinitionData`, the resolved `VfxSystem` that
//! `readVfxSystem` takes, with no names and no assets located. A system the resolver refuses
//! is counted on stderr and left out.

use std::io::{BufWriter, Write as _};

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::bin_document::BinDocument;
use ltk_manager_core::vfx::resolve_system;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out_path, wads @ ..] = args.as_slice() else {
        eprintln!("usage: vfx_systems <out.jsonl> <wad>...");
        std::process::exit(2);
    };

    let system_class = BinHash::hash_str("VfxSystemDefinitionData");
    let mut out = BufWriter::new(fs::File::create(out_path).expect("create the output"));
    let mut written = 0usize;
    let mut refused = 0usize;

    for wad_path in wads {
        let mut wad =
            ltk_wad::Wad::mount(fs::File::open(wad_path).expect("open wad")).expect("mount wad");
        let chunks: Vec<ltk_wad::WadChunk> = wad.chunks().iter().copied().collect();
        let before = written;

        for chunk in chunks {
            let Ok(bytes) = wad.load_chunk_decompressed(&chunk) else {
                continue;
            };
            if !(bytes.starts_with(b"PROP") || bytes.starts_with(b"PTCH")) {
                continue;
            }
            let Ok(document) = BinDocument::parse(bytes) else {
                continue;
            };

            let systems: Vec<BinHash> = document
                .entries()
                .filter(|entry| {
                    document
                        .object_at(*entry)
                        .is_some_and(|object| object.class_hash == system_class)
                })
                .collect();
            for entry in systems {
                let Ok(system) = resolve_system(&document, entry, &(), &(), None) else {
                    refused += 1;
                    continue;
                };
                serde_json::to_writer(&mut out, &system).expect("serialize the system");
                out.write_all(b"\n").expect("write the system");
                written += 1;
            }
        }
        eprintln!("{wad_path}: {} systems", written - before);
    }

    out.flush().expect("flush the output");
    eprintln!("{written} systems written, {refused} refused");
}
