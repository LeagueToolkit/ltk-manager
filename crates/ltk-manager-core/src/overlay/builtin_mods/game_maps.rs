//! The map skins the game's map archives define, and the containers they draw with.

use crate::error::{AppError, AppResult};
use crate::utils::game::{GameDir, archive_stem};
use fs_err as fs;
use ltk_hash::BinHash;
use ltk_meta::{Bin, BinObject, PropertyValueEnum};
use ltk_wad::{Wad, WadHash};
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};

/// The TFT map, whose skins are boards chosen by a set rather than by a map skin name.
const TFT: &str = "map22";

/// A map's bin, and the skins its `Map` object links, in link order.
#[derive(Debug, Clone)]
pub(super) struct MapBin {
    /// The archive holding the bin, such as `Map11.wad.client`.
    pub(super) archive: String,
    /// Where that archive is on disk.
    pub(super) archive_path: PathBuf,
    /// `data/maps/shipping/<map>/<map>.bin`, the map lowercased.
    pub(super) chunk_path: String,
    pub(super) skins: Vec<MapSkin>,
}

/// One `MapSkin` object a map links.
#[derive(Debug, Clone)]
pub(super) struct MapSkin {
    /// The object's entry as a declaration names it: its path where that hashes to it, else
    /// its hash.
    pub(super) entry: String,
    /// The `name` the server's map skin name matches, byte for byte.
    pub(super) name: String,
    pub(super) object: BinObject,
    /// Whether the map archive holds the geometry and materials of the skin's container.
    pub(super) complete: bool,
    /// `data/<container>.materials.bin`, lowercased, where the map archive holds it.
    pub(super) materials: Option<String>,
}

impl MapBin {
    /// The skin a server naming `name` selects, the first linked where two share it.
    pub(super) fn skin(&self, name: &str) -> Option<&MapSkin> {
        self.skins.iter().find(|skin| skin.name == name)
    }

    /// Each container materials bin a linked skin draws with, once each, in link order.
    pub(super) fn materials(&self) -> Vec<&str> {
        let mut materials: Vec<&str> = Vec::new();
        for path in self
            .skins
            .iter()
            .filter_map(|skin| skin.materials.as_deref())
        {
            if !materials.contains(&path) {
                materials.push(path);
            }
        }
        materials
    }

    /// Each of `chunk_paths` the map archive holds, read as a bin. One that does not read is
    /// passed over.
    ///
    /// # Errors
    ///
    /// Fails when the map archive cannot be opened or mounted.
    pub(super) fn read_bins(&self, chunk_paths: &[&str]) -> AppResult<Vec<(String, Bin)>> {
        let mut archive = self.open()?;
        let mut bins = Vec::new();
        for chunk_path in chunk_paths {
            match read_bin(&mut archive.0, chunk_path) {
                Ok(Some(bin)) => bins.push(((*chunk_path).to_owned(), bin)),
                Ok(None) => {}
                Err(e) => tracing::warn!("Built-in mods: passing over {chunk_path}: {e}"),
            }
        }
        Ok(bins)
    }

    /// The map archive, mounted to read chunks by path.
    ///
    /// # Errors
    ///
    /// Fails when the map archive cannot be opened or mounted.
    pub(super) fn open(&self) -> AppResult<MapArchive> {
        Ok(MapArchive(mount(&self.archive_path)?))
    }
}

/// A map archive, mounted to read its chunks by path.
pub(super) struct MapArchive(MountedWad);

impl MapArchive {
    /// The checksum of the chunk at `chunk_path` in the archive's table, where it holds one.
    pub(super) fn checksum(&self, chunk_path: &str) -> Option<u64> {
        self.0
            .chunks()
            .get(WadHash::from(chunk_path))
            .map(|chunk| chunk.checksum())
    }

    /// The bytes of the chunk at `chunk_path`, and none where the archive does not hold it.
    ///
    /// # Errors
    ///
    /// Fails when the chunk cannot be read or decompressed.
    pub(super) fn read(&mut self, chunk_path: &str) -> AppResult<Option<Vec<u8>>> {
        let Some(chunk) = self.0.chunks().get(WadHash::from(chunk_path)).copied() else {
            return Ok(None);
        };

        Ok(Some(Vec::from(self.0.load_chunk_decompressed(&chunk)?)))
    }
}

type MountedWad = Wad<BufReader<fs::File>>;

fn mount(path: &Path) -> AppResult<MountedWad> {
    Ok(Wad::mount(BufReader::new(fs::File::open(path)?))?)
}

/// The bin at `chunk_path` in `wad`, and none where the archive does not hold it.
fn read_bin(wad: &mut MountedWad, chunk_path: &str) -> AppResult<Option<Bin>> {
    let Some(chunk) = wad.chunks().get(WadHash::from(chunk_path)).copied() else {
        return Ok(None);
    };

    let bytes = wad.load_chunk_decompressed(&chunk)?;
    let bin = Bin::from_reader(&mut Cursor::new(&bytes[..]))
        .map_err(|e| AppError::Other(format!("{chunk_path} does not read: {e}")))?;
    Ok(Some(bin))
}

/// Each map with a bin in an unlocalized map archive under `game_dir`, TFT's aside.
///
/// An archive that does not mount, and a bin that does not read, are passed over.
///
/// # Errors
///
/// Fails when the maps directory cannot be listed.
pub(super) fn read(game_dir: &GameDir) -> AppResult<Vec<MapBin>> {
    let mut maps = Vec::new();
    for (archive, path) in game_dir.map_archives()? {
        let map = archive_stem(&archive).to_owned();
        if map.contains('.') || map.eq_ignore_ascii_case(TFT) {
            continue;
        }
        match read_map(&archive, &map, &path) {
            Ok(Some(bin)) => maps.push(bin),
            Ok(None) => {}
            Err(e) => tracing::warn!("Built-in mods: passing over {}: {e}", path.display()),
        }
    }
    Ok(maps)
}

fn read_map(archive: &str, map: &str, path: &Path) -> AppResult<Option<MapBin>> {
    let mut wad = mount(path)?;
    let lower = map.to_ascii_lowercase();
    let chunk_path = format!("data/maps/shipping/{lower}/{lower}.bin");
    let Some(bin) = read_bin(&mut wad, &chunk_path)? else {
        return Ok(None);
    };

    let holds = |path: String| wad.chunks().contains(WadHash::from(path.as_str()));
    let skins = linked_skins(&bin)
        .map(|object| {
            let name = text(object, "name").unwrap_or_default().to_owned();
            let container = text(object, "mMapContainerLink").unwrap_or_default();
            let materials = format!("data/{container}.materials.bin").to_ascii_lowercase();
            let has_materials = !container.is_empty() && holds(materials.clone());
            MapSkin {
                entry: entry_name(map, &name, object.path_hash),
                complete: has_materials && holds(format!("data/{container}.mapgeo")),
                materials: has_materials.then_some(materials),
                name,
                object: object.clone(),
            }
        })
        .collect();
    Ok(Some(MapBin {
        archive: archive.to_owned(),
        archive_path: path.to_owned(),
        chunk_path,
        skins,
    }))
}

/// Each `MapSkin` the bin's `Map` object links in `mapSkins`, where the bin defines it.
fn linked_skins(bin: &Bin) -> impl Iterator<Item = &BinObject> {
    let map_skin = BinHash::from("MapSkin");
    bin.objects
        .values()
        .filter(|object| object.class_hash == BinHash::from("Map"))
        .filter_map(|map| match map.properties.get(&BinHash::from("mapSkins")) {
            Some(PropertyValueEnum::Container(links)) => Some(links.items()),
            Some(PropertyValueEnum::UnorderedContainer(links)) => Some(links.items()),
            _ => None,
        })
        .flatten()
        .filter_map(|link| match link {
            PropertyValueEnum::ObjectLink(link) => bin.objects.get(&link.value),
            _ => None,
        })
        .filter(move |object| object.class_hash == map_skin)
}

fn text<'a>(object: &'a BinObject, field: &str) -> Option<&'a str> {
    match object.properties.get(&BinHash::from(field))? {
        PropertyValueEnum::String(value) => Some(&value.value),
        _ => None,
    }
}

/// `Maps/Shipping/<map>/MapSkins/<name>` where that path hashes to `hash`, else `0x` and its
/// eight hexadecimal digits.
pub(super) fn entry_name(map: &str, name: &str, hash: BinHash) -> String {
    let path = format!("Maps/Shipping/{map}/MapSkins/{name}");
    if BinHash::from(path.as_str()) == hash {
        path
    } else {
        format!("0x{:08x}", hash.0)
    }
}
