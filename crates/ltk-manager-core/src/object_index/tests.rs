//! The harness every suite of the bin object index shares: a synthetic install,
//! the names a test hands it, and the readings a suite asserts on.

use super::search::ClassTerm;
use super::*;
use crate::game_index::GameIndex;
use crate::game_wads::GameArchives;
use fs_err as fs;
use ltk_hash::Hash as _;
use ltk_hashdb::LayeredHashDb;
use ltk_meta::path::PropertyPath;
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject, BinOverride, PropertyPatch};
use ltk_wad::{WadBuilder, WadChunkBuilder};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Cursor, Write as _};
use tempfile::TempDir;

mod browse;
mod build;
mod class_reads;
mod declarations;
mod names;
mod references;
mod search;
mod state;
mod walk;

/// One chunk of a synthetic archive: its path and its bytes.
type Chunk<'a> = (&'a str, Vec<u8>);
/// The key the `game` table would file this path under.
fn path_hash(path: &str) -> u64 {
    crate::hashtables::Table::Game.key_config().hash(path)
}
/// A `PROP` declaring `objects`, each as `(object path, class name)`.
fn prop(objects: &[(&str, &str)]) -> Vec<u8> {
    let bin = Bin::new(
        objects
            .iter()
            .map(|(path, class)| BinObject::new(BinHash::hash_str(path), BinHash::hash_str(class))),
        std::iter::empty::<&str>(),
    );
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}
/// A `PTCH` adding `objects` and carrying one patch record on `patched`.
fn patch(objects: &[(&str, &str)], patched: &str) -> Vec<u8> {
    let mut bin = BinOverride::new();
    for (path, class) in objects {
        let object = BinObject::new(BinHash::hash_str(path), BinHash::hash_str(class));
        bin.objects.insert(object.path_hash, object);
    }
    bin.patches.push(PropertyPatch::new(
        BinHash::hash_str(patched),
        PropertyPath::new("mValue").unwrap(),
        values::U32::new(2),
    ));
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}
/// A game directory holding `wads`, each a list of chunks.
fn game_with(wads: &[(&str, &[Chunk<'_>])]) -> TempDir {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("DATA").join("FINAL");
    fs::create_dir_all(&dir).unwrap();

    for (name, chunks) in wads {
        let path = dir.join(name);
        let mut builder = WadBuilder::default();
        for (chunk_path, _) in *chunks {
            builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        }
        let mut file = fs::File::create(&path).unwrap();
        builder
            .build_to_writer(&mut file, |hash, cursor| {
                let bytes = chunks
                    .iter()
                    .find(|(chunk_path, _)| WadHash::hash_str(chunk_path) == hash)
                    .map(|(_, bytes)| bytes.as_slice())
                    .unwrap();
                cursor.write_all(bytes)?;
                Ok(())
            })
            .unwrap();
    }
    tmp
}
/// Every chunk path of `wads`, which is what the resolver names.
fn paths_of<'a>(wads: &[(&str, &'a [Chunk<'a>])]) -> Vec<&'a str> {
    wads.iter()
        .flat_map(|(_, chunks)| chunks.iter().map(|(path, _)| *path))
        .collect()
}
fn resolver_for(paths: &[&str]) -> LayeredHashDb {
    let mut resolver = LayeredHashDb::new();
    for path in paths {
        resolver.insert(path_hash(path), *path);
    }
    resolver
}
/// The object index over `wads`, built on `workers` threads, with no names.
fn build(wads: &[(&str, &[Chunk<'_>])], workers: usize) -> (TempDir, ObjectIndex) {
    let tmp = game_with(wads);
    let archives = GameArchives::at(tmp.path());
    let game = GameIndex::build(&archives, &resolver_for(&paths_of(wads))).unwrap();
    let index = ObjectIndex::build(&game, &archives, workers, &|| false).unwrap();
    (tmp, index)
}
/// Each row as `(object path, class name, declaring file)`, in row order.
fn declared(index: &ObjectIndex) -> Vec<(BinHash, BinHash, String)> {
    index.rows().collect()
}
fn row(object: &str, class: &str, file: &str) -> (BinHash, BinHash, String) {
    (
        BinHash::hash_str(object),
        BinHash::hash_str(class),
        file.to_owned(),
    )
}
/// Names a test hands the index, in place of the mimir tables.
struct TestNames {
    entries: HashMap<BinHash, String>,
    classes: HashMap<BinHash, String>,
    files: HashMap<WadHash, String>,
}
impl TestNames {
    fn over(entries: &[&str], classes: &[&str]) -> Self {
        Self {
            entries: entries
                .iter()
                .map(|path| (BinHash::hash_str(path), (*path).to_owned()))
                .collect(),
            classes: classes
                .iter()
                .map(|class| (BinHash::hash_str(class), (*class).to_owned()))
                .collect(),
            files: HashMap::new(),
        }
    }

    /// The same names, with `paths` naming declaring chunks too.
    fn with_files(mut self, paths: &[&str]) -> Self {
        self.files = paths
            .iter()
            .map(|path| (WadHash::hash_str(path), (*path).to_owned()))
            .collect();
        self
    }
}
impl ObjectNames for TestNames {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if let Some(name) = self.entries.get(hash) {
                visit(at, name);
            }
        }
    }

    fn class(&self, hash: BinHash) -> Option<String> {
        self.classes.get(&hash).cloned()
    }

    fn for_each_file(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if let Some(path) = self.files.get(hash) {
                visit(at, path);
            }
        }
    }
}
/// An index over `objects` as `(object path, class)`, all in one file, named.
fn named_index(objects: &[(&str, &str)]) -> (TempDir, ObjectIndex) {
    let chunks: &[Chunk<'_>] = &[("data/objects.bin", prop(objects))];
    let (tmp, index) = build(&[("Objects.wad.client", chunks)], 1);
    let paths: Vec<&str> = objects.iter().map(|(path, _)| *path).collect();
    let classes: Vec<&str> = objects.iter().map(|(_, class)| *class).collect();
    let index = index.named(&TestNames::over(&paths, &classes));
    (tmp, index)
}
/// The object path of each hit, in the order the search ranked them.
fn ranked(index: &ObjectIndex, query: &str) -> Vec<String> {
    index
        .search(query, || false)
        .hits
        .into_iter()
        .map(|hit| hit.path)
        .collect()
}
