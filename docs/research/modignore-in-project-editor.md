# The ignore file already works, and nothing in the workshop says so

Research note. Sections 1 to 4 are evidence gathered on 2026-09-10 against this repository at
`cd534ba6` (`feat/bin-editor-narrow-ux`), `ltk_mod_project` 0.9.2 and `ltk_overlay` 0.9.7 as
published from league-mod `2c73916`, the `ignore` crate 0.4.32, and the LeagueToolkit wiki as
served that day. Section 5 is the proposed default file, section 6 the decided design, and section
7 the seams and what only the
maintainer can answer.

The question is how the project editor teaches `.modignore`: every project gets a default file,
a mod creator ignores a file, a folder or an extension in one action, and the UI points at the
syntax so the file can be edited by hand.

Six findings decide the rest:

- **The feature is complete upstream, and both of ltk-manager's build paths honour it.** Pack
  goes through `ProjectPacker` with its default `IgnoreMode::FromProject`, and Test builds the
  overlay through `FsModContent`, which applies the same filter. What a creator tests is what
  the package ships.
- **Nothing is ignored without a file, and nothing in ltk-manager writes, shows or reports
  one.** league-mod's own behaviour notes name a starter `.modignore` for new projects, and a
  surfaced ignored-files report, as ltk-manager's to build.
- **Patterns anchor at `content/`, not at the project root.** A pattern written against the
  folder a creator sees in Explorer, `/content/base/...`, matches nothing.
- **The content tree hides every dot-entry, and the packer ships them.** A `.DS_Store` or a
  `.mayaSwatches` folder under `content/` has no row in the workshop and still lands in the
  package, so a tree action cannot reach them and the default file is the only thing that does.
- **A broken pattern fails the pack, and ltk-manager's error drops the line number.** The
  upstream error keeps the line in its `source`, and `pack_project` flattens the error with
  `to_string()`, which keeps only the file's path.
- **Every Ritobin text form belongs in the default: `.py`, `.ritobin` and `.rito`.** No known
  game path ends in any of them, and a built mod never ships one. A `.rito` file is a build
  input, which a transformer pipeline turns into a binary form, so the transformer reads it
  whether `.modignore` matches it or not.

## Sources

- `ltk_mod_project` 0.9.2, `src/modignore.rs`, `src/modignore/tests.rs`, `src/pack/packer.rs`
  and `src/pack/options.rs`, read from the crate as published, whose `.cargo_vcs_info.json`
  names league-mod commit
  [`2c73916`](https://github.com/LeagueToolkit/league-mod/tree/2c73916ef9dc609e18aba8467770745d50e7bc0f)
- `ltk_overlay` 0.9.7, `src/content.rs`, published from the same commit
- [`docs/modignore-behavior-notes.md`](https://github.com/LeagueToolkit/league-mod/blob/2c73916ef9dc609e18aba8467770745d50e7bc0f/docs/modignore-behavior-notes.md)
  and the
  [README](https://github.com/LeagueToolkit/league-mod/blob/2c73916ef9dc609e18aba8467770745d50e7bc0f/README.md#ignoring-files)
  at that commit
- [`crates/league-mod/src/commands/init.rs`](https://github.com/LeagueToolkit/league-mod/blob/2c73916ef9dc609e18aba8467770745d50e7bc0f/crates/league-mod/src/commands/init.rs)
  at that commit
- `ignore` 0.4.32, `src/gitignore.rs`, published from ripgrep commit
  [`5ed408e`](https://github.com/BurntSushi/ripgrep/blob/5ed408e17eccfc59bcec48f584feece902873e54/crates/ignore/src/gitignore.rs)
- The wiki's [Mod Projects](https://wiki.leaguetoolkit.dev/making-mods/mod-projects/#ignore-files)
  and [Ecosystem Integration](https://wiki.leaguetoolkit.dev/developers/ecosystem-integration/#if-you-build-a-creation-tool)
  pages, read with `curl` because the host answers `WebFetch` with `403`
- `Cargo.toml` and `Cargo.lock` in this repository, for the pinned versions
- `crates/ltk-manager-core/src/workshop/projects.rs`, `packing.rs`, `content.rs` and `mod.rs`,
  `overlay/mod.rs`, `problems/engine.rs`, `mods/archive/storage.rs` and `mods/archive/repair.rs`
- `src/modules/workshop/components/ContentTreeContextMenu.tsx`, `ContentTree.tsx`,
  `ContentSidebar.tsx`, `NewProjectDialog.tsx` and `PackDialog.tsx`, and
  `src/modules/workshop/documents/registry.tsx`
- `docs/ux/PROJECT_EDITOR.md`, "Primary side panel" and "What a row's menu holds"

- moonshadow565/ritobin at
  [`d4b8764`](https://github.com/moonshadow565/ritobin/tree/d4b8764939d141c1db3ffd186d49bf60fd889b87),
  league-toolkit at
  [`d2a1419`](https://github.com/LeagueToolkit/league-toolkit/tree/d2a1419ce2bbaf0ca4ab085cd99344370e8df95f),
  ritobin-lsp at
  [`20940a1`](https://github.com/alanpq/ritobin-lsp/tree/20940a19c8fde3dadcd65df11a89b75605cdfea6)
  and ritobin-tools at
  [`8ae1e24`](https://github.com/LeagueToolkit/ritobin-tools/tree/8ae1e240fc54074d78470a197d3ba745c1d9203e),
  for the extensions each writes
- `ltk_file` 0.2.11, `src/kind.rs`, the version `Cargo.lock:3065-3067` pins, published from
  league-toolkit `a096f53`
- The CommunityDragon hash lists at
  [`5e42212`](https://github.com/CommunityDragon/Data/tree/5e42212eb9d182ff0e2261801dd795f733e845ed/hashes/lol),
  `hashes.game.txt.0` to `.8` and `hashes.lcu.txt`, counted by extension
- The wiki's [Game Data](https://wiki.leaguetoolkit.dev/reference/mod-packages/game-data/) and
  [Ritobin](https://wiki.leaguetoolkit.dev/reference/file-formats/ritobin/) pages
- The Autodesk, Blender, Khronos, Library of Congress, Microsoft and Apple pages linked in
  section 3.2
- [gitignore](https://git-scm.com/docs/gitignore), GitHub Desktop at `8eb43b9`, VS Code at
  `aa726f5`, Godot at `cb41ea1`, gmad at `8cc36b9`, and the JetBrains, Unity, npm and Docker
  pages linked in section 4

## 1. What `.modignore` is

`ltk_mod_project` owns the behaviour. The workspace pins `ltk_mod_project = { version = "0.9.2",
features = ["modpkg", "fantome"] }` (`Cargo.toml:32`), and `Cargo.lock:3168-3171` resolves it to
0.9.2 from crates.io. The crate depends on `ignore = "0.4"`, which the lock resolves to 0.4.32
(`Cargo.lock:2394-2397`).

### 1.1 Where the file lives

The name is the constant `MODIGNORE_FILE_NAME = ".modignore"` (`modignore.rs:45-47`). Ignore files
cascade the way git's do (`modignore.rs:3-9`):

```
my-mod
|-- .modignore                   anchors at content/
|-- content
|   |-- .modignore               anchors at content/, wins over the root file
|   |-- base
|       |-- .modignore           anchors at content/base/
|       |-- Ahri.wad.client
|           |-- .modignore       anchors at content/base/Ahri.wad.client/
|-- mod.config.json
```

- **The root file is the documented one.** `ModIgnore::load` reads `<project_root>/.modignore`
  and anchors it at `content/` (`modignore.rs:128-139`). A test pins that `/content/base/junk`
  matches nothing and `/base/junk` matches (`modignore/tests.rs:176-186`).
- **Any directory under `content/` may hold its own.** A nested file anchors at its directory,
  a deeper file overrides a shallower one for its subtree, and a file beneath an ignored
  directory is never read (`modignore.rs:5-7`, `208-281`, tests at `252-311`). A layer
  directory is one such directory, so a per-layer file is `content/<layer>/.modignore`.
  `content/.modignore` shares the root file's anchor, and the in-tree one wins on a conflict
  (behaviour notes, "Ignore files nest").
- **The files are never packed**, in any format, even with `IgnoreMode::Disabled`
  (`modignore.rs:7-9`, `packer.rs:428-434`). Extracting an archive therefore never recreates
  one (behaviour notes).
- **The root file is probed by exact name**, nested ones case-insensitively (behaviour notes,
  "Mis-cased ignore files", `modignore.rs:231-255`).
- **A UTF-8 BOM and CRLF line ends are tolerated** (`modignore.rs:166-168`, `178-179`, tests at
  `188-212`).
- **There are no built-in ignores.** An absent file is an empty filter (`modignore.rs:97-104`).
  The behaviour notes say it outright:

  > **Nothing is excluded by default.** `Thumbs.db`, `.DS_Store`, `desktop.ini` all ship unless
  > listed. Project templates (ltk-manager) should write a starter `.modignore`.

### 1.2 The matcher

Each file compiles into one `ignore::gitignore::Gitignore`, built by `GitignoreBuilder` with
`case_insensitive(true)` and one `add_line` per source line (`modignore.rs:159-206`). The
builder's line parser is `gitignore.rs:458-539`, and precedence is `matched_stripped` at
`gitignore.rs:259-283`, which returns the highest-numbered matching glob.

| Syntax                         | Behaviour                                                                       | Source                                              |
| ------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `# text`                       | A comment. `\#` makes a literal leading `#`                                     | `gitignore.rs:465-467`, `482-484`, `tests.rs:79-90` |
| Blank line                     | Skipped                                                                         | `gitignore.rs:471-473`                              |
| Trailing spaces                | Trimmed, unless escaped as `\ `                                                 | `gitignore.rs:468-470`                              |
| `!pattern`                     | Re-includes, and the last matching line wins                                    | `gitignore.rs:486-488`, `tests.rs:115-135`          |
| `*.psd`, no slash              | Matches at any depth, compiled as `**/*.psd`                                    | `gitignore.rs:511-519`, `tests.rs:92-102`           |
| `/base/scratch`, leading slash | Anchored at the file's directory, `content/` for the root file                  | `gitignore.rs:490-497`, `tests.rs:92-102`           |
| `base/scratch`, inner slash    | Anchored the same way, because a slash suppresses the `**/` prefix              | `gitignore.rs:511-519`                              |
| `cache/`, trailing slash       | Directories only                                                                | `gitignore.rs:499-509`, `tests.rs:104-113`          |
| `*`, `?`, `[a-z]`              | Never cross a `/`                                                               | `gitignore.rs:526-527` (`literal_separator(true)`)  |
| `**/x`, `x/**`, `a/**/b`       | Any depth, contents but not the directory, any number of directories between    | `gitignore.rs:74`, `520-525`                        |
| `{a,b}`                        | Alternation, and an unclosed `{` is an error                                    | `tests.rs:226-250`, behaviour notes                 |
| `\`                            | An escape, never a separator. `base\scratch` matches a file named `basescratch` | `tests.rs:531-547`                                  |

### 1.3 Where it departs from git

- **Matching is case-insensitive on every platform**, because the game resolves packed paths
  case-insensitively (`modignore.rs:11-15`, test at `tests.rs:214-224`). `thumbs.db` matches
  `Thumbs.db`.
- **The dialect is globset's, not C git's.** The behaviour notes list the corners: an unclosed
  `[` compiles as a literal, `a**b` follows globset, and `a{b` is an error where git reads it
  literally.
- **A negation cannot re-include anything under an excluded directory**, which is git's rule
  too. `scratch/` with `!scratch/keep.bin` keeps nothing, and `scratch/*` with
  `!scratch/keep.bin` keeps the file (`modignore.rs:316-357`, `tests.rs:148-174`, README
  "Ignoring files").
- **`dir/` prunes and `dir/*` does not.** The first records one skipped entry, the second one
  per child (behaviour notes).
- **A pattern that does not parse fails the whole pack**, rather than being dropped, because
  dropping it would ship files the author excluded (`modignore.rs:100-103`, `656-664`,
  `packer.rs:46-50`).

The wiki's "Ignore Files" section says matching "follows gitignore semantics exactly" and places
the file "at the project root". Case-insensitive matching and nested files are both absent from
it. The README at `2c73916` carries both, and the behaviour notes list "fold in the author-facing
section above" as an open item for the wiki.

### 1.4 When it applies

- **Pack.** `ProjectPacker::pack_reporting` resolves the filter from `PackOptions.ignore`
  (`packer.rs:252-274`), whose default is `IgnoreMode::FromProject` (`options.rs:26-39`). It then
  scans each layer once (`packer.rs:276-284`): a loose file at the layer root is checked with
  its parents (`packer.rs:436-444`) and every directory is walked by `ModIgnore::walk`, which
  never descends into an ignored one (`packer.rs:454-482`). `.modpkg` and `.fantome` are two
  `PackFormat`s fed the same `PackPlan`, so they filter identically (`packer.rs:288-300`). The
  returned `PackReport` lists what was excluded, as absolute paths, a pruned directory once
  (`packer.rs:110-128`).
- **Overlay.** `ltk_overlay::FsModContent` loads the filter once per provider and applies it to
  WAD listing, file reads and the rebuild fingerprint (`content.rs:270-281`, `341-351`,
  `362-391`, `435-460`). Its doc says why: "so what an author tests is what the package ships".
- **CLI.** `league-mod pack` drives the same `ProjectPacker`. `league-mod init` writes
  `mod.config.json` and `content/base/` and no `.modignore` (`init.rs:23-75`, `147-152`).
- **Only `content/`.** The README, license, thumbnail and hashtables are found by declaration
  (`packer.rs:348-407`), so nothing outside `content/` is a packing candidate or needs an entry.
  The wiki's Ecosystem Integration page tells creation tools to keep their state in dot-files at
  the project root for that reason, and to add `.modignore` entries only for working files they
  write inside `content/`.

## 2. How ltk-manager touches it now

No file in this repository names `.modignore`, `ModIgnore` or `IgnoreMode`. Every contact is
through a crate default.

### 2.1 Project creation

`Workshop::create_project` (`crates/ltk-manager-core/src/workshop/projects.rs:63-120`) creates
the directory and `content/base`, writes `mod.config.json` and a `README.md`, and nothing else.
The chain to it is `NewProjectDialog.tsx:37,60` to `mutations.ts:60` to
`api.createWorkshopProject` (`src/lib/tauri.ts:427`) to the `create_workshop_project` command
(`src-tauri/src/commands/workshop.rs:23-31`, registered at `src-tauri/src/main.rs:159`).
`projects/tests.rs` holds no test of `create_project`.

The three imports also create projects. The fantome import (`projects.rs:224-295`) and the
modpkg import (`projects.rs:303-336`) unpack archives, which never carry an ignore file. The git
import (`projects.rs:339-431`) moves a repository tree into place, so it keeps whatever
`.modignore` the repository holds.

### 2.2 Pack

`Workshop::pack_project` (`packing.rs:88-150`) calls `ProjectPacker::new(..).pack(..)` with no
options, so the project's `.modignore` applies to both formats. Two things are lost on the way
back:

- **The report.** The `PackReport` is discarded at `packing.rs:124-126` and `139-141`.
  `PackResult` carries the output path, the file name and the format only
  (`workshop/mod.rs:289-293`), and `PackDialog.tsx:48-57` shows those. An ignore rule that
  empties a layer produces a valid, empty package with no word to the creator, which the
  behaviour notes call out: "no shipped consumer surfaces it yet, ltk-manager should."
- **The line number.** `PackError::Ignore` is `#[error(transparent)]` over `ModIgnoreError`
  (`packer.rs:49-50`), whose own message is `Invalid pattern in {path}` with the line number in
  its `source` (`modignore.rs:656-664`). `packing.rs:126` maps the error with `e.to_string()`,
  which renders the top message only.

`ProjectDir::validate` (`packing.rs:14-85`) does not read the filter either. Its "Layer is empty"
warning counts raw directory entries (`packing.rs:56-66`), so a layer whose every file is ignored
passes.

### 2.3 Test

The overlay adds each workshop project as `ltk_overlay::FsModContent::new(path)`
(`crates/ltk-manager-core/src/overlay/mod.rs:126-140`), so Test honours the same filter as
Pack, nested files included.

### 2.4 The tree hides what the packer ships

`scan_layer` in `workshop/content.rs:302-317` drops every entry whose name begins with `.`, and
the problems pass does the same (`problems/engine.rs:424-436`). The packer's walk skips only
`.modignore` itself (`modignore.rs:772-775`, `packer.rs:428-434`). So every dot-file and
dot-directory under `content/` - `.DS_Store`, `.mayaSwatches/`, `.git/`, `.vscode/` - is packed
and injected by Test while having no row in the file tree and no problem checks. An "ignore
this" action on a tree row cannot reach them.

The reverse holds for everything else. The tree lists every non-dot file whatever `.modignore`
says (`content.rs:302-377`), so an ignored file keeps an ordinary row.

### 2.5 Library repacks

`stage_packed` (`mods/archive/storage.rs:449-465`) and `repack` (`mods/archive/repair.rs:533-545`)
also call `ProjectPacker` with default options, so a `.modignore` inside a library mod's tree
applies when a mod is repacked or repaired. Library trees come from unpacking archives, which
carry none, so this only matters if something writes one into a library mod.

### 2.6 The surfaces an ignore action could attach to

| Surface                       | What it holds today                                                              | Where                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The file tree's row menu      | Open, Open in VS Code, Copy Name, Copy Relative Path, Reveal in Explorer, Delete | `ContentTreeContextMenu.tsx:35-119`, spec at `PROJECT_EDITOR.md:1120-1126` |
| The file tree                 | One menu for the tree, aimed at the row that opened it                           | `ContentTree.tsx:200-290`                                                  |
| The primary side panel        | Content, WADs and Strings sections, each with a settings popover in its header   | `ContentSidebar.tsx:137-196`                                               |
| The project row               | Mod details, Game index, Objects, Open project folder                            | `PROJECT_EDITOR.md:1044-1055`                                              |
| The Mod details document      | Thumbnail, categorization, authors and project info cards                        | `DetailsDocument.tsx:80-160`                                               |
| The document registry         | No plain-text document kind                                                      | `documents/registry.tsx:55-147`                                            |
| The pack dialog's result pane | File name, output path, Reveal                                                   | `PackDialog.tsx:48-57`, `145-153`                                          |
| The new project dialog        | Display name, name, author profile, author, description                          | `NewProjectDialog.tsx:175-280`                                             |

The row menu already has what an ignore action needs: the node is a `dir` or a `file`
(`utils/contentTree.ts:5-17`), and the menu computes the layer name and the layer-relative path
(`ContentTreeContextMenu.tsx:48-49`).

## 3. What the default list holds

### 3.1 What the game loads

`LeagueFileKind` in `ltk_file` 0.2.11 names the formats LeagueToolkit recognises: `anm`, `jpg`,
`lightgrid`, `luaobj`, `mapgeo`, `png`, `tga`, `preload`, `bin`, `stringtable`, `skn`, `skl`,
`sco`, `scb`, `tex`, `dds`, `wgeo`, `bnk`, `wpk` and `svg` (`kind.rs:49-74`, and
`from_extension` at `kind.rs:84-116`). The workshop's tree names a row's kind from it
(`workshop/content.rs:352`). It is a list of what the libraries parse, not of what the game
loads, so the hash lists are the wider check.

The CommunityDragon lists at `5e42212` hold about 2.4 million game paths across 639 extensions,
plus the client's LCU paths. The formats a careless default could hide:

| Extension | Game paths | LCU paths | What it rules out                                                |
| --------- | ---------- | --------- | ---------------------------------------------------------------- |
| `.bin`    | 61,825     |           | `*.bin`, even though a glTF export's buffer shares the extension |
| `.png`    | 3,440      |           | Ignoring source images by format                                 |
| `.tga`    | 350        |           | The same                                                         |
| `.jpg`    | 0          | 35,470    | The same, and `LeagueFileKind` lists it                          |
| `.json`   | 1,626      | 18,132    | `*.json`, which is also Ritobin's JSON output                    |
| `.txt`    | 71         |           | `*.txt`, which Ritobin also reads as text                        |
| `.ini`    | 65         |           | `*.ini`, so `desktop.ini` is named exactly                       |
| `.lua`    | 30,147     |           | Any script-shaped extension beyond `.py`                         |

Every extension the default in section 5 names has **zero** hits in both lists: `.py`,
`.ritobin`, `.rito`, `.ma`, `.mb`, `.mel`, `.swatch`, `.blend`, `.max`, `.fbx`, `.gltf`, `.glb`, `.obj`,
`.mtl`, `.dae`, `.psd`, `.psb`, `.xcf`, `.kra`, `.spp`, `.sbs`, `.sbsar`, `.pdn`, `.clip`,
`.bak`, `.tmp` and `.swp`. `.DS_Store` has 8 LCU paths, junk Riot shipped in client plugins, and
none in game WADs. A zero means no known path, which is strong evidence and not proof.

### 3.2 The candidates

| Pattern                                        | Written by                                                   | Source that it is a source or junk file                                                                                                                                                                                                                                                                                                  | Verdict                |
| ---------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `*.py`                                         | ritobin, as its text format's default extension              | [`bin_io_dynamic.cpp` L102-104](https://github.com/moonshadow565/ritobin/blob/d4b8764939d141c1db3ffd186d49bf60fd889b87/ritobin_lib/src/ritobin/bin_io_dynamic.cpp#L102-L104), used for output at [`main.cpp` L196](https://github.com/moonshadow565/ritobin/blob/d4b8764939d141c1db3ffd186d49bf60fd889b87/ritobin_cli/src/main.cpp#L196) | Default                |
| `*.ritobin`                                    | ritobin-lsp, ritobin-tools                                   | [`package.json` L331-336](https://github.com/alanpq/ritobin-lsp/blob/20940a19c8fde3dadcd65df11a89b75605cdfea6/editors/code/package.json#L331-L336), [`convert.rs` L15](https://github.com/LeagueToolkit/ritobin-tools/blob/8ae1e240fc54074d78470a197d3ba745c1d9203e/crates/ritobin-tools/src/commands/convert.rs#L15)                    | Default                |
| `*.rito`                                       | `ltk_ritobin`, ritobin-lsp, ritobin-tools                    | [`lib.rs` L51](https://github.com/LeagueToolkit/league-toolkit/blob/d2a1419ce2bbaf0ca4ab085cd99344370e8df95f/crates/ltk_ritobin/src/lib.rs#L51), [`convert.rs` L127](https://github.com/LeagueToolkit/ritobin-tools/blob/8ae1e240fc54074d78470a197d3ba745c1d9203e/crates/ritobin-tools/src/commands/convert.rs#L127)                     | Default, section 3.3   |
| `*.ma`, `*.mb`                                 | Maya                                                         | [Save Scene Options](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-Basics/files/GUID-5F0D8CCE-8B33-442A-AC61-ACED2B8EA7A8.htm)                                                                                                                                                                                                       | Default                |
| `.mayaSwatches/`                               | Maya Hypershade                                              | [Current Tab options](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-LightingShading/files/GUID-C8C93C6C-502E-4ADA-998E-B1683F0CF3FD.htm): "saved in a .mayaSwatches subdirectory of the directory containing the images"                                                                                                             | Default                |
| `incrementalSave/`                             | Maya                                                         | [Save Scene Options](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-Basics/files/GUID-5F0D8CCE-8B33-442A-AC61-ACED2B8EA7A8.htm), `scenes\incrementalsave`                                                                                                                                                                             | Default                |
| `*.blend`, `*.blend[0-9]*`                     | Blender, and its Save Versions backups                       | [Save & Load](https://docs.blender.org/manual/en/latest/editors/preferences/save_load.html): ".blend1, .blend2, etc."                                                                                                                                                                                                                    | Default                |
| `*.max`                                        | 3ds Max                                                      | [Backing Up Scenes](https://help.autodesk.com/cloudhelp/2024/ENU/3DSMax-Basics/files/GUID-FFCAA5A1-A5C7-4725-AC01-FC9EE8DA8982.htm), autobackups go to `\autoback` by default                                                                                                                                                            | Default                |
| `*.fbx`                                        | Autodesk FBX                                                 | [LoC fdd000558](https://www.loc.gov/preservation/digital/formats/fdd/fdd000558.shtml)                                                                                                                                                                                                                                                    | Default                |
| `*.gltf`, `*.glb`                              | glTF                                                         | [Specification L439-442](https://github.com/KhronosGroup/glTF/blob/26add54ddb3b5fa3f73a9519667d2ae1bde67fad/specification/2.0/Specification.adoc#L439-L442)                                                                                                                                                                              | Default                |
| `*.obj`, `*.mtl`                               | Wavefront                                                    | [LoC fdd000507](https://www.loc.gov/preservation/digital/formats/fdd/fdd000507.shtml), [fdd000508](https://www.loc.gov/preservation/digital/formats/fdd/fdd000508.shtml)                                                                                                                                                                 | Default                |
| `*.dae`                                        | COLLADA                                                      | [khronos.org/collada](https://www.khronos.org/collada/)                                                                                                                                                                                                                                                                                  | Default                |
| `*.psd`, `*.psb`                               | Photoshop                                                    | The wiki's own example, "a .psd next to the textures exported from it". Adobe's PSB page answered `403`                                                                                                                                                                                                                                  | Default                |
| `*.xcf`                                        | GIMP                                                         | [GIMP 2.10 manual](https://docs.gimp.org/2.10/en/gimp-images-out.html): "GIMP's native XCF file format"                                                                                                                                                                                                                                  | Default                |
| `*.kra`, `*~`                                  | Krita, and its backups                                       | [Autosave](https://docs.krita.org/en/user_manual/autosave.html): `myimage.kra~` "in the same folder as your original file"                                                                                                                                                                                                               | Default                |
| `*.spp`, `*.sbs`, `*.sbsar`, `*.pdn`, `*.clip` | Substance Painter and Designer, Paint.NET, Clip Studio Paint | Vendor pages answered `403` or were read as search summaries only                                                                                                                                                                                                                                                                        | Default, see section 8 |
| `Thumbs.db`, `ehthumbs.db`                     | Windows Explorer, Windows Media Center                       | [IThumbnailCache](https://learn.microsoft.com/windows/win32/api/thumbcache/nn-thumbcache-ithumbnailcache#remarks): "a Thumbs.db file within each folder"                                                                                                                                                                                 | Default                |
| `desktop.ini`                                  | Windows                                                      | [Customize folders with Desktop.ini](https://learn.microsoft.com/windows/win32/shell/how-to-customize-folders-with-desktop-ini)                                                                                                                                                                                                          | Default                |
| `.DS_Store`, `._*`                             | macOS Finder, AppleDouble companions                         | [Apple DTS](https://developer.apple.com/forums/thread/690457): "If the file name was foo, this companion file was called ._foo"                                                                                                                                                                                                          | Default                |
| `.git/`, `.svn/`, `.vscode/`, `.idea/`         | Git, Subversion, VS Code, JetBrains                          | [git-init](https://git-scm.com/docs/git-init), [VS Code settings](https://code.visualstudio.com/docs/configure/settings), [JetBrains projects](https://www.jetbrains.com/help/idea/creating-and-managing-projects.html)                                                                                                                  | Default                |
| `*.bak`, `*.tmp`                               | Many tools                                                   | [Backup.gitignore](https://github.com/github/gitignore/blob/9e86bc12f67365b8dd974d3b3f09d166265c5530/Global/Backup.gitignore#L2-L15)                                                                                                                                                                                                     | Default                |
| `*.swp`                                        | Vim                                                          | [`recover.txt` L35-42](https://github.com/vim/vim/blob/90fdb79096deecf73916e20fd76f775ff6389a7d/runtime/doc/recover.txt#L35-L42)                                                                                                                                                                                                         | Default, as a literal  |

`.flb` is not a 3D format. fileinfo.com lists it as a FileMaker label file, and this note reads
the request as `.glb`.

Two placements differ from the common belief. Autodesk puts `.mayaSwatches` beside the texture
images rather than beside the scene, which puts it inside `content/` texture folders, where the
entry does its work. 3ds Max writes its autobackups to `\autoback`, outside the project, so
`*.max` catches only scenes saved into `content/`.

### 3.3 `*.rito` as a build input

`*.rito` is in the default by the maintainer's decision: a built mod never ships a `.rito` file.
A `.rito` file is a source that the build turns into a binary representation through a
transformer pipeline, and only the binary form reaches the package. The
[Game Data](https://wiki.leaguetoolkit.dev/reference/mod-packages/game-data/) proposal says the
same of its PTCH override files under `content/<layer>/game_data/`: packing converts each
`.rito` to `.ptch`, and the package stores the binary form only.

`.modignore` decides which files ship as they are, and the transformer's inputs are outside that
question. So the transformer collects its inputs from the unfiltered tree, and the default's
`*.rito` entry states what the build already does. The same proposal's "A .modignore rule that
matches one is a packing error, not a silent drop" is about its declaration modules, the subject
of that paragraph, and not about override files.

### 3.4 What stays out

- **`*.json` and `*.txt`.** Both are game formats, and the same proposal accepts `.json`
  modules under `game_data/`.
- **Vim's template, `[._]*.s[a-v][a-z]`.** From
  [Vim.gitignore](https://github.com/github/gitignore/blob/9e86bc12f67365b8dd974d3b3f09d166265c5530/Global/Vim.gitignore#L2),
  it matches `.scb` (156,773 game paths), `.skn` (31,610), `.skl` (31,606) and `.sco` (7,737).
  Copying a stock template in whole would hide every mesh a mod ships.
- **`*.bin`.** A glTF export's sidecar buffer shares the extension
  ([Specification L444-445](https://github.com/KhronosGroup/glTF/blob/26add54ddb3b5fa3f73a9519667d2ae1bde67fad/specification/2.0/Specification.adoc#L444-L445)),
  so a `.gltf` exported into `content/` ships its buffer unless that one file is named.

The wiki's Ritobin page says text files "typically use the .bin extension", with `.ritobin` used
by some tools. Ritobin's own source writes `.py`. A text file saved as `.bin` cannot be told from
a game `.bin` by any pattern.

## 4. How other tools teach the syntax

### 4.1 The reference

[gitignore](https://git-scm.com/docs/gitignore), "PATTERN FORMAT", is the syntax every tool below
links to, and section 1.2 matches it line for line apart from case. The sentences a creator most
needs:

> If there is a separator at the beginning or middle (or both) of the pattern, then the pattern
> is relative to the directory level of the particular .gitignore file itself. Otherwise the
> pattern may also match at any level below the .gitignore level.

> It is not possible to re-include a file if a parent directory of that file is excluded.

### 4.2 What a one-click action writes

| Tool                   | Actions                                                                                               | What lands in the file                                                                           | How it points at the syntax                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Desktop         | Ignore file, Ignore folder (one entry per ancestor), Ignore all `.ext` files, Ignore N selected files | The repo-relative path with `[ ] ! * # ?` escaped, `/a/b` for a folder, `*.ext` for an extension | An "Ignored files" settings tab, a textarea over the root `.gitignore` with a caption and a "Learn more about gitignore files" link to git-scm |
| VS Code, Git extension | Add to .gitignore, in the Source Control view only                                                    | The repo-relative path, `\` turned to `/`, `[` escaped, no leading slash                         | Opens `.gitignore` in an editor, appends, and saves, so the result is on screen                                                                |
| JetBrains              | Git, Add to .gitignore or to `.git/info/exclude`                                                      | Not verified                                                                                     | The help page says the file can be edited by hand                                                                                              |
| Unity Version Control  | Add to ignored list: any file of that name, every file with the extension, or the one file            | Not verified. `ignore.conf` is its own dialect, not gitignore                                    | A recommended `ignore.conf` in the docs                                                                                                        |
| Godot                  | Export filter field, no menu action                                                                   | Comma-separated globs                                                                            | The field's label carries the example, "(comma-separated, e.g: \*.cfg, \*.txt, docs/\*)"                                                       |

Sources: GitHub Desktop at `8eb43b9`,
[`filter-changes-list.tsx` L669-757](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/app/src/ui/changes/filter-changes-list.tsx#L669-L757),
[`gitignore.ts` L86-109](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/app/src/lib/git/gitignore.ts#L86-L109)
and
[`git-ignore.tsx` L17-35](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/app/src/ui/repository-settings/git-ignore.tsx#L17-L35).
VS Code at `aa726f5`,
[`repository.ts` L2578-2599](https://github.com/microsoft/vscode/blob/aa726f54f663dc714b7ed2629cbf7e3cd12d2cdd/extensions/git/src/repository.ts#L2578-L2599).
[JetBrains, Set up a Git repository](https://www.jetbrains.com/help/idea/set-up-a-git-repository.html).
[Unity, How to configure the ignore.conf file](https://support.unity.com/hc/en-us/articles/35098938793492-How-to-configure-the-ignore-conf-file)
and [filter pattern](https://docs.unity.com/en-us/unity-version-control/config-files/filter-pattern).
Godot at `cb41ea1`,
[`project_export.cpp` L1825-1833](https://github.com/godotengine/godot/blob/cb41ea115914c61a8329087b4cffbad7477b8427/editor/export/project_export.cpp#L1825-L1833).

### 4.3 What the precedents share

- **Three granularities, the same three.** GitHub Desktop and Unity Version Control both offer
  the file, the folder and the extension, and nothing finer.
- **One file receives every action**, the root one. GitHub Desktop always appends to the root
  `.gitignore`, whatever the path's depth.
- **The file teaches its own syntax.** VS Code opens the file after writing to it, GitHub
  Desktop links git-scm from its editor, and the github/gitignore
  [Unity template](https://raw.githubusercontent.com/github/gitignore/main/Unity.gitignore) opens
  with a comment header naming where it came from. No tool builds a pattern editor.
- **A path is escaped, an extension is not.** GitHub Desktop escapes glob characters in a path
  and writes `*${extension}` raw.
- **Mod and package tools ship defaults.** gmad hard-codes `*thumbs.db`, `*desktop.ini`, `.git*`
  and `*/.DS_Store` ahead of an addon's own `ignore` list
  ([`Addon_Json.h` L105-149](https://github.com/garrynewman/gmad/blob/8cc36b9f3386f1afd049e85a8f31e3745bbd0c4d/include/Addon_Json.h#L105-L149)),
  and npm always excludes `.git` and `.DS_Store`
  ([developers](https://docs.npmjs.com/cli/v10/using-npm/developers)). `ltk_mod_project` has no
  built-in list, so the default file is where that list lives, in plain sight.
- **Not every ignore file is gitignore.** Godot's `.gdignore` is a presence-only marker with no
  patterns ([project organization](https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html)),
  Docker's `.dockerignore` disregards leading slashes and needs `**` for depth
  ([build context](https://docs.docker.com/build/concepts/context/)), and Unity Version Control
  has its own dialect. `.modignore` is gitignore, which is what makes the git-scm page the one
  to link.

Steam Workshop has no exclusion mechanism for an item's content folder
([implementation](https://partner.steamgames.com/doc/features/workshop/implementation)).

## 5. The proposed default

Every entry below is in section 3.2 with a verdict of Default. The header is the teaching: four
example lines covering the extension, the folder, the anchored file and the negation, then the
three rules that differ from what a creator guesses, and the link every tool in section 4 uses.

```gitignore
# .modignore
# Files under content/ that are left out when this project is packed or tested.
# One pattern per line, in .gitignore syntax: https://git-scm.com/docs/gitignore
#
#   *.psd             every .psd file, in any folder
#   scratch/          every folder named scratch, and all it holds
#   /base/notes.txt   one file, counted from content/
#   !keep.psd         brings back a file an earlier line left out
#
# Patterns start at content/, use / even on Windows, and ignore letter case.

# Ritobin text sources, converted into .bin
*.py
*.ritobin
*.rito

# Maya scenes, swatch previews and incremental saves
*.ma
*.mb
.mayaSwatches/
incrementalSave/

# Blender scenes and their numbered backups
*.blend
*.blend[0-9]*

# 3ds Max scenes
*.max

# Model interchange formats, converted into .skn, .skl, .scb and .sco
*.fbx
*.gltf
*.glb
*.obj
*.mtl
*.dae

# Image and texturing sources, exported into .tex and .dds
*.psd
*.psb
*.xcf
*.kra
*.spp
*.sbs
*.sbsar
*.pdn
*.clip

# Operating system files
Thumbs.db
ehthumbs.db
desktop.ini
.DS_Store
._*

# Version control and editor folders
.git/
.svn/
.vscode/
.idea/

# Backups and temporary files
*.bak
*.tmp
*.swp
*~
```

How the matcher reads it:

- **No entry holds a slash**, so each matches at any depth, in every layer, inside and outside
  `.wad.client` folders (`gitignore.rs:511-519`). The header's anchored example is a comment and
  matches nothing.
- **The folder entries are directory-only and prune the walk.** A `.git` _file_, which a
  submodule or a linked worktree leaves, is not matched by `.git/`.
- **Case does not matter.** `incrementalSave/` matches Maya's `incrementalsave` spelling, and
  `Thumbs.db` matches `thumbs.db` (`modignore.rs:11-15`).
- **`*.blend[0-9]*` matches any name with a digit after `.blend`**, `scene.blend1.bak` included,
  which costs nothing.
- **Nothing here reaches outside `content/`.** A `.git/` or `.vscode/` at the project root is
  never a packing candidate, so those entries only catch copies inside `content/`.
- **Every dot entry is invisible in the workshop's tree** (section 2.4), which makes this file
  the only handling `.DS_Store`, `._*`, `.mayaSwatches/` and the editor folders get.
- **A glTF export's `.bin` buffer still ships** (section 3.4).

## 6. Decided

The design the maintainer settled on 2026-09-12, in five rounds over this note. Section 7 names the
code each item attaches to.

### 6.1 The surface

- **The name is "Ignore rules"**, in the project row, the document, the toast and the problem. The
  wiki section keeps the same name.
- **A document, not a dialog.** The project row opens Ignore rules as a document, so it sits beside
  a layer. It draws a plain textarea with line numbers, and no new editor library.
- **It autosaves**, the way the Strings document does, and a line that fails `ModIgnore::parse`
  blocks the save with the line marked. A pattern that fails a pack never reaches disk.
- **A syntax card sits beside the text**, with one example per form, the three rules that differ
  from a creator's guess, and a link to the wiki's Ignore Rules page, which links git-scm.
- **"Add missing recommended rules"** appends the entries of section 5 the file lacks, under a
  comment naming the day. It is an action in the document and never fires on its own.
- **The root file is the UI's file.** Every action writes `<project>/.modignore`. A nested file
  under `content/` shows as a tree row and opens as the same document, so a project that holds one
  is readable.

### 6.2 The default file

- **Written by `create_project` and the fantome and modpkg imports.** A git import keeps the
  repository's own file. A project that has none is offered the default in the document's empty
  state and by the problem rule, and nothing is written behind the creator's back.
- **The text is a constant in ltk-manager core**, pinned by a test, and moves into
  `ltk_mod_project` on the next release so `league-mod init` writes the same file.
- **The content is section 5.**

### 6.3 The content tree

- **Dot-entries are shown.** `scan_layer` stops dropping them, so `.mayaSwatches/` and `.DS_Store`
  have rows. The layer walk and the problems pass keep skipping them.
- **An ignored row is dimmed**, with a tooltip naming the pattern, the file and the line, from
  `ModIgnore::matched_with_parents`. A pruned folder is dimmed, expands, and dims every row inside.
- **The row menu holds three actions**: Ignore this file, Ignore this folder, and Ignore all `.ext`
  files. A path is written anchored, `/<layer>/<relative path>`, with `* ? [ { ! #` and a leading
  space escaped. An extension is written raw, `*.psd`.
- **A toast reports the line.** It shows the literal line written and what it means, and carries
  Undo and Open rules.
- **"Stop ignoring" deletes the row's own anchored line.** Where a broader pattern matched, the
  menu reads "Show rule" and opens the document at that line. Nothing generates a `!` line, which
  keeps the creator out of git's rule that a negation cannot reach under an ignored folder.
- **Freshness is by invalidation.** A save or an action invalidates the content tree query, and the
  query refetches on window focus, so an edit made in another editor lands when the app is next
  focused. No watcher.

### 6.4 Pack and the problems pass

- **The pack dialog reports what was left out.** `PackResult` carries the ignored paths, made
  project-relative, and the result pane shows the count with an expandable list and a link to the
  document. A pruned folder is one row.
- **A bad pattern keeps its line number** through `pack_project`.
- **`ProjectDir::validate` warns** when every file of a layer is ignored.
- **One new rule, "No ignore rules"**, fires for a project with no file, and its fix writes the
  default. No rule reports an unignored source file, so a creator who dropped an entry is not told
  twice.
- **The pass and its repairs skip ignored files**, because a file that does not ship cannot break
  the game.
- **Test reports nothing new.** The tree already shows the dim state the overlay honours.

### 6.5 What it looks like

**A tree row.** An excluded name drops to `text-surface-400` and its file-kind glyph loses its hue
for `text-surface-500`. The hue is the half that carries at this size, and it says the same thing
the tab glyph says. The trailing seat swaps the size for a slashed eye, since a size is a fact
about what ships. A folder keeps its count, dimmed, and takes the mark beside it, and a folder
holding one excluded file out of four still reads 4. Rows stay in alphabetical place, and a search
result carries the same treatment. The tooltip hangs off the mark rather than the row, because the
kind glyph already owns a tooltip of its own.

**The document.** A new `doc-ignore` token, slate, drawn as the same slashed eye. It is the one
unsaturated glyph in a strip of six hues, which reads apart from them better than a seventh hue
between emerald and sky (DS-KIND-HUE). The text sits left with a sticky syntax rail of about 220px
beside it, which folds to a disclosure below roughly 560px, because the document can hold a split
pane. A mono gutter carries the line numbers the tooltips cite, a failing line marks its number in
`danger-text` under a `danger/40` hairline, and the crate's message sits in a footer strip beside
the save state. The toolbar is a `.modignore` chip, "Add missing recommended rules" where entries
are missing, an icon button that opens the file in the OS editor, and the save state. A project
with no file renders the default as ghost text at `text-surface-500` behind a centred card, so the
creator reads what the button writes before pressing it.

**The menu and the toast.** The ignore items are their own group above Delete, in the menu's Title
Case, each on the slashed eye, and the extension item names the extension. The toast is a title, a
`Code` chip holding the literal line, one sentence of plain meaning, and Undo and Open rules.

**Pack.** The result pane carries a disclosure over the dialog's inset panel, mono rows at
`text-meta`, a pruned folder marked as one row, a capped height on `scrollbar-md`, and a link to the
document. A layer emptied by the rules is a warning in the pre-flight list, in the shape the other
pre-flight warnings already take.

### 6.6 How it ships

An EPIC with seven children, no ADR. The design goes in `docs/ux/PROJECT_EDITOR.md`, and the wiki's
Ignore Files section is corrected on case-insensitive matching, nested files and the absence of
built-in ignores.

```
PR 1  the default text, create and import, the document, the docs
PR 2  the filter read, the per-row match, dot-files, the dims
PR 3  the tree actions, the toast, Stop ignoring
PR 4  the pack report, the error line, the empty-layer warning
PR 5  the problems rule, the pass skipping ignored files
```

## 7. Seams

### 7.1 Where the default is written

- `Workshop::create_project`, beside the `README.md` write (`projects.rs:113-117`). The text is
  a constant in core, so a test can pin it.
- The imports (`projects.rs:224-431`) are the other places a project starts, and whether they get
  the default is open (question 1 below).

### 7.2 Where the UI hooks attach

- **The row menu**, `ContentTreeContextMenu.tsx`, for "ignore this file", "ignore this folder" and
  "ignore all `.ext` files". A pattern written into the root file anchors at `content/`, so the
  anchored form of a row is `/<layer>/<relativePath>`, with a trailing `/` for a directory row.
  Any path segment holding `*`, `?`, `[`, `{`, `!`, `#` or a leading space needs a `\` escape,
  since the matcher reads them as syntax.
- **An append command** in core, which the Tauri layer does not have. `ModIgnore::parse` exists
  "for editors" and validates a buffer before it is written (`modignore.rs:141-157`), with the
  caveat that it also reads nested files from disk.
- **The rule behind a match.** `ModIgnore::matched_with_parents` returns a `ModIgnoreMatch`
  whose `ModIgnoreRule` names the pattern, the file and the line (`modignore.rs:341-357`,
  `584-632`). That answers "why is this file not packed" on a row, and is what an "un-ignore"
  would have to edit.
- **The pack report.** `PackReport::ignored_files()` (`packer.rs:118-128`) is dropped at
  `packing.rs:124-126` and `139-141`, and `PackResult` is where a count would travel.
- **Validation.** `ProjectDir::validate` (`packing.rs:14-85`) is where "every file of this layer
  is ignored" would become a warning.
- **The tree's dot filter** (`content.rs:316`), if hidden entries are to be seen or ignored from
  the tree.

### 7.3 Open questions for the maintainer

1. **The imports.** Do the fantome, modpkg and git imports also get the default? The first two
   start from a package with no sources in it, and the third brings the repository's own file.
2. **Existing projects.** Is the default written when a project is opened, offered through a
   problem rule, or left to new projects only?
3. **Who owns the text.** A constant in ltk-manager core, or in `ltk_mod_project` so
   `league-mod init` writes the same file? The behaviour notes assign the starter file to
   "Project templates (ltk-manager)", and `init.rs` writes none today.
4. **Which file an action writes.** Always the root `.modignore`, the way GitHub Desktop always
   writes the root `.gitignore`, or the selected layer's own `content/<layer>/.modignore`?
5. **Ignored rows.** Shown dimmed with the rule that matched them, or hidden? Today an ignored
   file is an ordinary row.
6. **Dot-entries.** The tree hides them and the packer ships them. Does the tree start showing
   them, or does the default stay their only handling?
7. **The pack result.** Is the ignored count surfaced, with paths made project-relative (the
   behaviour notes leave that open), and does the ignore error keep its line number?

## 8. Still unconfirmed

- **The source-file descriptions for `.psb`, `.spp`, `.sbs`, `.sbsar`, `.pdn` and `.clip`.**
  Adobe's pages answered `403`, and the Paint.NET, Clip Studio and Maya `.ma`/`.mb` rows rest
  on search summaries of the vendor pages. That these are editor files is common knowledge but
  not read first-hand here. That no game path uses them is verified.
- **`.flb`.** Identified from fileinfo.com only, a secondary source.
- **Zero hash-list hits.** They cover every known path, and cannot rule out an unhashed one.
- **The wiki's Ritobin page against ritobin's source.** The page says text files typically use
  `.bin`, and the source writes `.py`. Not reconciled.
- **The exact line JetBrains' "Add to .gitignore" and Unity Version Control's "Add to ignored
  list" write.** Neither is documented, and neither source is public.
- **Whether VS Code core has an Explorer exclude action.** The Git extension adds none to the
  Explorer, and the docs name none.
- **The wiki's text.** The host refuses `WebFetch`, so the pages were read with `curl` on
  2026-09-10 and cited by URL without a revision.
