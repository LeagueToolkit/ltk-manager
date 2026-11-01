//! Fixture builders the tests of every crate above share: archives, bins and banks on disk.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use fs_err as fs;
use ltk_manager_base::config::Config;

/// A project config whose `name` and display name are both `name`, so a slug
/// derived from it is predictable.
pub fn mod_project_named(name: &str) -> ltk_mod_project::ModProject {
    let mut project = ltk_mod_project::ModProject::default();
    project.name = name.to_string();
    project.display_name = name.to_string();
    project.version = "1.0.0".to_string();
    project.layers = ltk_mod_project::ModProjectLayer::default_table();
    project
}

/// A skeleton whose root joint `root` has `children`, as bytes.
pub fn skeleton_with_joints(root: &str, children: &[&str]) -> Vec<u8> {
    let joint = ltk_anim::Joint::builder(root)
        .with_children(children.iter().map(|name| ltk_anim::Joint::builder(*name)));
    let rig = ltk_anim::RigResource::builder("rig", "rig")
        .with_root_joint(joint)
        .build();

    let mut bytes = std::io::Cursor::new(Vec::new());
    rig.to_writer(&mut bytes).expect("write skeleton");
    bytes.into_inner()
}

/// Pack a real `.modpkg` at `path`, named `name`, holding one content file.
///
/// A modpkg's archive is the mod, so code that reads one has to mount it. A
/// stub of fake bytes does not exercise that code.
pub fn make_modpkg(path: &Path, name: &str) {
    make_modpkg_with_documents(path, name, None, None);
}

/// [`make_modpkg`] with a readme and a license in the project root, where a
/// creator's own pack also reads them from.
pub fn make_modpkg_with_documents(
    path: &Path,
    name: &str,
    readme: Option<&str>,
    license: Option<&str>,
) {
    pack_modpkg(path, name, readme, license, b"content bytes");
}

/// Pack a real `.modpkg` at `path`, named `name`, holding `bin` at
/// [`STALE_BIN_IN_WAD`] inside `Aatrox.wad.client` of the base layer.
///
/// The modpkg counterpart of [`make_bin_fantome_zip`], for a test that reads
/// the same content out of both formats.
pub fn make_bin_modpkg(path: &Path, name: &str, bin: &ltk_meta::Bin) {
    pack_modpkg(path, name, None, None, &bin_bytes(bin));
}

/// [`make_bin_modpkg`] with a readme and a license, for a test that reads the
/// package's documents back after a rewrite.
pub fn make_bin_modpkg_with_documents(
    path: &Path,
    name: &str,
    bin: &ltk_meta::Bin,
    readme: &str,
    license: &str,
) {
    pack_modpkg(path, name, Some(readme), Some(license), &bin_bytes(bin));
}

/// Pack a project holding `content` at [`STALE_BIN_IN_WAD`] inside
/// `Aatrox.wad.client` of the base layer, with the documents given.
fn pack_modpkg(
    path: &Path,
    name: &str,
    readme: Option<&str>,
    license: Option<&str>,
    content: &[u8],
) {
    let source = tempfile::tempdir().unwrap();
    let bin_path = source
        .path()
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join(STALE_BIN_IN_WAD);
    fs::create_dir_all(bin_path.parent().unwrap()).unwrap();
    fs::write(&bin_path, content).unwrap();
    fs::write(
        source.path().join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(name)).unwrap(),
    )
    .unwrap();
    if let Some(readme) = readme {
        fs::write(source.path().join("README.md"), readme).unwrap();
    }
    if let Some(license) = license {
        fs::write(source.path().join("LICENSE"), license).unwrap();
    }

    let project_dir = camino::Utf8PathBuf::from_path_buf(source.path().to_path_buf()).unwrap();
    let writer = std::io::BufWriter::new(fs::File::create(path).unwrap());
    ltk_mod_project::ProjectPacker::new(mod_project_named(name), project_dir)
        .pack(ltk_mod_project::modpkg::ModpkgFormat::new(writer))
        .unwrap();
}

/// [`make_named_fantome_zip`] with a readme and a license under `META/`, where
/// a fantome stores its documents and where nothing extracts them.
pub fn make_fantome_zip_with_documents(
    path: &Path,
    name: &str,
    readme: Option<&str>,
    license: Option<&str>,
) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    if let Some(readme) = readme {
        zip.start_file("META/README.md", options).unwrap();
        zip.write_all(readme.as_bytes()).unwrap();
    }
    if let Some(license) = license {
        zip.start_file("META/LICENSE", options).unwrap();
        zip.write_all(license.as_bytes()).unwrap();
    }

    zip.finish().unwrap();
}

/// Build a minimal but valid fantome archive: a zip whose only entry is
/// `META/info.json`.
pub fn make_fantome_zip(path: &Path) {
    make_named_fantome_zip(path, "Test Mod");
}

/// [`make_fantome_zip`] with the name the archive reports, which is what a
/// slug is derived from.
pub fn make_named_fantome_zip(path: &Path, name: &str) {
    write_fantome_info_zip(path, &fantome_info(name));
}

/// [`make_named_fantome_zip`] with the author and version the archive reports,
/// which is what tells one mod's versions apart.
pub fn make_versioned_fantome_zip(path: &Path, name: &str, author: &str, version: &str) {
    let mut info = fantome_info(name);
    info.author = author.to_string();
    info.version = version.to_string();

    write_fantome_info_zip(path, &info);
}

fn write_fantome_info_zip(path: &Path, info: &ltk_fantome::FantomeInfo) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(info).unwrap().as_bytes())
        .unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding all three content shapes at once: a
/// directory-style WAD, a packed WAD, and `RAW/`.
///
/// All three shapes are in one archive because the golden tests compare the
/// `(hash, bytes)` set of the archive with the set of its import. A shape the
/// fixture leaves out would pass without being tested.
pub fn make_full_fantome_zip(path: &Path) {
    make_full_fantome_zip_named(path, "Full Mod");
}

/// [`make_full_fantome_zip`] with the name the archive reports, which is what a
/// slug is derived from.
pub fn make_full_fantome_zip_named(path: &Path, name: &str) {
    let packed = build_packed_wad(&[
        ("data/characters/ashe/skins/skin01.bin", &[0x11u8; 48][..]),
        ("data/characters/ashe/ashe.bin", &[0x22u8; 32][..]),
    ]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file(
        "WAD/Aatrox.wad.client/data/characters/aatrox/skins/skin01.bin",
        options,
    )
    .unwrap();
    zip.write_all(b"aatrox skin bytes").unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.start_file("RAW/assets/maps/map11/scene.bin", options)
        .unwrap();
    zip.write_all(b"raw scene bytes").unwrap();

    zip.finish().unwrap();
}

/// [`make_full_fantome_zip`] with every CRC32 overwritten by a value that
/// matches nothing.
///
/// Some fantome tools write checksums that do not match the entry bytes, and a
/// reader that trusts them rejects the whole archive. The scan matches header
/// signatures anywhere in the file, so it asserts one local and one central
/// header per entry. A match inside compressed data would overwrite content and
/// change what a test using this fixture tests.
pub fn make_bad_crc_fantome_zip(path: &Path) {
    const LOCAL_HEADER: u32 = 0x0403_4b50;
    const CENTRAL_HEADER: u32 = 0x0201_4b50;
    const ENTRIES: usize = 4;

    make_full_fantome_zip(path);
    let mut bytes = fs::read(path).unwrap();

    let (mut local, mut central) = (0usize, 0usize);
    let mut i = 0usize;
    while i + 4 <= bytes.len() {
        // CRC32 sits at +14 in a local header and at +16 in a central one.
        let (at, seen) = match u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) {
            LOCAL_HEADER => (14, &mut local),
            CENTRAL_HEADER => (16, &mut central),
            _ => {
                i += 1;
                continue;
            }
        };
        bytes[i + at..i + at + 4].copy_from_slice(&0xDEAD_BEEFu32.to_le_bytes());
        *seen += 1;
        i += 4;
    }

    assert_eq!(local, ENTRIES, "one local header CRC per entry");
    assert_eq!(central, ENTRIES, "one central header CRC per entry");
    fs::write(path, bytes).unwrap();
}

/// A fantome archive whose `META/info.json` declares a second layer with a
/// string override. Only the metadata holds the override, so an import that
/// drops it loses it.
pub fn make_layered_fantome_zip(path: &Path) {
    let mut info = fantome_info("Layered Mod");
    info.layers.insert(
        "high_res".to_string(),
        ltk_fantome::FantomeLayerInfo {
            name: "high_res".to_string(),
            display_name: Some("High Res".to_string()),
            priority: 10,
            string_overrides: indexmap::IndexMap::from([(
                "en_us".to_string(),
                indexmap::IndexMap::from([(
                    "game_character_displayname_Ashe".to_string(),
                    "Frost Archer".to_string(),
                )]),
            )]),
            game_data: None,
        },
    );

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
        .unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding [`STALE_BIN_IN_WAD`] in three layers: `base_bin`
/// loose under `WAD/`, `layer_bin` loose under `WAD_chroma/`, which the
/// metadata declares as `Chroma`, and `layer_bin` in a packed WAD under
/// `WAD_zeta/`, which the metadata does not declare.
pub fn make_layer_wads_fantome_zip(
    path: &Path,
    base_bin: &ltk_meta::Bin,
    layer_bin: &ltk_meta::Bin,
) {
    let mut info = fantome_info("Layer WADs");
    info.layers.insert(
        "Chroma".to_string(),
        ltk_fantome::FantomeLayerInfo {
            name: "Chroma".to_string(),
            priority: 5,
            ..Default::default()
        },
    );
    let loose_path = format!("Aatrox.wad.client/{STALE_BIN_IN_WAD}");
    let packed = build_packed_wad(&[(STALE_BIN_IN_WAD, &bin_bytes(layer_bin))]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    let entries = [
        (
            "META/info.json".to_string(),
            serde_json::to_vec_pretty(&info).unwrap(),
        ),
        (format!("WAD/{loose_path}"), bin_bytes(base_bin)),
        (format!("WAD_chroma/{loose_path}"), bin_bytes(layer_bin)),
        ("WAD_zeta/Aatrox.wad.client".to_string(), packed),
    ];
    for (name, bytes) in entries {
        zip.start_file(name, options).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
}

/// The metadata of a fantome named `name`.
pub fn fantome_info(name: &str) -> ltk_fantome::FantomeInfo {
    let mut info = ltk_fantome::FantomeInfo::default();
    info.name = name.to_string();
    info.author = "Author".to_string();
    info.version = "1.0.0".to_string();
    info.description = "Description".to_string();
    info
}

/// A chunk path much longer than the hex name a preflight assumes for a packed
/// WAD, so an import that resolves it writes a longer path than predicted.
pub const LONG_CHUNK_PATH: &str =
    "data/characters/ashe/skins/skin01/particles/ashe_base_r_cas_ring_glow.troybin";

/// An archive whose only content is a packed WAD holding [`LONG_CHUNK_PATH`].
///
/// The chunk is the longest path the import writes, so any difference between
/// the estimate and the written tree comes from that chunk alone.
pub fn make_long_chunk_fantome_zip(path: &Path) {
    let packed = build_packed_wad(&[(LONG_CHUNK_PATH, &[0x33u8; 16][..])]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Long Chunk Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/// Where the incompressible chunk sits inside its WAD.
pub const LARGE_BLOCK_CHUNK_PATH: &str = "data/characters/ashe/blob.bin";

/// An archive whose one packed WAD holds a chunk the first prefix read cannot
/// decode any bytes of.
///
/// A bounded read first takes 16 KB of a chunk raw. A compressed block cannot
/// be decoded until all of it has been read, and this chunk compresses to one
/// block several times that size, so the first read decodes nothing and the
/// larger second read returns the bytes. The return value is the chunk's
/// uncompressed content.
pub fn make_large_block_chunk_fantome_zip(path: &Path) -> Vec<u8> {
    let bytes = half_entropy_bytes(256 * 1024);

    let mut out = std::io::Cursor::new(Vec::new());
    ltk_wad::WadBuilder::default()
        .with_chunk(
            ltk_wad::WadChunkBuilder::default()
                .with_path(LARGE_BLOCK_CHUNK_PATH)
                .with_force_compression(ltk_wad::WadChunkCompression::Zstd),
        )
        .build_to_writer(&mut out, |_, cursor| {
            cursor.write_all(&bytes)?;
            Ok(())
        })
        .unwrap();

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Large Block Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&out.into_inner()).unwrap();

    zip.finish().unwrap();
    bytes
}

/// Bytes that compress to about half their size, generated from a fixed seed
/// so every run of a test reads the same chunk.
///
/// Each byte holds four bits of entropy. With that, zstd writes a compressed
/// block instead of storing the bytes raw, and the block stays large.
fn half_entropy_bytes(len: usize) -> Vec<u8> {
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state as u8) & 0x0f
        })
        .collect()
}

/// An archive holding a loose WAD file beside a dot-file the directory walk
/// would skip.
///
/// The walk skips any entry whose name starts with a dot, so the archive scan
/// has to skip them too for a tree and an archive to list the same files.
pub fn make_dot_file_fantome_zip(path: &Path) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Dotted Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client/data/visible.bin", options)
        .unwrap();
    zip.write_all(b"visible").unwrap();
    zip.start_file("WAD/Ashe.wad.client/data/.hidden.bin", options)
        .unwrap();
    zip.write_all(b"hidden").unwrap();

    zip.finish().unwrap();
}

/// An archive whose manifest declares a hashtable file the archive does not
/// hold.
///
/// Its chunks cannot be named the way the manifest declares, so an import
/// refuses it. A check that accepts it names chunks differently from the
/// repair that follows.
pub fn make_missing_hashtable_fantome_zip(path: &Path) {
    let mut info = fantome_info("Missing Table Mod");
    info.hashtables = vec![ltk_fantome::FantomeHashtable {
        path: "META/hashes/game.hashes.txt".to_string(),
        category: ltk_hashtable::Category::Game,
        algorithm: ltk_hashtable::Algorithm::Xxh64,
        bits: 64,
    }];

    let packed = build_packed_wad(&[("data/skin0.bin", &b"PROP"[..])]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
        .unwrap();
    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/// An archive whose packed WAD holds one texture chunk and one bin, where the
/// bin's strings are the only record of the texture's path.
pub fn make_bin_named_chunk_fantome_zip(path: &Path, recovered_path: &str) {
    let mut bin = b"PROP".to_vec();
    bin.extend_from_slice(&2u32.to_le_bytes());
    bin.extend_from_slice(&1u32.to_le_bytes());
    bin.extend_from_slice(&(recovered_path.len() as u16).to_le_bytes());
    bin.extend_from_slice(recovered_path.as_bytes());

    let packed = build_packed_wad(&[
        (recovered_path, &b"texture payload"[..]),
        ("data/anonymous.bin", &bin[..]),
    ]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info("Bin Named Mod"))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Ashe.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();

    zip.finish().unwrap();
}

/* Fixtures for the mod-health tests: a bin the shipped migration table
flags, archives and trees holding it, and a game install that makes the rule
active. The repair and check suites both use them to test the same defect. */

/// `SkinCharacterDataProperties`, the class the shipped migration table keys on.
pub const SKIN_CLASS: ltk_hash::BinHash = ltk_hash::BinHash(0x9b67_e9f6);
/// The object that holds the stale-bin fixtures' property.
pub const STALE_ENTRY: ltk_hash::BinHash = ltk_hash::BinHash(0x1234_5678);
/// `iconAvatar`, a field the table moves from `String` to `File`.
pub const ICON_AVATAR: ltk_hash::BinHash = ltk_hash::BinHash(0x089a_ff69);
pub const STALE_ICON: &str = "ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds";

/// Where the fixture bin sits, inside the archive and in the unpacked tree.
pub const STALE_BIN_IN_WAD: &str = "data/skin0.bin";

pub fn bin_bytes(bin: &ltk_meta::Bin) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A bin still declaring the old `String` shape for a migrated field.
pub fn stale_bin() -> ltk_meta::Bin {
    bin_holding(ltk_meta::property::values::String::new(
        STALE_ICON.to_owned(),
    ))
}

/// A bin already carrying the migrated shape, which the rules do not report.
pub fn healthy_bin() -> ltk_meta::Bin {
    use ltk_hash::Hash as _;
    bin_holding(ltk_meta::property::values::WadChunkLink::new(
        ltk_wad::WadHash::hash_str(STALE_ICON),
    ))
}

fn bin_holding(value: impl Into<ltk_meta::PropertyValueEnum>) -> ltk_meta::Bin {
    ltk_meta::Bin::new(
        [ltk_meta::BinObject::builder(STALE_ENTRY, SKIN_CLASS)
            .property(ICON_AVATAR, value)
            .build()],
        std::iter::empty::<&str>(),
    )
}

/// A fantome archive holding one directory-style WAD entry with `bin`'s bytes.
pub fn make_bin_fantome_zip(path: &Path, name: &str, bin: &ltk_meta::Bin) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("WAD/Aatrox.wad.client/{STALE_BIN_IN_WAD}"), options)
        .unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding `bin` as a loose entry at `at`, verbatim.
///
/// For the paths Riot itself uses that carry no extension, which an archive
/// scan can only identify by reading the entry's head.
pub fn make_loose_bin_fantome_zip_at(path: &Path, name: &str, at: &str, bin: &ltk_meta::Bin) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("WAD/{at}"), options).unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive holding `bin` as a `RAW/` entry.
///
/// An unpack writes `RAW/` entries under the base layer, so a rule sees them,
/// and the archive reader has to list them there too.
pub fn make_raw_bin_fantome_zip(path: &Path, name: &str, bin: &ltk_meta::Bin) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    zip.start_file(format!("RAW/{STALE_BIN_IN_WAD}"), options)
        .unwrap();
    zip.write_all(&bin_bytes(bin)).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one WAD is packed into a single entry holding
/// `bin`.
///
/// `compression` picks how the archive reader reaches the WAD: a stored entry
/// is read chunk by chunk in place, and a deflated one is inflated whole first.
pub fn make_packed_bin_fantome_zip(
    path: &Path,
    name: &str,
    bin: &ltk_meta::Bin,
    compression: zip::CompressionMethod,
) {
    let packed = build_packed_wad(&[(STALE_BIN_IN_WAD, &bin_bytes(bin))]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file(
        "WAD/Aatrox.wad.client",
        options.compression_method(compression),
    )
    .unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one packed WAD holds `bytes` under `chunk_path`.
///
/// The shape of [`make_packed_bin_fantome_zip`] with any chunk content, for a
/// rule about a file that is not a bin.
pub fn make_packed_chunk_fantome_zip(path: &Path, name: &str, chunk_path: &str, bytes: &[u8]) {
    let packed = build_packed_wad(&[(chunk_path, bytes)]);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Aatrox.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// A fantome archive whose one packed WAD holds each of `chunks`.
pub fn make_packed_chunks_fantome_zip(path: &Path, name: &str, chunks: &[(&str, &[u8])]) {
    let packed = build_packed_wad(chunks);

    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(
        serde_json::to_string_pretty(&fantome_info(name))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();

    zip.start_file("WAD/Aatrox.wad.client", options).unwrap();
    zip.write_all(&packed).unwrap();
    zip.finish().unwrap();
}

/// Put an archive holding `chunks` into the installed game the config points
/// at, for a rule that asks what the install holds.
///
/// `root` is the same directory [`point_at_build`] was given, so both use the
/// same install.
pub fn place_game_wad(root: &Path, wad_name: &str, chunks: &[(&str, &[u8])]) {
    let final_dir = root.join("league").join("Game").join("DATA").join("FINAL");
    fs::create_dir_all(&final_dir).unwrap();
    fs::write(final_dir.join(wad_name), build_packed_wad(chunks)).unwrap();
}

/// Where the silent-bank fixture sits inside its WAD.
pub const SILENT_BANK_IN_WAD: &str = "assets/sounds/wwise2016/sfx/ashe_sfx_events.bnk";

/// The bytes `bank` writes.
///
/// A fixture bank is built with `ltk_wwise`, so it cannot drift from the reader that judges it.
pub fn audio_bank_bytes(bank: &ltk_wwise::Bank) -> Vec<u8> {
    let mut out = Vec::new();
    bank.to_writer(&mut out).unwrap();
    out
}

/// The id a bank the Wwise toolchain built carries.
///
/// Any nonzero value works. A fixture needs a bank that `audio/bank-id` does
/// not report, and the specific number has no meaning.
pub const BUILT_BANK_ID: u32 = 0x3921_0873;

/// A version 134 event bank the client ships, with objects of kinds 2, 3, 4, 5, 7 and 14.
///
/// The `ltk-manager-audio` fixture `events_v134.bnk`. The client rejects it, and
/// `Bank::upgrade` converts it.
pub const LEGACY_EVENT_BANK: &[u8] =
    include_bytes!("../../ltk-manager-audio/tests/fixtures/events_v134.bnk");

/// A bank the game drops without an error: a version 134 bank with a `HIRC`
/// chunk, which the reader accepts only at the current version.
pub fn silent_audio_bank() -> Vec<u8> {
    use ltk_wwise::bank::{BankHeader, BankVersion, Section};

    let mut bank = ltk_wwise::Bank::new(BankHeader::new(
        BankVersion::V134,
        ltk_wwise::BankId(BUILT_BANK_ID),
    ));
    bank.sections_mut()
        .push(Section::Hierarchy(ltk_wwise::Hierarchy::new()));
    audio_bank_bytes(&bank)
}

/// Point the config at a game install on the build the shipped table names,
/// so the rule is active rather than dormant.
pub fn point_at_installed_build(config: &mut Config, root: &Path) {
    point_at_build(config, root, "16.17.8087655");
}

/// [`point_at_installed_build`] on a build of the caller's choosing, for a test
/// about what changes when the game updates.
pub fn point_at_build(config: &mut Config, root: &Path, version: &str) {
    let league = root.join("league");
    fs::create_dir_all(league.join("Game")).unwrap();
    fs::write(
        league.join("Game").join("content-metadata.json"),
        format!(r#"{{ "version": "{version}" }}"#),
    )
    .unwrap();
    config.league_path = Some(league);
}

/// A resolver that names `paths`, so a packed WAD's chunks land under them
/// rather than under the hex names an empty one leaves them at.
pub fn resolver_naming(paths: &[&str]) -> crate::hashtables::WadPathResolver {
    let mut db = ltk_hashdb::LayeredHashDb::new();
    for path in paths {
        db.insert(ltk_wad::WadHash::from(*path).0, *path);
    }
    crate::hashtables::WadPathResolver::new(db)
}

/// A packed WAD holding `chunks`, as bytes ready to drop into a zip entry.
pub fn build_packed_wad(chunks: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = ltk_wad::WadBuilder::default();
    for (path, _) in chunks {
        builder = builder.with_chunk(ltk_wad::WadChunkBuilder::default().with_path(*path));
    }

    let by_hash: HashMap<u64, &[u8]> = chunks
        .iter()
        .map(|(path, bytes)| (ltk_wad::WadHash::from(*path).0, *bytes))
        .collect();

    let mut out = std::io::Cursor::new(Vec::new());
    builder
        .build_to_writer(&mut out, |path_hash, cursor| {
            cursor.write_all(by_hash[&path_hash.0])?;
            Ok(())
        })
        .unwrap();
    out.into_inner()
}

/// A mod project at `dir` named `name`: `bin` sits in the unpacked tree, and no archive exists
/// beside it.
pub fn place_bin_project(dir: &Path, name: &str, bin: &ltk_meta::Bin) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named(name)).unwrap(),
    )
    .unwrap();

    let wad_dir = dir.join("content").join("base").join("Aatrox.wad.client");
    fs::create_dir_all(wad_dir.join("data")).unwrap();
    fs::write(wad_dir.join(STALE_BIN_IN_WAD), bin_bytes(bin)).unwrap();
}
