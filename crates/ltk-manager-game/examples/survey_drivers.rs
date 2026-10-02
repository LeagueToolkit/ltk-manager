//! Count the classes shipped shimmer emitters hold, and write their driver graphs as fixtures.
//!
//! Walks every property bin of every WAD given, or of every WAD under a directory given.
//! Prints a TSV of `hash<TAB>name<TAB>objects<TAB>wads` over every class found under a
//! `shimmerEmitterDefinitionData` list, which a reader diffs against the last patch's run.
//!
//! ```text
//! cargo run -p ltk-manager-game --release --example survey_drivers -- [--fixtures <out.json>] <wad | directory>...
//! ```
//!
//! `--fixtures` also writes every driver graph of those emitters as the resolved `VfxValue`
//! that `readDriver` takes. A graph is a `Vfx*DynamicProperty` or a `materialDrivers`
//! entry. Identical graphs are written once, with how many times they occur and the path
//! of the first.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use fs_err as fs;
use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::bin_document::{BinDocument, RowNames};
use ltk_manager_core::hashing::named;
use ltk_manager_core::hashtables::{BinHashTables, HashtableCache};
use ltk_manager_game::vfx::{VfxValue, resolve_system};
use ltk_meta::property::values;
use ltk_meta::{BinObject, PropertyValueEnum};
use ltk_wad::WadHash;
use serde::Serialize;

/// `shimmerEmitterDefinitionData`, the list of `VfxSystemDefinitionData` holding shimmer emitters.
const SHIMMER_LIST: BinHash = named("shimmerEmitterDefinitionData");

/// `disabled` of `VfxShimmerEmitterDefinitionData`.
const DISABLED: BinHash = named("disabled");

/// How deep the walk descends, which is the bound `vfx::resolve` already holds to.
const MAX_DEPTH: usize = 64;

/// The classes a driver graph starts at.
const GRAPH_ROOTS: [&str; 4] = [
    "VfxFloatDynamicProperty",
    "VfxVector2DynamicProperty",
    "VfxVector3DynamicProperty",
    "VfxVector4DynamicProperty",
];

/// What the walk has counted so far.
#[derive(Default)]
struct Census {
    wads: usize,
    /// Property bins the document reader refused, whose emitters go uncounted.
    unreadable: usize,
    emitters: usize,
    disabled: usize,
    /// Objects of each class under a shimmer list.
    objects: HashMap<BinHash, usize>,
    /// The WADs each class was found in.
    found_in: HashMap<BinHash, HashSet<usize>>,
}

/// One distinct driver graph, as the fixture file holds it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    /// Where the graph first occurs: the emitter's name, then each field or index below it.
    path: String,
    /// How many times the same graph occurs across the systems read.
    count: usize,
    graph: VfxValue,
}

/// The fixture file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    /// The WAD files the graphs were read out of, by file name.
    sources: Vec<String>,
    graphs: Vec<Fixture>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (fixtures_path, inputs) = match args.as_slice() {
        [flag, out, rest @ ..] if flag == "--fixtures" => (Some(out.clone()), rest.to_vec()),
        rest => (None, rest.to_vec()),
    };
    if inputs.is_empty() {
        eprintln!("usage: survey_drivers [--fixtures <out.json>] <wad | directory>...");
        std::process::exit(2);
    }

    let wads: Vec<PathBuf> = inputs.iter().flat_map(|it| wads(Path::new(it))).collect();
    eprintln!("reading {} WAD files", wads.len());

    let tables = HashtableCache::shared()
        .expect("hashtable cache")
        .bin_tables();
    let names = Names(&tables);
    let roots: HashSet<String> = GRAPH_ROOTS
        .iter()
        .map(|name| hex(BinHash::hash_str(name)))
        .collect();

    let mut census = Census::default();
    let mut graphs: IndexMap<String, Fixture> = IndexMap::new();
    let mut sources = Vec::new();

    for (index, path) in wads.iter().enumerate() {
        let Ok(file) = fs::File::open(path) else {
            continue;
        };
        let Ok(mut wad) = ltk_wad::Wad::mount(file) else {
            continue;
        };
        census.wads += 1;
        let before = graphs.len();

        let chunks: Vec<ltk_wad::WadChunk> = wad.chunks().iter().copied().collect();
        for chunk in chunks {
            let Ok(bytes) = wad.load_chunk_decompressed(&chunk) else {
                continue;
            };
            if !(bytes.starts_with(b"PROP") || bytes.starts_with(b"PTCH")) {
                continue;
            }
            let Ok(document) = BinDocument::parse(bytes) else {
                census.unreadable += 1;
                continue;
            };

            let systems: Vec<BinHash> = document
                .entries()
                .filter(|entry| {
                    document
                        .object_at(*entry)
                        .is_some_and(|object| census.object(object, index))
                })
                .collect();

            if fixtures_path.is_none() {
                continue;
            }
            for entry in systems {
                let Ok(system) = resolve_system(&document, entry, &names, &(), None) else {
                    eprintln!("refused to resolve 0x{:08x}", entry.0);
                    continue;
                };
                collect_system(&system.root, &roots, &mut graphs);
            }
        }

        if graphs.len() > before {
            let name = path
                .file_name()
                .map_or_else(String::new, |it| it.to_string_lossy().into_owned());
            sources.push(name);
        }
    }

    eprintln!(
        "{} WADs, {} unreadable bins, {} shimmer emitters, {} disabled",
        census.wads, census.unreadable, census.emitters, census.disabled
    );
    println!("# wads\t{}", census.wads);
    println!("# unreadable bins\t{}", census.unreadable);
    println!("# emitters\t{}", census.emitters);
    println!("# disabled\t{}", census.disabled);

    let mut rows: Vec<(&BinHash, &usize)> = census.objects.iter().collect();
    rows.sort_by(|a, b| b.1.cmp(a.1).then(a.0.0.cmp(&b.0.0)));
    for (class, objects) in rows {
        let name = tables.class(*class).unwrap_or_else(|| "-".to_owned());
        let found_in = census.found_in.get(class).map_or(0, HashSet::len);
        println!("{}\t{name}\t{objects}\t{found_in}", hex(*class));
    }

    if let Some(out) = fixtures_path {
        let file = Fixtures {
            sources,
            graphs: graphs.into_values().collect(),
        };
        let text = serde_json::to_string_pretty(&file).expect("serialize the fixtures");
        fs::write(&out, text + "\n").expect("write the fixtures");
        eprintln!("{} distinct graphs written to {out}", file.graphs.len());
    }
}

impl Census {
    /// Count one object's shimmer emitters, and whether it holds any.
    fn object(&mut self, object: &BinObject, wad: usize) -> bool {
        let Some(PropertyValueEnum::Container(list)) = object.properties.get(&SHIMMER_LIST) else {
            return false;
        };

        for item in list.items() {
            let Some((_, properties)) = struct_of(item) else {
                continue;
            };
            self.emitters += 1;
            if matches!(properties.get(&DISABLED), Some(PropertyValueEnum::Bool(held)) if held.value)
            {
                self.disabled += 1;
            }
            self.value(item, wad, 0);
        }
        !list.items().is_empty()
    }

    /// Any value, descended into, each struct counted once.
    fn value(&mut self, value: &PropertyValueEnum, wad: usize, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        match value {
            PropertyValueEnum::Container(items) => {
                for item in items.items() {
                    self.value(item, wad, depth + 1);
                }
            }
            PropertyValueEnum::UnorderedContainer(items) => {
                for item in items.items() {
                    self.value(item, wad, depth + 1);
                }
            }
            PropertyValueEnum::Optional(optional) => {
                if let Some(inner) = optional.value() {
                    self.value(inner, wad, depth + 1);
                }
            }
            PropertyValueEnum::Map(map) => {
                for (_, held) in map.entries() {
                    self.value(held, wad, depth + 1);
                }
            }
            _ => {
                let Some((class, properties)) = struct_of(value) else {
                    return;
                };
                *self.objects.entry(class).or_default() += 1;
                self.found_in.entry(class).or_default().insert(wad);
                for held in properties.values() {
                    self.value(held, wad, depth + 1);
                }
            }
        }
    }
}

/// Every graph under a system's shimmer list, keyed by its JSON. A repeat adds to a count.
fn collect_system(root: &VfxValue, roots: &HashSet<String>, out: &mut IndexMap<String, Fixture>) {
    let VfxValue::Struct { fields, .. } = root else {
        return;
    };
    let shimmer = hex(SHIMMER_LIST);
    let Some(VfxValue::Container { items }) = fields
        .iter()
        .find(|field| field.hash == shimmer)
        .map(|field| &field.value)
    else {
        return;
    };

    for (index, emitter) in items.iter().enumerate() {
        let name = emitter_name(emitter).unwrap_or_else(|| format!("[{index}]"));
        collect(emitter, &name, roots, out, 0);
    }
}

/// Every graph at or under `value`, each recorded with the path that reached it.
fn collect(
    value: &VfxValue,
    path: &str,
    roots: &HashSet<String>,
    out: &mut IndexMap<String, Fixture>,
    depth: usize,
) {
    if depth > MAX_DEPTH {
        return;
    }

    match value {
        VfxValue::Struct {
            class_hash, fields, ..
        } => {
            if roots.contains(class_hash) {
                record(value, path, out);
                return;
            }
            for field in fields {
                let name = field.name.as_deref().unwrap_or(&field.hash);
                if name == "materialDrivers"
                    && let VfxValue::Map { entries } = &field.value
                {
                    for entry in entries {
                        record(&entry.value, &format!("{path}/{name}/{}", entry.key), out);
                    }
                    continue;
                }
                collect(
                    &field.value,
                    &format!("{path}/{name}"),
                    roots,
                    out,
                    depth + 1,
                );
            }
        }
        VfxValue::Container { items } => {
            for (index, item) in items.iter().enumerate() {
                collect(item, &format!("{path}[{index}]"), roots, out, depth + 1);
            }
        }
        VfxValue::Map { entries } => {
            for entry in entries {
                collect(
                    &entry.value,
                    &format!("{path}/{}", entry.key),
                    roots,
                    out,
                    depth + 1,
                );
            }
        }
        _ => {}
    }
}

fn record(graph: &VfxValue, path: &str, out: &mut IndexMap<String, Fixture>) {
    let key = serde_json::to_string(graph).expect("serialize a graph");
    out.entry(key)
        .and_modify(|fixture| fixture.count += 1)
        .or_insert_with(|| Fixture {
            path: path.to_owned(),
            count: 1,
            graph: graph.clone(),
        });
}

/// The `emitterName` an emitter writes, and none for one that writes no name.
fn emitter_name(emitter: &VfxValue) -> Option<String> {
    let VfxValue::Struct { fields, .. } = emitter else {
        return None;
    };
    fields.iter().find_map(|field| match &field.value {
        VfxValue::String { value } if field.name.as_deref() == Some("emitterName") => {
            Some(value.clone())
        }
        _ => None,
    })
}

/// The class and the properties a struct or an embed holds, and none for any other value.
fn struct_of(
    value: &PropertyValueEnum,
) -> Option<(BinHash, &IndexMap<BinHash, PropertyValueEnum>)> {
    match value {
        PropertyValueEnum::Struct(inner) | PropertyValueEnum::Embedded(values::Embedded(inner))
            if inner.class_hash.0 != 0 =>
        {
            Some((inner.class_hash, &inner.properties))
        }
        _ => None,
    }
}

/// A hash as `vfx::resolve` writes it: `0x` and eight hex digits.
fn hex(hash: BinHash) -> String {
    format!("0x{:08x}", hash.0)
}

/// Every WAD at `root`: itself for a file, and every `.wad.client` under it for a directory.
fn wads(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return vec![root.to_path_buf()];
    }

    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(at) = stack.pop() {
        let Ok(entries) = fs::read_dir(&at) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .to_string_lossy()
                .to_lowercase()
                .ends_with(".wad.client")
            {
                found.push(path);
            }
        }
    }

    found.sort();
    found
}

/// The shared bin tables as a `RowNames`, which name every class and field of a fixture.
struct Names<'a>(&'a BinHashTables);

impl RowNames for Names<'_> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.0.for_each_entry(hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.0.for_each_class(hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.0.for_each_field(hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.0.for_each_value(hashes, visit);
    }

    fn for_each_chunk(&self, _hashes: &[WadHash], _visit: &mut dyn FnMut(usize, &str)) {}
}
