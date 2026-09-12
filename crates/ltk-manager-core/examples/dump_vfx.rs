//! Print one object of a bin inside a WAD, so a system the viewport draws wrong can be read.
//!
//! ```text
//! cargo run -p ltk-manager-core --example dump_vfx -- <wad> <chunk path> <object path> [--json]
//! ```
//!
//! `--json` prints the resolved `VfxSystem` the viewport reads, with no names and no
//! assets located, which is what `readVfxSystem` takes. An object path of `*` lists every
//! object of the bin whose tree mentions the hash given as a fourth argument. A chunk path
//! of `*` scans every property bin of the WAD for the object, for a merged skin bin whose
//! name no hash list on hand carries, and names the chunk it found on stderr. Both `*` at
//! once, with a fourth argument, lists every object of the WAD whose path holds that text,
//! named through the app's own hash tables.

use std::io::Cursor;

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::bin_document::BinDocument;
use ltk_manager_core::hashtables::HashtableCache;
use ltk_manager_core::vfx::resolve_system;
use ltk_meta::BinFile;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|arg| arg == "--json");
    let plain: Vec<&String> = args.iter().filter(|arg| *arg != "--json").collect();
    let (wad_path, chunk_path, object_path, wanted_hash) = match plain.as_slice() {
        [wad, chunk, object] => (*wad, *chunk, *object, None),
        [wad, chunk, object, hash] => (*wad, *chunk, *object, Some(*hash)),
        _ => {
            eprintln!("usage: dump_vfx <wad> <chunk path> <object path | *> [hash] [--json]");
            std::process::exit(2);
        }
    };

    if chunk_path == "*" && object_path == "*" {
        let needle = wanted_hash.expect("text of the object path to search for");
        let file = fs::File::open(wad_path).expect("open wad");
        let mut wad = ltk_wad::Wad::mount(file).expect("mount wad");
        search(&mut wad, &needle.to_lowercase());
        return;
    }

    /* An object is named by its path, or by its hash as eight hex digits after `0x`. */
    let wanted = object_path
        .strip_prefix("0x")
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .map_or_else(|| BinHash::hash_str(object_path), BinHash);

    /* A loose `.bin` on disk reads as itself, and the chunk path is then unused. A chunk
     * path of `*` scans every property bin of the WAD for the object. */
    let bytes = if wad_path.ends_with(".bin") {
        fs::read(wad_path).expect("read bin")
    } else {
        let file = fs::File::open(wad_path).expect("open wad");
        let mut wad = ltk_wad::Wad::mount(file).expect("mount wad");
        if chunk_path == "*" {
            bin_holding(&mut wad, wanted)
        } else {
            let chunk_hash = ltk_modpkg::ChunkPath::new(chunk_path).hash().value();
            let chunk = *wad
                .chunks()
                .get(ltk_wad::WadHash(chunk_hash))
                .expect("chunk in wad");
            wad.load_chunk_decompressed(&chunk)
                .expect("read chunk")
                .into_vec()
        }
    };

    if json {
        let document = BinDocument::parse(&bytes).expect("parse bin");
        let system = resolve_system(&document, wanted, &(), &()).expect("resolve system");
        println!("{}", serde_json::to_string(&system).expect("serialize"));
        return;
    }

    let BinFile::Prop(bin) = BinFile::from_reader(&mut Cursor::new(&bytes[..])).expect("parse bin")
    else {
        panic!("not a property bin");
    };

    if object_path == "*" {
        /* Debug prints every hash as its decimal on a line of its own, comma after. */
        let needle = wanted_hash
            .and_then(|hash| u32::from_str_radix(hash.trim_start_matches("0x"), 16).ok())
            .map(|hash| format!("{hash},"));
        for (path, object) in &bin.objects {
            let text = format!("{object:#?}");
            let hit = needle
                .as_ref()
                .is_none_or(|needle| text.split_whitespace().any(|word| word == needle));
            if hit {
                println!("0x{:08x}\t0x{:08x}", path.0, object.class_hash.0);
            }
        }
        return;
    }

    let object = bin.objects.get(&wanted).unwrap_or_else(|| {
        panic!(
            "no object {object_path} ({wanted:?}) among {}",
            bin.objects.len()
        )
    });
    println!("{object:#?}");
}

/// The bytes of the first property bin in the WAD holding `wanted`, its chunk hash on stderr.
fn bin_holding<S: std::io::Read + std::io::Seek>(
    wad: &mut ltk_wad::Wad<S>,
    wanted: BinHash,
) -> Vec<u8> {
    let chunks: Vec<ltk_wad::WadChunk> = wad.chunks().iter().copied().collect();
    for chunk in chunks {
        let Ok(bytes) = wad.load_chunk_decompressed(&chunk) else {
            continue;
        };
        if !(bytes.starts_with(b"PROP") || bytes.starts_with(b"PTCH")) {
            continue;
        }
        let Ok(document) = BinDocument::parse(&bytes) else {
            continue;
        };
        if document.object_at(wanted).is_some() {
            eprintln!("chunk 0x{:016x}", chunk.path_hash().0);
            return bytes.into_vec();
        }
    }
    panic!("no property bin in the wad holds {wanted:?}");
}

/// Every object of every bin in the WAD whose path, as the hash tables name it, holds `needle`.
fn search<S: std::io::Read + std::io::Seek>(wad: &mut ltk_wad::Wad<S>, needle: &str) {
    let tables = HashtableCache::shared()
        .expect("hashtable cache")
        .bin_tables();
    let chunks: Vec<ltk_wad::WadChunk> = wad.chunks().iter().copied().collect();
    for chunk in chunks {
        let Ok(bytes) = wad.load_chunk_decompressed(&chunk) else {
            continue;
        };
        if !(bytes.starts_with(b"PROP") || bytes.starts_with(b"PTCH")) {
            continue;
        }
        let Ok(document) = BinDocument::parse(&bytes) else {
            continue;
        };
        for entry in document.entries() {
            let Some(name) = tables.entry(entry) else {
                continue;
            };
            if !name.to_lowercase().contains(needle) {
                continue;
            }
            let class = document
                .object_at(entry)
                .map_or(BinHash(0), |object| object.class_hash);
            let class_name = tables
                .class(class)
                .unwrap_or_else(|| format!("0x{:08x}", class.0));
            println!(
                "0x{:016x}\t0x{:08x}\t{class_name}\t{name}",
                chunk.path_hash().0,
                entry.0
            );
        }
    }
}
