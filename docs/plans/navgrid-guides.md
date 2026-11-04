# Navigation guides in the map editor

> Status: **Stages 1 to 7 built, not checked in the running app** (2026-11-04). Stage 8 waits on
> section 11. Written against this repository at `6feaec3d`,
> `ltk_navgrid` 0.1.0 (league-toolkit #314, released in #315) and the `Map11.wad.client` of the
> installed client, dated 2026-10-21. Section 9 lists the stages.

The map editor draws the server's navigation grid as a guide, as docs/ux/MAP_EDITOR.md
specifies under "Guides", "Tools" and "Problems". This file holds the design that the spec does
not: the facts read out of the game data, the decisions, the wire formats and the stages. The
product rules stay in MAP_EDITOR.md. ADR-0079 records the buffer decision.

## 1. What the game data holds

### 1.1 The files

Map11 ships 13 grids, 8 flag overlays and 6 region overlays under `assets/maps/navgrid/`.
`ltk_navgrid` 0.1.0 reads every one of them and writes each back byte for byte.

| File                                       | Count | Size of one       |
| ------------------------------------------ | ----: | ----------------- |
| `map11/*.aimesh_ngrid`                     |    13 | 9,361,843 bytes   |
| `navgrid_*.ngrid_overlay`                  |     8 | 35 to 3,299 bytes |
| `map11/*.rg_overlay`, `map90/*.rg_overlay` |     6 | 0 to 47,498 bytes |

`aipath.aimesh_ngrid` has these values. All 13 grids of Map11 have the same file size:

| Value                 | `aipath.aimesh_ngrid`                        |
| --------------------- | -------------------------------------------- |
| Version               | 7                                            |
| Cells                 | 295 x 296, 50 units each                     |
| `min_position`        | (-1.1, -71.2, 32.8)                          |
| `max_position`        | (14718.4, 184.5, 14792.2)                    |
| Cell span             | to (14748.9, 14832.8), past `max_position`   |
| Height samples        | 591 x 593, 24.95 units apart                 |
| Sample span           | `min_position` to `max_position`             |
| Sampled heights       | -304.3 to 186.9, below the `y` of the bounds |
| Region tag groups     | 7 of 8 used                                  |
| Cells with bit `0x80` | 26,725 of 87,320, a bit that no tag names    |
| Hint grid             | 3,243,600 bytes, which the client skips      |

The region tag groups are `Music`, `Vfx`, `Ambiance`, `GameplayArea`, `GameplayLane`,
`GameplayPOI` and `GameplayTurretLines`. A group name and a tag name in the grid are the FNV-1
hash of the lowercased name (`ltk_hash::fnv1::hash_lower`), not the FNV-1a of bin names.

### 1.2 The bin side

| Data                | Where                                                         | Shape                                                                                |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Grid path           | `MapNavGrid` component of the `MapContainer`                  | `NavGridPath: String`, `NavGridConfig: Link<NavGridConfig>`                          |
| Grid path of a skin | `MapSkin.mNavigationMesh`                                     | `String`                                                                             |
| Overlays            | `MapNavGridOverlaysComponent` (`0xcf4a55da`) of the container | `overlays: Link<MapNavGridOverlays>`                                                 |
| Overlay list        | `MapNavGridOverlays` (`0xb51e8bff`)                           | `overlays: List2<MapNavGridOverlay>`                                                 |
| One overlay         | `MapNavGridOverlay` (`0xe1127f16`)                            | `name: Hash`, `navGridFileName: String`, `regionsFilename: String`                   |
| Colors              | `NavGridConfig` (`0xbdc90544`)                                | `TerrainConfig: Link<NavGridTerrainConfig>`, `RegionGroups`, `ErrorColor`            |
| Terrain tags        | `NavGridTerrainConfig.tags`                                   | `NavGridTerrainTagDefinition`: `name: Hash`, `flags: U16`, `Color`                   |
| Region tags         | `NavGridRegionGroupDefinition`                                | `groupName: String`, `IsGameplayGroup: Bool`, `tags: List2<{ name: String, Color }>` |

A `Color` that the bin omits is `[0, 0, 0, 255]`. `ErrorColor` defaults to `[0, 0, 255, 255]`.
`map11.bin` and `base_srx.materials.bin` both carry a copy of the overlay list and of the
`NavGridConfig` object that the container links.

**The container and its skins name different grids.** The `MapNavGrid` of `Base_SRX` names
`AIPath_SRX_3.aimesh_ngrid`. The `MapSkin` objects that link `Base_SRX` name
`AIPath.aimesh_ngrid` or `AIPath_SRX_2.aimesh_ngrid`. The three files have different bytes.

**Region tags match by name, not by index.** In `aipath.aimesh_ngrid`, tag 0 of the `Music`
group is the FNV-1 of `Play_mus_map11_location_base`. Tag 0 of the `Music` group of the
`NavGridConfig` is `Unused`. A config tag applies to the grid tag whose FNV-1 name equals the
FNV-1 of the config tag's `name`.

The Map11 terrain tags, in file order. The name column is the `CellFlags` constant of
`ltk_navgrid` for the same value. The bin stores only the hash of the tag name.

| `flags` | `CellFlags`                                           | `Color`           |
| ------: | ----------------------------------------------------- | ----------------- |
|       0 | none                                                  | 0, 255, 0         |
|       2 | `WALL`                                                | omitted, so black |
|      66 | `TRANSPARENT_WALL`                                    | 250, 250, 250     |
|       1 | `GRASS`                                               | 0, 255, 255       |
|     256 | `EXPOSED`                                             | 255, 255, 0       |
|       4 | `TRANSIENT`                                           | 0, 0, 255         |
|     514 | `OPAQUE_WALL`                                         | 64, 0, 0          |
|    1088 | `ONLY_PASSABLE_BY_TEAM_ORDER`                         | 128, 64, 64       |
|    2112 | `ONLY_PASSABLE_BY_TEAM_CHAOS`                         | 128, 64, 128      |
|    1025 | `GRASS_ONLY_PASSABLE_BY_TEAM_ORDER`                   | 128, 16, 16       |
|    2049 | `GRASS_ONLY_PASSABLE_BY_TEAM_CHAOS`                   | 96, 80, 80        |
|    5184 | `ONLY_PASSABLE_BY_TEAM_ORDER_NEUTRAL_ZONE_VISIBILITY` | 255, 192, 192     |
|    6208 | `ONLY_PASSABLE_BY_TEAM_CHAOS_NEUTRAL_ZONE_VISIBILITY` | 255, 192, 255     |
|       3 | `GRASS_WALL`                                          | 128, 255, 255     |

### 1.3 The overlays

An overlay's `name` is the FNV-1a of `NavGrid_<state>`. No object of `map11.bin` or
`base_srx.materials.bin` references an overlay name, so the client bins do not show which code
switches an overlay on.

| `name`                              | Flag overlay                | Region overlay           | Matches                    |
| ----------------------------------- | --------------------------- | ------------------------ | -------------------------- |
| `NavGrid_Chemtech` (`0xbe13cf16`)   | `NavGrid_Chemtech`          | `Map11/Regions_chemtech` | Visibility flag `Chemtech` |
| `NavGrid_Infernal` (`0xc2605388`)   | `NavGrid_Infernal_SEASONAL` | `Map90/Regions_infernal` | Visibility flag `Infernal` |
| `NavGrid_Mountain` (`0x10894048`)   | `NavGrid_Mountain_SEASONAL` | `Map90/Regions_mountain` | Visibility flag `Mountain` |
| `NavGrid_Ocean` (`0xf71b8213`)      | `NavGrid_Ocean_SEASONAL`    | `Map90/Regions_ocean`    | Visibility flag `Ocean`    |
| `NavGrid_Tunnel` (`0x28c7e141`)     | `NavGrid_Tunnel_Base`       | `Map90/Regions_tunnel`   | Pit definition `Tunnel`    |
| `NavGrid_Cup` (`0xef740a29`)        | `NavGrid_Cup_Base`          | `Map90/Regions_cup`      | Pit definition `Cup`       |
| `NavGrid_AtakhanBot` (`0xf502f38e`) | `NavGrid_AtakhanBot`        | `Map90/Regions_cup`      | Nothing                    |
| `NavGrid_AtakhanTop` (`0x875d79ec`) | `NavGrid_AtakhanTop`        | `Map90/Regions_cup`      | Nothing                    |

A visibility flag is a `Map.VisibilityFlagDefines` entry, matched by `PublicName`. A pit
definition is an entry of the unnamed `Map` field `0xd31ac6ce`, which MAP_EDITOR.md "The map state"
records as unread by the client.

Applied to `aipath.aimesh_ngrid`, every rectangle of every overlay is inside the grid. The flag
overlays change 8 to 1,249 cells and the region overlays 0 to 9,931 cells. Overlay values
include 0 and differ from the base cells, so an overlay value replaces the whole word of its
cell. `ltk_navgrid` implements that rule in `NavGrid::apply_overlay` and
`NavGrid::apply_region_overlay`.

## 2. Scope

In scope:

- The Navgrid guide: the cells of the grid in the shown map state, colored by terrain or by one
  region group
- The Navgrid overlays guide: the overlays that the shown map state switches on, and a switch per
  overlay
- Selecting and inspecting one cell
- The Guides snap switch
- The Conformance view mode, with the brush and wall cell outlines
- The `Ground off navgrid` check

Out of scope, each for its own reason:

- `Uncovered brush cell` and `Uncovered wall cell`. Both need a rule for which meshes are brush,
  and section 11 lists it as open.
- Navgrid painting. MAP_EDITOR.md lists it under "Ideas for review", and the guides stay
  read-only.
- The navgrid on the Minimap pane. It follows the pane.
- A hover readout of the cell under the pointer. The map viewport has no hover readout of any
  kind.

## 3. Decisions

### 3.1 The backend resolves the bin side into the map model

`MapModel` gets one field, `nav_grid: Option<MapNavGridModel>`. The backend reads the
`MapNavGrid` and `MapNavGridOverlaysComponent` components of the container, follows the two
links (ADR-0068), resolves each file path to an `AssetRef` with `assets.locate`, and reads the
colors out of the linked `NavGridConfig`. The webview receives names and hashes it can compare,
and never hashes a string:

- each region group and region tag carries the FNV-1 of its name, the hash that the grid stores
- each overlay carries the visibility flag bit that its name matches, if one does

`MapSkin.mNavigationMesh` is read with the map's own bin, as the grass tints are, and fills
`skin_grid`.

### 3.2 One buffer per file, and the webview applies the overlays

ADR-0079. The `ltk-asset` scheme gets one form, `navgrid`. On a `.aimesh_ngrid` it returns an
`LTKN` buffer, and on a `.ngrid_overlay` or `.rg_overlay` it returns an `LTKO` buffer
(section 4). The webview keeps the base grid's arrays, copies them, and writes the switched-on
overlays into the copy. A change of map state costs no fetch.

### 3.3 The container's grid comes first

The guide draws the file that `MapNavGrid.NavGridPath` names. The skin grid is the
`mNavigationMesh` of the first `MapSkin` in file order that links the container. `read_map`
takes no skin, so the skin grid does not follow the variant menu. If the container has no
`MapNavGrid`, the guide draws the skin grid. If both exist and name different files, the Guides
menu offers the skin grid as Skin grid. Which file the client loads is open (section 11).

### 3.4 Overlays follow the visibility layers

An overlay whose `name` matches a visibility flag is on when the viewport's visibility layer mask
has that flag's bit. Every other overlay is a switch in the Guides menu and starts off. Follow
map state is a switch in the same menu and starts on. With it off, every overlay is a manual
switch.

The webview applies the overlays that are on to a copy of the base grid in the order of the
overlay list. For each overlay, the flag overlay applies first and the region overlay second. A
value outside the grid is skipped. This is the rule of `ltk_navgrid` 0.1.0.

### 3.5 A cell's color

**Terrain.** A cell takes the color of the terrain tag with the most bits, among the tags whose
`flags` bits are all set in the cell's word. Of two such tags with the same number of bits, the
earlier one in the tag list wins. Bits that no tag has, such as `0x80`, do not stop a match. The
tag with `flags` 0 matches every cell. A cell that matches no tag takes `ErrorColor`.

**Region group.** The Guides menu lists the groups of the `NavGridConfig`. A cell takes the color
of the config tag whose FNV-1 name equals the name of the cell's grid tag in that group. A cell
whose grid tag has no config tag takes `ErrorColor`.

The guide draws at 50% opacity, the muted drawing of MAP_EDITOR.md "Guides".

### 3.6 The guide is a top-down projection onto the map's geometry

The guide tints the surfaces that the backdrop draws, from above. The backdrop draws its
`BufferGeometry` a second time with a projection material (`NavProjectionMesh.tsx`,
`navProjection.ts`). The second mesh shares the geometry and the groups that the backdrop writes
for the meshes in view, so a hidden mesh, a visibility layer that is off and a controller state
that is not shown take no tint. Its material array has one entry per entry of the backdrop's
array, so every group resolves to a projection material or to a skipped entry:

- A surface that writes depth and discards no fragment takes the projection on every fragment,
  blended or not.
- A surface that writes depth and discards below an alpha test, such as a foliage card or the
  ground decals of Summoner's Rift, takes a masked projection material of its own. That material
  samples the surface's base texture and discards below the same threshold, so it tints the
  texels that the surface keeps. Such a surface without a base texture, or before its texture
  loads, takes no projection.
- A surface that writes no depth takes no projection. The projection of the surface behind it
  passes the depth test and tints the pixel.

A depth-writing surface hides the ground behind it from the ground's own projection, so a
decal that took no projection would leave an untinted patch of its own shape on the guide.

The fragment shader maps the fragment's world `x` and `z` in engine space over the cell span,
`min` to `min + count * cellSize`, and reads the cell's texel with `texelFetch`. A `DataTexture`
of one RGBA8 texel per cell holds the colors at 50% alpha. A fragment outside the cells discards.
A face fades out between a normal `y` of 0.2 and 0.5, so a wall or a cliff does not stretch one
cell's color down its height. The stored normal decides the fade, so a face that points down
takes no tint from either side.

The material blends with straight alpha, writes no depth, tests `LessEqual` and draws with a
polygon offset toward the camera. A stencil bit, `0x80`, lets each pixel take the tint once, so
two coplanar surfaces at one pixel do not blend the tint twice. The particle stencil masks use
the six low bits, and the renderer clears the stencil each frame.

The mesh draws inside the backdrop's `AXIS_SIGN` group, so its positions and normals are in
engine space and the shader undoes no mirror. The conformance surface reads its positions the
same way. The mesh draws in the
`lit`, `unshaded` and `untextured` view modes. `wireframe` draws no surface, and `conformance`
already colors the surfaces by the navgrid.

A change of overlays, of colors or of color mode writes the cell texture. A change of selection
writes a selection texture of one R8 texel per cell. A selected cell draws a 2-pixel outline in
the gizmo color at its edges, in the same shader. Each write requests a frame.

**Height cutoff.** A fragment more than the cutoff above the navgrid's sampled height at its `x`
and `z` discards, so tree canopies, roofs and tall props stay untinted. A fragment outside the
height samples, or with the cutoff off, takes the tint. The cutoff reads the `R32F` height
texture of the conformance surface (section 3.7), and the backdrop uploads that texture once for
both. The projection binds the texture only while the cutoff is on.

Three alternatives were rejected:

- An instanced quad per cell, 87,320 instances at the cell heights. It draws steps at every cell
  edge, and a color change rewrites an instance attribute of the same size as the texture.
- A heightfield mesh at the navgrid heights, with a vertex per height sample. It floats over the
  ground or sinks under it wherever the two differ, and it covers buildings and props with a flat
  sheet. The Conformance view mode shows where the two differ.
- A projection in the backdrop's own materials. It changes every material program of the map,
  and a translated program does not take a chunk.

### 3.7 Conformance is a surface of the backdrop

`ViewMode` gets `conformance`, and `surfaceOf` maps it to a `conformance` surface. The view mode
menu lists it when the map has a navgrid. The surface colors each fragment by its height minus
the navgrid height at its world `x` and `z`:

- The navgrid heights are an `R32F` texture of the height samples. The shader interpolates four
  `texelFetch` reads, because WebGL2 does not filter a 32-bit float texture without an extension.
- A fragment whose normal has a `y` under 0.7 draws neutral grey. Walls and cliffs are not
  ground.
- A difference inside the threshold draws neutral. Above it, the fragment draws warm. Below it,
  the fragment draws cool. The threshold is a viewport setting, default 20 units.
- Outside the samples, the fragment draws as `untextured`.

The view mode also draws the outlines of the brush cells and the wall cells: one line segment on
each cell edge between a cell with the bit and a cell without it, at the navgrid height. The
segments build in the webview from the composed flags, as `RegionBoundaries.tsx` builds its lines.

### 3.8 The conformance check runs in the backend

`map_conformance` is a command of the map document. It takes the grid source, the indices of the
overlays that are on, the shown visibility flags and controller states (`ShownMeshes`), the
threshold and the open geometry document, and returns the failing areas:

1. Compose the grid with `NavGrid::apply_overlay` and `apply_region_overlay`.
2. Bucket the upward triangles (normal `y` at least 0.7) of the meshes that the shown map state
   draws into the cell grid by their `x` and `z` bounds.
3. For each cell without `WALL`, intersect the vertical line through the cell center with the
   triangles of its bucket. Keep the intersection height nearest to
   `NavGrid::sampled_height_at`.
4. A cell fails if its difference is over the threshold, or if no triangle covers it.
5. Group the failing cells into 4-connected areas. Report each area with its cell count, its
   largest difference and its center.

The check reads the `.mapgeo` that the backend holds for `map_edit`, so it sees unsaved mesh
edits. It reports into the shell first (stage 7). A problems pass rule follows in stage 8, when
the open question of section 11 on game files is settled.

### 3.9 A cell is a guide that can be selected

With Pick cells on in the Guides menu, a click that reaches no placeable marker selects a cell
guide `{ kind: "navCell", x, y }` at the point where its ray meets a shown mesh. The point is the
mesh hit that the click picking computes, in engine space, and `cellAt` names the cell under it.
A point above the height cutoff (section 3.6) selects the mesh, as a click with Pick cells off
does. A click that meets no mesh selects no cell. The inspector shows the cell:

- cell `x` and `y`, the world center and the cell height
- the terrain tag that colors it, and its full word in hex with the bits that no tag has
- the tag of each region group, by name
- the overlays that changed the cell in the shown state

A cell guide is read-only, as every guide is. `F` frames it.

### 3.10 Guides snapping

The Guides snap switch moves a dragged or placed position to the center of its cell, at the cell
height. The math is `cellAt` and `cellCenter` of section 5 in engine space, applied before the
`AXIS_SIGN` mirror.

## 4. Wire formats

Both buffers are little-endian and their blocks are 4-byte aligned. The webview builds typed
array views over the received bytes and does not copy them (ADR-0044).

### 4.1 `LTKN` v1, a grid

```text
magic          u32   0x4E4B544C, `LTKN`
version        u32   1
xCells         u32
yCells         u32
cellSize       f32
min            3 * f32
max            3 * f32
xSamples       u32
ySamples       u32
xSpacing       f32
ySpacing       f32
groupNames     8 * u32           FNV-1, 0 for an unused group
tagNames       8 * 16 * u32      FNV-1, group-major
flags          xCells * yCells * u16, then 2 bytes of padding if the count is odd
regionTags     xCells * yCells * u32
heights        xCells * yCells * f32
samples        xSamples * ySamples * f32
```

The header is 604 bytes. Summoner's Rift is 2,275,656 bytes, a quarter of the file. The pathfinding record, the region tag `name2` words and the hint grid are left out.

### 4.2 `LTKO` v1, an overlay

```text
magic          u32   0x4F4B544C, `LTKO`
version        u32   1
kind           u32   1 flags, 2 region tags
rects          u32
per rect       x i32, y i32, width u32, height u32,
               then width * height values: u16 for flags, padded to 4 bytes, u32 for region tags
```

An empty `.rg_overlay` file is an `LTKO` buffer with no rects.

## 5. The model

```rust
/// The navigation grid of a map and the data that colors it.
pub struct MapNavGridModel {
    /// The grid that the guide draws, per section 3.3.
    pub grid: AssetRef,
    /// Where `grid` came from.
    pub source: NavGridSource,
    /// The skin's grid, if it differs from `grid`.
    pub skin_grid: Option<AssetRef>,
    pub overlays: Vec<MapNavGridOverlay>,
    pub terrain_tags: Vec<NavTerrainTag>,
    pub region_groups: Vec<NavRegionGroup>,
    pub error_color: [u8; 4],
}

pub enum NavGridSource { Container, Skin }

pub struct MapNavGridOverlay {
    /// The file stem of `navGridFileName`, such as `NavGrid_Ocean_SEASONAL`.
    pub label: String,
    /// The visibility flag bit that the overlay's name matches.
    pub flag_bit: Option<u8>,
    /// `None` if the path is empty or resolves no file.
    pub flags: Option<AssetRef>,
    pub regions: Option<AssetRef>,
}

pub struct NavTerrainTag {
    /// The resolved tag name, else the `CellFlags` constant for `flags`, else the hash in hex.
    pub name: String,
    pub flags: u16,
    pub color: [u8; 4],
}

pub struct NavRegionGroup {
    pub name: String,
    /// FNV-1 of the lowercased name, as the grid stores it.
    pub name_hash: u32,
    pub gameplay: bool,
    pub tags: Vec<NavRegionTag>,
}

pub struct NavRegionTag {
    pub name: String,
    pub name_hash: u32,
    pub color: [u8; 4],
}
```

The webview side is `src/modules/viewport/assets/parsing/navGridBuffer.ts`:

```ts
interface NavGrid {
  xCells: number;
  yCells: number;
  cellSize: number;
  min: [number, number, number];
  max: [number, number, number];
  xSamples: number;
  ySamples: number;
  xSpacing: number;
  ySpacing: number;
  groupNames: Uint32Array;
  tagNames: Uint32Array;
  flags: Uint16Array;
  regionTags: Uint32Array;
  heights: Float32Array;
  samples: Float32Array;
}

function readNavGridBuffer(bytes: ArrayBuffer): NavGrid;
function readNavGridOverlayBuffer(bytes: ArrayBuffer): NavGridOverlay;
function applyOverlays(base: NavGrid, overlays: readonly NavGridOverlay[]): NavGrid;
function cellAt(grid: NavGrid, x: number, z: number): [number, number] | null;
function cellCenter(grid: NavGrid, x: number, y: number): [number, number, number] | null;
function sampledHeightAt(grid: NavGrid, x: number, z: number): number | null;
```

`applyOverlays` copies `flags` and `regionTags` and shares the other arrays with `base`. The
three lookups follow `world_to_cell`, `cell_center` and `sampled_height_at` of `ltk_navgrid`
0.1.0, and their tests use the cases of the crate's tests.

## 6. The shell

**Guides menu.** The top bar gets the Guides menu that MAP_EDITOR.md "Guides" specifies, right of
the Show menu. Its navgrid entries:

| Entry            | Kind                | Default                            |
| ---------------- | ------------------- | ---------------------------------- |
| Navgrid          | Switch              | On                                 |
| Pick cells       | Switch              | Off                                |
| Height cutoff    | Switch              | Off, 150 units when switched on    |
| Color by         | Choice              | Terrain                            |
| Overlays         | Submenu             |                                    |
| Follow map state | Switch, in Overlays | On                                 |
| One per overlay  | Switch, in Overlays | Per section 3.4                    |
| Skin grid        | Switch              | Off, listed if section 3.3 applies |

Color by lists Terrain, then each region group by `groupName`, gameplay groups first. The
switches persist per user in `workshopLayout.ts` as the Show menu's flags do. The overlay
switches belong to the map document and do not persist.

**Height cutoff popover.** While the Navgrid guide is on, the top bar shows a popover button
right of the Guides menu. The popover holds a switch for the cutoff and, while the switch is on,
the height as a stepper field in steps of 25 units with a minimum of 0. The cutoff persists per
user as `previewNavGridCutoff`, null while it is off. Switching it on sets 150 units. The reset
switches it off. The Guides menu's Height cutoff entry is the same switch.

**Outliner.** The Guides group lists Navgrid with an eye, and under it one row per overlay with
an eye that is the overlay's switch. Each row carries the guide lock.

**View mode menu.** Conformance follows Wireframe. A viewport without a navgrid does not list it
and draws Lit while the shared view mode setting is Conformance.

**Conformance popover.** While the drawn mode is Conformance, the top bar shows a popover button
next to the view mode menu. The popover holds the threshold as a stepper field, persisted per
user with a default of 20 units, and the failing areas of `map_conformance`. The check runs while
the popover is open. A row frames its area at the navgrid height. Stage 8 moves the areas to the
Problems pane.

## 7. Where the code goes

| Piece               | Where                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Dependency          | `ltk_navgrid = "0.1"` in the workspace `Cargo.toml`, used by `ltk-manager-assets` and `ltk-manager-game`       |
| Bin side            | `crates/ltk-manager-game/src/map/navgrid.rs`, beside `lighting.rs`                                             |
| Model field         | `MapModel.nav_grid` in `crates/ltk-manager-game/src/map.rs`                                                    |
| Buffers             | `crates/ltk-manager-assets/src/preview/navgrid.rs`, `PreviewRequest::NavGrid`                                  |
| Form                | `navgrid` in `src-tauri/src/protocol.rs` and `src/lib/previewUrl.ts`                                           |
| Decoder and lookups | `src/modules/viewport/assets/parsing/navGridBuffer.ts`                                                         |
| Color rule          | `src/modules/viewport/assets/parsing/navGridColors.ts`                                                         |
| Overlay switches    | `src/modules/workshop/bin/map/utils/navGuide.ts`, `navGuide` in `mapScene.tsx`                                 |
| Query               | `viewportQueries.navGrid` in `src/modules/viewport/assets/api/queries.ts`                                      |
| Guide               | `src/modules/viewport/scene/components/NavProjectionMesh.tsx`, `navProjection.ts`, `useNavGrid.ts`             |
| Height cutoff       | `src/modules/workshop/bin/map/components/NavCutoffControl.tsx`                                                 |
| Cell outlines       | `src/modules/workshop/bin/map/components/NavGridOutlines.tsx`                                                  |
| Conformance surface | `src/modules/viewport/scene/utils/viewMode.ts`, `Backdrop.tsx`                                                 |
| Conformance check   | `crates/ltk-manager-game/src/map/conformance.rs`, `map_conformance` in `src-tauri/src/services/preview/map.rs` |
| Cell inspector      | `src/modules/workshop/bin/map/components/NavCellInspector.tsx`                                                 |

## 8. Tests

- `navgrid.rs` (game): the `Base_SRX` fixture resolves `AIPath_SRX_3` from the container, the
  skin grid, 8 overlays with the flag bits of section 1.3, 14 terrain tags and 7 region groups.
- `navgrid.rs` (assets): an `LTKN` round trip of a hand-built grid, the padding after an odd
  flag count, and an `LTKO` buffer for an empty `.rg_overlay`.
- `navGridBuffer.test.ts`: the decoder over a buffer that the Rust test writes as a fixture,
  `applyOverlays` with a rectangle partly outside the grid and two overlapping rectangles, and the
  three lookups with the cases of the `ltk_navgrid` tests.
- The color rule of section 3.5: `0x0082` takes the color of `WALL`, and `0x0442`, which
  `TRANSPARENT_WALL` and `ONLY_PASSABLE_BY_TEAM_ORDER` both match with two bits, takes
  `TRANSPARENT_WALL`, the earlier tag.
- `conformance.rs`: a flat plane over a flat grid has no area, a plane raised by the threshold
  plus one unit fails every walkable cell, and a hole fails the cells it uncovers.

## 9. Stages

| Stage | Work                                                          | Needs         |
| ----- | ------------------------------------------------------------- | ------------- |
| 1     | Dependency, bin side, `MapModel.nav_grid`                     |               |
| 2     | `LTKN` and `LTKO` buffers, the `navgrid` form, the decoder    | 1             |
| 3     | Navgrid guide with terrain colors, Guides menu, outliner rows | 2             |
| 4     | Overlays, Follow map state, region group colors, Skin grid    | 3             |
| 5     | Cell selection, inspector, Guides snapping                    | 3             |
| 6     | Conformance view mode and cell outlines                       | 3             |
| 7     | `map_conformance` and the shell's area list                   | 6             |
| 8     | `Ground off navgrid` as a problems pass rule                  | 7, section 11 |

Each stage is usable without the next one. Stages 4, 5 and 6 are independent of each other.

## 10. Cost

| Item                | Summoner's Rift                           |
| ------------------- | ----------------------------------------- |
| `LTKN` buffer       | 2.3 MB, fetched once per grid             |
| Projection pass     | The backdrop's drawn groups a second time |
| Cell texture        | 295 x 296 RGBA8, 349 KB                   |
| Selection texture   | 295 x 296 R8, 87 KB                       |
| Height texture      | 591 x 593 `R32F`, 1.4 MB, uploaded once   |
| Overlay application | 18,302 values with every overlay on       |

The conformance check visits every upward triangle once to bucket it and every walkable cell
once. Stage 7 measures it on Summoner's Rift and adds progress if it takes longer than a second.

## 11. Open questions

| Question                                                                                        | What it decides                                       |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Does the client load `MapNavGrid.NavGridPath` or `MapSkin.mNavigationMesh`?                     | Section 3.3, and whether Skin grid stays              |
| Which code switches an overlay on, and does it apply overlays over each other or over the base? | Section 3.4                                           |
| Does a pit controller of the state menu map to the `Cup` and `Tunnel` overlays?                 | Whether those two follow the map state                |
| Which meshes count as brush?                                                                    | `Uncovered brush cell` and `Uncovered wall cell`      |
| Can a problems pass rule read a game file, such as a navgrid that no layer ships?               | Stage 8                                               |
| Does the server read the client's navgrid?                                                      | Already open in MAP_EDITOR.md. Painting depends on it |

## 12. Risks

- **The projection and a translated program disagree on depth.** The projection draws the
  geometry with the stock vertex transform. A translated program that moves its vertices, such as
  swaying foliage, writes a depth that the projection's fragments do not reach, and that surface
  takes no tint. The polygon offset covers a difference of rounding only.
- **The terrain match differs from the client's.** Section 3.5 is inferred from the tag table,
  not traced. A cell that the client colors differently shows in the cell inspector, which lists
  the full word.
- **A shipped map without a `NavGridConfig`.** The guide then colors with a fixed palette from the
  `CellFlags` constants, and the menu's Color by lists Terrain only.
