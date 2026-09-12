//! Count which fields shipped VFX emitters write.
//!
//! Ranks the renderer's remaining tiers by how much of the shipped data each one
//! reaches, so the next tier is picked off what the game authors rather than off what
//! the format allows. Prints a TSV of `hash<TAB>emitters`, which a reader names against
//! the meta schema.
//!
//! ```text
//! cargo run -p ltk-manager-core --release --example survey_vfx -- <directory of .bin>
//! ```

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use fs_err as fs;
use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_manager_core::bin_document::owned;
use ltk_meta::property::values;
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinFile, BinObject, PropertyValueEnum};

/// `VfxEmitterDefinitionData`, the class every count is per instance of.
const EMITTER: BinHash = BinHash(0x09cd_e442);

/// How deep the walk descends, which is the bound `vfx::resolve` already holds to.
const MAX_DEPTH: usize = 64;

/// `texDiv`, whose default `[1, 1]` is the whole texture and anything else an atlas.
const TEX_DIV: BinHash = BinHash(0x86a8_4509);

/// The fields a bin writes at their own default often enough that presence says little.
const PASS: BinHash = BinHash(0x7b7a_7318);
const UNIFORM_SCALE: BinHash = BinHash(0x3559_e15b);
const PARTICLE_LINGER: BinHash = BinHash(0x2431_d42c);
const ALPHA_REF: BinHash = BinHash(0xb993_10f4);
const MISC_RENDER_FLAGS: BinHash = BinHash(0x6563_bee8);

/// `primitive` and `SpawnShape`, whose class is what the renderer dispatches on.
const PRIMITIVE: BinHash = BinHash(0x007b_14f6);
const SPAWN_SHAPE: BinHash = BinHash(0x3bf0_b4ed);

/// `VfxPrimitiveMesh` and `VfxPrimitiveAttachedMesh`, the two kinds that draw a mesh.
const PRIMITIVE_MESH: BinHash = BinHash(0x8594_e839);
const PRIMITIVE_ATTACHED_MESH: BinHash = BinHash(0xa4ae_a2a5);

/// `mMesh`, and the slots a mesh definition names its geometry and its lock in.
const MESH: BinHash = BinHash(0x0d89_732d);
const MESH_NAME: BinHash = BinHash(0x8c41_a32e);
const MESH_SKELETON: BinHash = BinHash(0x9059_5a15);
const SIMPLE_MESH_NAME: BinHash = BinHash(0xd467_e8c0);
const LOCK_MESH_TO_ATTACHMENT: BinHash = BinHash(0xe79d_a182);

/// The file name the engine reads as a slot left empty, whatever its extension.
const NO_MESH: &str = "doesnotexist.";

/// `VfxEmitterLegacySimple`, whose own fields are tallied like the emitter's.
const LEGACY_SIMPLE: BinHash = BinHash(0x7f70_a2b2);

/// `simpleEmitterDefinitionData`, the list whose emitters the legacy block belongs to.
const SIMPLE_LIST: BinHash = BinHash(0x6781_e762);

/// `VfxAlphaErosionDefinitionData`, whose fields and values are tallied like the legacy block's.
const EROSION: BinHash = BinHash(0x5e84_2b9b);
const EROSION_SOURCE: BinHash = BinHash(0xd3f8_680f);
const EROSION_SLICE: BinHash = BinHash(0x7c79_70d8);
const EROSION_FEATHER_IN: BinHash = BinHash(0x34be_e0ea);
const EROSION_FEATHER_OUT: BinHash = BinHash(0x2244_caa3);
const EROSION_MAP: BinHash = BinHash(0x5da0_5f9b);
const EROSION_DRIVE: BinHash = BinHash(0xc6fb_acd5);
const EROSION_MIXER: BinHash = BinHash(0xb079_4a80);

/// `dynamics` and `constantValue` of every value class.
const DYNAMICS: BinHash = BinHash(0xbc03_7de7);
const CONSTANT: BinHash = BinHash(0xb4b4_27aa);

/// What the walk has counted so far.
#[derive(Default)]
struct Survey {
    emitters: usize,
    fields: HashMap<BinHash, usize>,
    /// Emitters whose `texDiv` cuts the texture into more than one frame.
    atlased: usize,
    /// Emitters whose written value differs from the schema's own default.
    off_default: HashMap<BinHash, usize>,
    /// The class each emitter's `primitive` names, by class hash.
    primitives: HashMap<BinHash, usize>,
    /// The class each emitter's `SpawnShape` names, by class hash.
    shapes: HashMap<BinHash, usize>,
    /// Each mesh primitive by its kind, which slot names its geometry, and its lock.
    mesh_slots: HashMap<String, usize>,
    /// The fields each `VfxEmitterLegacySimple` writes, and how many there are.
    legacy_simple: HashMap<BinHash, usize>,
    legacy_simples: usize,
    /// Emitters held in `simpleEmitterDefinitionData`.
    simple_emitters: usize,
    /// The fields each `VfxAlphaErosionDefinitionData` writes, and how many there are.
    erosion: HashMap<BinHash, usize>,
    erosions: usize,
    /// Each erosion value tallied by what is written, as text.
    erosion_values: HashMap<String, usize>,
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next() else {
        eprintln!("usage: survey_vfx <directory holding .bin files>");
        std::process::exit(2);
    };

    let files = bins(Path::new(&root));
    eprintln!("reading {} bin files under {root}", files.len());

    let mut survey = Survey::default();
    let mut unreadable = 0usize;

    for path in &files {
        let Ok(bytes) = fs::read(path) else {
            unreadable += 1;
            continue;
        };
        let Ok(BinFile::Prop(bin)) = BinFile::from_reader(&mut Cursor::new(&bytes)) else {
            unreadable += 1;
            continue;
        };

        for object in bin.objects.values() {
            survey.object(object);
        }
    }

    eprintln!(
        "{} files, {unreadable} unreadable, {} emitters",
        files.len(),
        survey.emitters
    );

    println!("# emitters\t{}", survey.emitters);
    println!("# atlased\t{}", survey.atlased);
    for (hash, count) in &survey.off_default {
        println!("# off-default 0x{:08x}\t{count}", hash.0);
    }
    for (hash, count) in &survey.primitives {
        println!("# primitive 0x{:08x}\t{count}", hash.0);
    }
    for (hash, count) in &survey.shapes {
        println!("# shape 0x{:08x}\t{count}", hash.0);
    }
    for (text, count) in &survey.mesh_slots {
        println!("# mesh-slot {text}\t{count}");
    }
    println!("# simple-list emitters\t{}", survey.simple_emitters);
    println!("# legacy-simple blocks\t{}", survey.legacy_simples);
    for (hash, count) in &survey.legacy_simple {
        println!("# legacy-simple 0x{:08x}\t{count}", hash.0);
    }
    println!("# erosion blocks\t{}", survey.erosions);
    for (hash, count) in &survey.erosion {
        println!("# erosion 0x{:08x}\t{count}", hash.0);
    }
    let mut values: Vec<(&String, &usize)> = survey.erosion_values.iter().collect();
    values.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    for (text, count) in values.iter().take(120) {
        println!("# erosion-value {text}\t{count}");
    }
    let mut rows: Vec<(&BinHash, &usize)> = survey.fields.iter().collect();
    rows.sort_by(|a, b| b.1.cmp(a.1));
    for (hash, count) in rows {
        println!("0x{:08x}\t{count}", hash.0);
    }
}

impl Survey {
    /// One object's whole subtree.
    fn object(&mut self, object: &BinObject) {
        self.node(object.class_hash, &object.properties, 0);
    }

    /// One class's properties, and everything under them.
    fn node(
        &mut self,
        class: BinHash,
        properties: &IndexMap<BinHash, PropertyValueEnum>,
        depth: usize,
    ) {
        if depth > MAX_DEPTH {
            return;
        }
        if class == LEGACY_SIMPLE {
            self.legacy_simples += 1;
            for hash in properties.keys() {
                *self.legacy_simple.entry(*hash).or_default() += 1;
            }
        }
        if let Some(PropertyValueEnum::Container(items)) = properties.get(&SIMPLE_LIST) {
            self.simple_emitters += items.items().len();
        }
        if class == EROSION {
            self.erosions += 1;
            for hash in properties.keys() {
                *self.erosion.entry(*hash).or_default() += 1;
            }
            self.erosion_values(properties);
        }
        if class == EMITTER {
            self.emitters += 1;
            for hash in properties.keys() {
                *self.fields.entry(*hash).or_default() += 1;
            }
            if let Some(PropertyValueEnum::Vector2(cut)) = properties.get(&TEX_DIV)
                && (cut.value.x > 1.0 || cut.value.y > 1.0)
            {
                self.atlased += 1;
            }
            self.off_default(properties);
            if let Some((class, primitive)) = properties.get(&PRIMITIVE).and_then(struct_of) {
                *self.primitives.entry(class).or_default() += 1;
                if class == PRIMITIVE_MESH || class == PRIMITIVE_ATTACHED_MESH {
                    self.mesh_slot(class, primitive);
                }
            }
            if let Some(class) = properties.get(&SPAWN_SHAPE).and_then(class_of) {
                *self.shapes.entry(class).or_default() += 1;
            }
        }
        for value in properties.values() {
            self.value(value, depth + 1);
        }
    }

    /// Which slot one mesh primitive names its geometry in, and whether it locks.
    ///
    /// The skinned pair wins over the simple slot and needs both halves, so a definition
    /// that fills neither names no geometry of its own at all.
    fn mesh_slot(&mut self, class: BinHash, primitive: &IndexMap<BinHash, PropertyValueEnum>) {
        let kind = if class == PRIMITIVE_ATTACHED_MESH {
            "attached"
        } else {
            "plain"
        };
        let Some((_, mesh)) = primitive.get(&MESH).and_then(struct_of) else {
            *self
                .mesh_slots
                .entry(format!("{kind} mMesh=absent"))
                .or_default() += 1;
            return;
        };

        let named = if written(mesh, MESH_NAME) && written(mesh, MESH_SKELETON) {
            "skinned"
        } else if written(mesh, SIMPLE_MESH_NAME) {
            "simple"
        } else {
            "none"
        };
        let locked = matches!(
            mesh.get(&LOCK_MESH_TO_ATTACHMENT)
                .and_then(|held| owned(held.leaf())),
            Some(Leaf::Bool(true) | Leaf::Flag(true))
        );

        *self
            .mesh_slots
            .entry(format!("{kind} names={named} locked={locked}"))
            .or_default() += 1;
    }

    /// The fields whose written value differs from what the schema declares as default.
    fn off_default(&mut self, properties: &IndexMap<BinHash, PropertyValueEnum>) {
        let mut count = |hash: BinHash| *self.off_default.entry(hash).or_default() += 1;

        if let Some(PropertyValueEnum::I16(held)) = properties.get(&PASS)
            && held.value != 0
        {
            count(PASS);
        }
        if let Some(held) = properties.get(&UNIFORM_SCALE)
            && matches!(
                owned(held.leaf()),
                Some(Leaf::Bool(true) | Leaf::Flag(true))
            )
        {
            count(UNIFORM_SCALE);
        }
        if let Some(PropertyValueEnum::U8(held)) = properties.get(&ALPHA_REF)
            && held.value != 5
        {
            count(ALPHA_REF);
        }
        if let Some(PropertyValueEnum::U8(held)) = properties.get(&MISC_RENDER_FLAGS)
            && held.value != 0
        {
            count(MISC_RENDER_FLAGS);
        }
        if let Some(PropertyValueEnum::Optional(held)) = properties.get(&PARTICLE_LINGER)
            && let Some(PropertyValueEnum::F32(seconds)) = held.value()
            && seconds.value > 0.0
        {
            count(PARTICLE_LINGER);
        }
    }

    /// What one erosion block writes, each scalar as text and each curve by its shape.
    fn erosion_values(&mut self, properties: &IndexMap<BinHash, PropertyValueEnum>) {
        let mut tally = |text: String| *self.erosion_values.entry(text).or_default() += 1;

        if let Some(PropertyValueEnum::U8(held)) = properties.get(&EROSION_SOURCE) {
            tally(format!("source={}", held.value));
        }
        for (name, hash) in [
            ("slice", EROSION_SLICE),
            ("featherIn", EROSION_FEATHER_IN),
            ("featherOut", EROSION_FEATHER_OUT),
        ] {
            if let Some(PropertyValueEnum::F32(held)) = properties.get(&hash) {
                tally(format!("{name}={}", held.value));
            }
        }
        if let Some(PropertyValueEnum::String(held)) = properties.get(&EROSION_MAP) {
            let named = !held.value.is_empty();
            tally(format!("map={}", if named { "named" } else { "empty" }));
        }
        for (name, hash) in [("drive", EROSION_DRIVE), ("mixer", EROSION_MIXER)] {
            let Some(PropertyValueEnum::Embedded(values::Embedded(inner))) = properties.get(&hash)
            else {
                continue;
            };
            let constant = inner
                .properties
                .get(&CONSTANT)
                .map(|held| format!("{:?}", owned(held.leaf())))
                .unwrap_or_else(|| "default".to_owned());
            let keyed = inner.properties.get(&DYNAMICS).is_some_and(
                |held| !matches!(held, PropertyValueEnum::Optional(o) if o.value().is_none()),
            );
            tally(format!("{name} constant={constant} keyed={keyed}"));
        }
    }

    /// Any value, descended into.
    fn value(&mut self, value: &PropertyValueEnum, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        match value {
            PropertyValueEnum::Container(items) => self.items(items.items(), depth),
            PropertyValueEnum::UnorderedContainer(items) => self.items(items.items(), depth),
            PropertyValueEnum::Optional(optional) => {
                if let Some(inner) = optional.value() {
                    self.value(inner, depth + 1);
                }
            }
            PropertyValueEnum::Map(map) => {
                for (_, held) in map.entries() {
                    self.value(held, depth + 1);
                }
            }
            PropertyValueEnum::Struct(inner) if inner.class_hash.0 == 0 => {}
            PropertyValueEnum::Struct(inner)
            | PropertyValueEnum::Embedded(values::Embedded(inner)) => {
                self.node(inner.class_hash, &inner.properties, depth + 1);
            }
            _ => {}
        }
    }

    fn items(&mut self, items: &[PropertyValueEnum], depth: usize) {
        for item in items {
            self.value(item, depth + 1);
        }
    }
}

/// The class a struct or an embed names, and none for any other value.
fn class_of(value: &PropertyValueEnum) -> Option<BinHash> {
    struct_of(value).map(|(class, _)| class)
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

/// The property holds a path, rather than an empty slot or the engine's own sentinel.
fn written(properties: &IndexMap<BinHash, PropertyValueEnum>, hash: BinHash) -> bool {
    let Some(PropertyValueEnum::String(held)) = properties.get(&hash) else {
        return false;
    };
    let name = held.value.to_lowercase();
    !name.is_empty()
        && !name
            .rsplit('/')
            .next()
            .unwrap_or(&name)
            .starts_with(NO_MESH)
}

/// Every `.bin` under `root`, however deep.
fn bins(root: &Path) -> Vec<PathBuf> {
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
                .extension()
                .is_some_and(|it| it.eq_ignore_ascii_case("bin"))
            {
                found.push(path);
            }
        }
    }

    found
}
