# League Toolkit

[![CI](https://github.com/LeagueToolkit/league-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/LeagueToolkit/league-toolkit/actions/workflows/ci.yml)
[![Crates.io](https://img.shields.io/crates/v/league-toolkit.svg)](https://crates.io/crates/league-toolkit)
[![Docs](https://img.shields.io/docsrs/league-toolkit)](https://docs.rs/league-toolkit)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](#license)

Rust libraries for reading, editing and writing League of Legends file formats - WAD archives,
property bins, textures, meshes, animations, map geometry and string tables.

[Documentation](https://docs.rs/league-toolkit) - [Guide](docs/LTK_GUIDE.md) -
[Changelog](CHANGELOG.md)

## What is here

One crate per format family, each usable on its own, plus `league-toolkit`: an umbrella crate that
re-exports them behind feature flags. Nothing in the workspace knows about mods, managers or
installers - these crates read and write what the game ships. Building mods on top of them is
[league-mod](https://github.com/LeagueToolkit/league-mod)'s job.

| Crate                                     | Version                                                                                                     | Formats                 | What it is                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| [`league-toolkit`](crates/league-toolkit) | [![crates.io](https://img.shields.io/crates/v/league-toolkit.svg)](https://crates.io/crates/league-toolkit)  | -                       | Umbrella crate; feature-gated re-exports of the crates below                    |
| [`ltk_wad`](crates/ltk_wad)               | [![crates.io](https://img.shields.io/crates/v/ltk_wad.svg)](https://crates.io/crates/ltk_wad)                | `.wad.client`           | Archive reading, extraction and building; name resolution; signatures           |
| [`ltk_meta`](crates/ltk_meta)             | [![crates.io](https://img.shields.io/crates/v/ltk_meta.svg)](https://crates.io/crates/ltk_meta)              | `.bin` (`PROP`, `PTCH`) | Property bins: the object tree, streaming views, property paths, override bins  |
| [`ltk_texture`](crates/ltk_texture)       | [![crates.io](https://img.shields.io/crates/v/ltk_texture.svg)](https://crates.io/crates/ltk_texture)        | `.tex`, `.dds`          | Decoding for every shipped format, encoding for BC1/BC3/BC7 and raw             |
| [`ltk_mesh`](crates/ltk_mesh)             | [![crates.io](https://img.shields.io/crates/v/ltk_mesh.svg)](https://crates.io/crates/ltk_mesh)              | `.skn`, `.scb`, `.sco`  | Skinned and static meshes, with typed vertex-buffer accessors                   |
| [`ltk_anim`](crates/ltk_anim)             | [![crates.io](https://img.shields.io/crates/v/ltk_anim.svg)](https://crates.io/crates/ltk_anim)              | `.skl`, `.anm`          | Skeletons, joints and animations                                                |
| [`ltk_mapgeo`](crates/ltk_mapgeo)         | [![crates.io](https://img.shields.io/crates/v/ltk_mapgeo.svg)](https://crates.io/crates/ltk_mapgeo)          | `.mapgeo`               | Map environment geometry                                                        |
| [`ltk_rst`](crates/ltk_rst)               | [![crates.io](https://img.shields.io/crates/v/ltk_rst.svg)](https://crates.io/crates/ltk_rst)                | `.stringtable`          | Riot String Tables: localized strings keyed by hash                             |
| [`ltk_ritobin`](crates/ltk_ritobin)       | [![crates.io](https://img.shields.io/crates/v/ltk_ritobin.svg)](https://crates.io/crates/ltk_ritobin)        | ritobin text            | The human-readable bin dialect: parse, print, round-trip                        |
| [`ltk_shader`](crates/ltk_shader)         | [![crates.io](https://img.shields.io/crates/v/ltk_shader.svg)](https://crates.io/crates/ltk_shader)          | -                       | Shader table of contents, defines and loading                                   |
| [`ltk_file`](crates/ltk_file)             | [![crates.io](https://img.shields.io/crates/v/ltk_file.svg)](https://crates.io/crates/ltk_file)              | -                       | File kind detection from magic bytes (`LeagueFileKind`)                         |
| [`ltk_hash`](crates/ltk_hash)             | [![crates.io](https://img.shields.io/crates/v/ltk_hash.svg)](https://crates.io/crates/ltk_hash)              | -                       | The hashes the formats key on: xxh64 for WAD paths, FNV-1a for bin names, ELF   |
| [`ltk_primitives`](crates/ltk_primitives) | [![crates.io](https://img.shields.io/crates/v/ltk_primitives.svg)](https://crates.io/crates/ltk_primitives)  | -                       | Geometry shared by the mesh and map crates: `AABB`, `Sphere`, `Color`           |
| [`ltk_io_ext`](crates/ltk_io_ext)         | [![crates.io](https://img.shields.io/crates/v/ltk_io_ext.svg)](https://crates.io/crates/ltk_io_ext)          | -                       | Reader and writer extensions the format crates share                            |

`ltk_wad`, `ltk_meta`, `ltk_texture` and `ltk_ritobin` carry their own READMEs, which are the
reference for those surfaces. The rest document themselves on [docs.rs](https://docs.rs).

The ritobin language itself is specified in
[ritobin-lang](https://github.com/LeagueToolkit/ritobin-lang), the home for its syntax and the
standards the ecosystem around it follows. `ltk_ritobin` is an implementation of that
specification.

## Installation

The umbrella crate, with the subsystems you want:

```toml
[dependencies]
league-toolkit = { version = "0.2", features = ["wad", "meta", "texture"] }
```

Each subsystem is then a module: `league_toolkit::wad`, `league_toolkit::meta`, and so on.

Depending on a crate directly is equivalent, and keeps the dependency graph smaller:

```toml
[dependencies]
ltk_wad = "0.5"
ltk_meta = "0.8"
ltk_texture = "0.6"
```

`ltk_mapgeo`, `ltk_ritobin`, `ltk_shader` and `ltk_io_ext` are reachable only as direct
dependencies; the umbrella crate does not re-export them.

## Feature flags

| Feature      | Enables                                                                               | Default |
| ------------ | ------------------------------------------------------------------------------------- | ------- |
| `anim`       | `ltk_anim`                                                                            | yes     |
| `file`       | `ltk_file`                                                                            | yes     |
| `hash`       | `ltk_hash`                                                                            | yes     |
| `mesh`       | `ltk_mesh`                                                                            | yes     |
| `meta`       | `ltk_meta`                                                                            | yes     |
| `primitives` | `ltk_primitives`                                                                      | yes     |
| `texture`    | `ltk_texture`                                                                         | yes     |
| `wad`        | `ltk_wad`                                                                             | yes     |
| `rst`        | `ltk_rst`                                                                             | no      |
| `serde`      | `Serialize` and `Deserialize` on `ltk_wad`, `ltk_file`, `ltk_meta` and `ltk_rst` types | no      |

For a minimal build, turn the defaults off and opt in:

```toml
[dependencies]
league-toolkit = { version = "0.2", default-features = false, features = ["wad"] }
```

Individual crates carry flags of their own. `ltk_wad` picks its zstd and deflate backends
(`zstd`, `ruzstd`, `rust_backend`) - `rust_backend` compiles no C at all. `ltk_texture` gates BC7
encoding behind `intel-tex`; decoding never needs a feature.

## Quick start

### Read a WAD archive

A WAD keeps no file names. A chunk is keyed by the xxh64 of its lowercased path, so a lookup
hashes the path, and a listing shows hashes until a hash table names them.

```rust
use std::fs::File;
use ltk_hash::Hash as _;
use ltk_wad::{Wad, WadHash};

let mut wad = Wad::mount(File::open("Aatrox.wad.client")?)?;
println!("{} chunks", wad.chunks().len());

let hash = WadHash::hash_str("data/characters/aatrox/aatrox.bin");
if let Some(chunk) = wad.chunks().get(hash).copied() {
    let bytes = wad.load_chunk_decompressed(&chunk)?;
    println!("{} bytes of bin", bytes.len());
}
```

Extraction to disk, name recovery out of the bins, archive building and signature checking are all
in the [`ltk_wad` README](crates/ltk_wad/README.md).

### Decode a texture

```rust
use ltk_texture::Tex;
use std::fs::File;

let tex = Tex::from_reader(&mut File::open("texture.tex")?)?;
println!("{}x{} {:?}, {} mips", tex.width, tex.height, tex.format, tex.mip_count);

let surface = tex.decode_mipmap(0)?;
surface.into_rgba_image()?.save("output.png")?;
```

`Texture::from_reader` covers the case where a file may be either `.tex` or `.dds`. Signed and
float formats keep their real values through `as_pixels`; `into_rgba_image` is a presentation
conversion, and it clamps. See the [`ltk_texture` README](crates/ltk_texture/README.md).

### Read a skinned mesh

```rust
use ltk_mesh::SkinnedMesh;
use std::fs::File;

let mesh = SkinnedMesh::from_reader(&mut File::open("champion.skn")?)?;
println!("{} vertices in {} submeshes", mesh.vertex_buffer().count(), mesh.ranges().len());
```

Vertex data comes out through typed accessors -
`vertex_buffer().accessor::<Vec3>(ElementName::Position)` - rather than one fixed vertex struct, so
a layout the format allows but a struct does not is still readable.

### Read and build a property bin

```rust
use std::fs::File;
use ltk_meta::concrete::{values, Bin, BinObject};

// Read
let bin = Bin::from_reader(&mut File::open("data.bin")?)?;
for (path_hash, object) in &bin.objects {
    println!("{path_hash:08x} ({:08x}): {} properties", object.class_hash, object.properties.len());
}

// Build
let bin = Bin::builder()
    .dependency("shared/data.bin")
    .object(
        BinObject::builder(0x12345678u32, 0xABCDEF00u32)
            .property(0x1111u32, values::I32::new(42))
            .build(),
    )
    .build();
```

Object and property names are FNV-1a hashes of the lowercased string. `Bin::from_reader` parses
the whole file; `BinStream` mounts one and reads only the objects asked for, which is what makes
sweeping thousands of bins affordable. Property paths, override bins (`PTCH`) and the streaming
views are in the [`ltk_meta` README](crates/ltk_meta/README.md).

## Documentation

- [docs.rs/league-toolkit](https://docs.rs/league-toolkit) - rustdoc for every crate
- [`docs/LTK_GUIDE.md`](docs/LTK_GUIDE.md) - a walkthrough with worked examples
- `docs/design/` - what a feature's surface and wire format are
- `docs/adr/` - one record per architectural decision, with the options it beat
- `docs/prd/` - why a feature exists, and its numbered requirements

## Development

The toolchain is pinned to stable in `rust-toolchain.toml`, with `rustfmt` and `clippy`.

```bash
cargo build              # whole workspace
cargo test               # whole workspace
cargo test -p ltk_meta   # one crate
cargo clippy --all-targets
cargo fmt
cargo doc --open
```

Workspace lints deny `clippy::correctness` and `clippy::suspicious`, and warn on `perf`, `style`
and `complexity`. CI runs `cargo fmt --check`, clippy, the build and the tests on every push and
pull request.

### AI-assisted development

AI agents produce large, hard-to-review changesets. This repository answers that with a
**document trail** rather than a tool pipeline: work is specified, decided and sliced in the repo
before it is written, and each artifact is reviewable on its own.

| Document       | Holds                                                                   | Where                            |
| -------------- | ----------------------------------------------------------------------- | -------------------------------- |
| **PRD**        | Why a feature exists, who asks for it, numbered requirements (`FR-N`)    | `docs/prd/NNN-slug.md`           |
| **ADR**        | One architectural decision: what forced it, what it beat, what it costs  | `docs/adr/NNNN-slug.md`          |
| **Design doc** | The API surface and the wire format                                     | `docs/design/<feature>.md`       |
| **Ticket**     | One slice of implementable work, rendered to a GitHub issue             | `.scratch/<project>/issues/*.md` |

The rule that keeps them readable: each cites the others rather than restating them. A design doc
cites requirements as `FR-N` and decisions as `ADR-NNNN`. Two copies of one argument drift.

GitHub issues are **rendered** from the ticket files. The repo is the source of truth, and an
issue that disagrees with its ticket is fixed by re-rendering it, not by editing it on GitHub.

Claude Code users get five skills in `.claude/skills/` that write and maintain all of this:
`write-prd`, `write-adr`, `write-spec`, `write-ticket` and `sync-issues`. Worked example: PRD-001
with ADR-0001 to ADR-0006 and `docs/design/ptch-property-patches.md`.

**Contributors using AI agents SHOULD follow this workflow.** A PR that arrives with no written
reasoning behind it may need extra review cycles. Day-to-day rules for agents are in
[`CLAUDE.md`](CLAUDE.md).

### Project structure

```
league-toolkit
|-- crates
|   |-- league-toolkit    # umbrella crate
|   |-- ltk_wad           # WAD archives
|   |-- ltk_meta          # property bins
|   |-- ltk_ritobin       # ritobin text format
|   |-- ltk_texture       # textures
|   |-- ltk_mesh          # meshes
|   |-- ltk_anim          # skeletons and animations
|   |-- ltk_mapgeo        # map geometry
|   |-- ltk_rst           # string tables
|   |-- ltk_shader        # shaders
|   |-- ltk_file          # file kind detection
|   |-- ltk_hash          # hashes
|   |-- ltk_primitives    # geometric primitives
|   |-- ltk_io_ext        # I/O extensions
|-- docs
|   |-- adr               # architectural decision records
|   |-- design            # surface and format specs
|   |-- prd               # requirements
|   |-- LTK_GUIDE.md      # usage guide
|-- .scratch              # ticket files, one directory per project
```

## Releasing

[release-plz](https://release-plz.dev/docs) handles versioning and publishing. Only `feat`, `fix`
and `perf` commits trigger a release: pushing one to `main` opens a draft release PR carrying the
version bumps and changelogs, and merging it publishes the affected crates to crates.io.

## Related

- [league-mod](https://github.com/LeagueToolkit/league-mod) - the `.modpkg` mod format, project
  packing, and the WAD overlay builder, all built on these crates
- [ltk-manager](https://github.com/LeagueToolkit/ltk-manager) - the desktop mod manager
- [ritobin-lang](https://github.com/LeagueToolkit/ritobin-lang) - the ritobin language
  specification, and the standards for the ecosystem around it
- [wadtools](https://github.com/LeagueToolkit/wadtools) - CLI for extracting, listing and
  comparing `.wad` archives
- [Mimir](https://github.com/LeagueToolkit/Mimir) - hash-to-path tables as compact memory-mapped
  `.hashdb` files
- [lol-meta-wiki](https://github.com/LeagueToolkit/lol-meta-wiki) - documentation and a JSON API
  for `.bin` meta classes and properties
- [awesome-league](https://github.com/LeagueToolkit/awesome-league) - a curated list of tools,
  libraries and resources for League of Legends files, assets and mods

## License

Licensed under the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or
<http://www.apache.org/licenses/LICENSE-2.0>).

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in
the work by you, as defined in the Apache-2.0 license, shall be licensed as above, without any
additional terms or conditions.
