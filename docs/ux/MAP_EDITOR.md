# Map editor

The map editor is the map shell with its editing tools enabled. It authors every part of a League
map that the client reads: geometry, materials, lighting, placeables, visibility states, the
minimap, the map-wide textures and the map settings. It also shows the data that the server owns,
such as the navigation grid and the structures, as read-only guides that the authored data is
checked against.

The map shell, its four panes and the read-only behavior are specified in docs/ux/BIN_EDITOR.md,
under "A map's files". The pane arrangement, the sandbox and the edit pipeline are specified there
under "The shell", "How the panes are arranged" and "Editing". A section named in quotes here with
no document is a section of that one. The map data facts this spec depends on are in
docs/research/map-data-layout.md, docs/research/map-materials.md,
docs/research/ltk-mapgeo-surface.md and docs/research/map-minimap-mapping.md. The class facts come
from the meta wiki (<https://meta-wiki.leaguetoolkit.dev/domains/map/>) and from the shipped map
bins of the installed client.

## Changes

| Date       | Change                                                    |
| ---------- | --------------------------------------------------------- |
| 2026-10-31 | Add the menu bar, one key table and the combined save     |
| 2026-10-19 | Record the import preview, export and reimport status     |
| 2026-10-19 | Custom map skin from geometry keeps the skin's placeables |
| 2026-10-19 | Record the New project Map entry status                   |
| 2026-10-18 | Split the viewport toolbar into a tool rail and a top bar |
| 2026-10-18 | Record the mesh import status and the texture folder      |
| 2026-10-18 | Record the Lighting pane, map settings and icons status   |
| 2026-10-18 | Record the visibility authoring status                    |
| 2026-10-17 | Record the placeable tools and the client code research   |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

## Goals

- Author a complete map: every file and bin class that the client reads for a map
- Reach parity with the data that Riot's internal map tooling writes, for the client-side part
- Extend the existing map shell, so a map opens the same way for reading and for editing
- Write every change through the sandbox, the layer and the declaration pipeline that bins use
- Keep the server-owned data visible and unchanged, and check the authored data against it
- Bake lightmaps, probes, the light grid and the minimap inside the editor
- Keep the round trip to a DCC tool short: export to glTF, edit, import back

## Feature status

The status words are the ones [Project editor](PROJECT_EDITOR.md#feature-status) defines.

| Feature                                              | Status      | Note                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Map shell, outliner, visibility, read-only inspector | Available   | BIN_EDITOR.md, "A map's files"                                                                                                                                                                                                                                           |
| Placeable picking and box select                     | Available   | Screen-space icons only                                                                                                                                                                                                                                                  |
| Editable placeable inspector                         | In progress | Fields edit in place. Rename, duplicate and delete in the header                                                                                                                                                                                                         |
| Placeable gizmo                                      | In progress | Move, rotate, scale, world or local axes (X), grid snap with Ctrl to invert, typed transform fields, End drops to the floor                                                                                                                                              |
| Place, duplicate, delete and rename placeables       | In progress | All four work. The target chunk is picked in the place menu or the outliner                                                                                                                                                                                              |
| Draw every placeable kind                            | In progress | An icon per kind, light reach and frustums, probe and banner boxes, paths, volume boxes, light region polygons, region boundaries with their walls                                                                                                                       |
| Region boundary editing                              | In progress | Vertices drag in the viewport, an edge knob inserts one, Alt and a click removes one. `DrawHeight` and the colors edit in the inspector                                                                                                                                  |
| Map settings                                         | In progress | The inspector with nothing selected: container, skin, audio, fog of war, minimap, flags and dependency sections. No dependency picker                                                                                                                                    |
| Lighting pane                                        | In progress | Every section of the table, with Add for a missing component and the sun direction handle. Edits draw before the save                                                                                                                                                    |
| Lighting volumes and light regions                   | In progress | Listed and placed from the Lighting pane, drawn as a box and a polygon. The volume extent and the polygon points do not drag yet                                                                                                                                         |
| Visibility authoring                                 | In progress | Drop to assign, row menus, New controller, child parents, layers named by flag                                                                                                                                                                                           |
| Minimap render                                       | Planned     | Top-down render to a 512x512 `.tex`                                                                                                                                                                                                                                      |
| Map texture painting                                 | Planned     | Grass tint, fog of war overlay, terrain paint                                                                                                                                                                                                                            |
| Mesh picking                                         | In progress | A click picks a marker first, then the nearest shown mesh along the ray, tested by bounds first                                                                                                                                                                          |
| Scene outliner                                       | In progress | Meshes and placeables, context menus, drag to reparent, per-object eyes                                                                                                                                                                                                  |
| Mesh transforms, materials, flags                    | In progress | Move, rotate, scale, layers, controller, region, materials, quality, culling, duplicate, delete. Edits arrive as mesh deltas                                                                                                                                             |
| Save a `.mapgeo`                                     | In progress | Ctrl+S, the toolbar, before Test, on a quit that saves, and when the scene closes                                                                                                                                                                                        |
| Lightmap bake                                        | Planned     | After mesh editing                                                                                                                                                                                                                                                       |
| Add meshes from glTF, FBX, OBJ and NVR               | In progress | Add mesh in the toolbar and a dropped file open the dialog, which previews the meshes in the shown map. No Palette entry yet                                                                                                                                             |
| Export selection to glTF                             | In progress | The outliner menu exports the selected meshes, and Export in the toolbar the whole map, as `.glb`                                                                                                                                                                        |
| Reimport a mesh                                      | In progress | The outliner menu of one mesh. Matches by the glTF extras, then by mesh name, else the dialog asks                                                                                                                                                                       |
| Map entry in New project                             | In progress | SR, ARAM and Arena, the three starting points and the skin to start from. Custom map skin from geometry copies the skin's container with only its controller and region meshes, and the geometry is added with Add mesh. No shipped container declares LOD files to copy |
| Cubemap probe bake                                   | Blocked     | Needs a DDS cubemap writer                                                                                                                                                                                                                                               |
| Light grid bake                                      | Blocked     | Needs a `LightGrid.dat` v3 writer                                                                                                                                                                                                                                        |
| Navigation guides                                    | Blocked     | No `.aimesh_ngrid` reader exists                                                                                                                                                                                                                                         |
| Conformance checks                                   | Blocked     | Needs the navigation guides                                                                                                                                                                                                                                              |
| Navgrid painting                                     | Proposed    | See Ideas for review                                                                                                                                                                                                                                                     |
| Scatter brush                                        | Proposed    | Places props and particles over an area                                                                                                                                                                                                                                  |

## Scope

The editor covers the data that the client reads. A shipped map mod changes what the local player
sees and hears. It does not change the match that the server simulates. The game runs on Riot's
servers, in a normal game or the Practice Tool. A private server is not a target.

**The first version covers three maps.** Summoner's Rift (Map11), Howling Abyss (Map12) and Arena
(Map30). Arena composes its sub-maps with `MapContainsOtherMaps`, and each sub-container opens as a
map document of its own. The TFT boards of Map22 are out of scope. Their camera templates,
cutscene and transition components have no editor support, as the map-skins built-in mod already
excludes Map22 (ADR-0052).

| Area                                                                                                       | Who owns it                                  | What the editor does                            |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Geometry, materials, textures                                                                              | Client                                       | Edits                                           |
| Lighting, sky, fog, post effects, shadows                                                                  | Client                                       | Edits                                           |
| Light grid, lightmaps, cubemap probes                                                                      | Client                                       | Edits and bakes                                 |
| Cosmetic placeables: particles, audio, lights, props, locators, banners                                    | Client                                       | Edits                                           |
| Cosmetic entity templates: `VfxEntityTemplate`, `CharacterMeshEntityTemplate`, `EnvironmentEntityTemplate` | Client, unless `IsReplicated` is set         | Edits                                           |
| Minimap, grass tint, fog of war overlay, terrain paint                                                     | Client                                       | Edits and paints                                |
| Map skins, per-state assets, map audio, fog of war rendering                                               | Client                                       | Edits                                           |
| Visibility states: which element or pit state is active                                                    | Server selects, client draws                 | Previews every state, edits the content of each |
| Ground height, walls, brush                                                                                | Server navgrid, client geometry must match   | Shows as guides, checks the geometry            |
| Structures, camps, spawns, shops, superwards, regions, area triggers, lanes                                | Server                                       | Shows as guides, read-only                      |
| Region boundaries: `RegionBoundary`, the vertex placeable `0x5a9697c1`                                     | Client draws, the match's read is not traced | Edits                                           |
| Level scripts, game mode rules, spawning                                                                   | Server                                       | Out of scope                                    |

**A server-owned object is a guide.** The editor draws it, lists it and inspects it, and it offers
no tool that moves or deletes it. If the client copy differs from the server copy, the player sees
a turret or a wall at a position that the match does not use. A cosmetic entity template with
`IsReplicated` set is a guide, because the server sends its state.

**The map id is fixed.** The server selects the map and its skin. A project authors a custom map skin
for an existing map id, either by editing a shipped container or by pointing the map's skins at a
new container (see "Starting a map"). A project cannot add a new playable map.

**The add menus offer every class that the client reads.** This includes `MapLightingV2`,
`MapSSAO` and `MapAntiAliasing`, which the meta wiki lists as read by their own subsystems. The
traced client code of 16.16 and 16.18 never reads them, so adding one has no visible effect, and
their sections carry that as a hint. Classes with no reader
are not offered: the `EnvironmentEffector` classes, `TerrainDisturbanceConfig`,
`MapLaneComponent`, the grass sway updaters and `MapgeoExtension`. The inspector still shows any
class that a file already contains.

### Parity

Riot has not published how its map editor works. The tool that is confirmed by name is RiotEditor
on the Game Data Server, used with Maya and Photoshop. Parity in this spec means parity with the
data that the tooling writes: the classes of the "Map and environment" domain on the meta wiki,
the `.mapgeo` format and the bake outputs.

| Riot capability                                                               | Evidence                                                             | Map editor feature                          | Status                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Geometry from Maya                                                            | Confirmed                                                            | glTF, FBX, OBJ and NVR import, glTF export  | Blocked                |
| Property editing in RiotEditor                                                | Confirmed                                                            | Inspector and map settings                  | Available, read-only   |
| Feature layers and versions                                                   | Confirmed                                                            | Project layers                              | Available              |
| Asset hot reload                                                              | Confirmed                                                            | Apply between games (overlay live mutation) | Available              |
| Mesh combine and half-float streams on build                                  | Inferred from `MeshCombineRadius`, `ConvertStreamsToHalfFloat`       | Save options                                | Proposed               |
| Light grid, lightmap and stationary light bakes                               | Inferred from `MapBakeProperties` and mapgeo channels                | Bake menu                                   | Blocked                |
| Static lights as bake inputs                                                  | Inferred from `MapPointLight`, `MapSpotlight`, `MapUniquePointLight` | Static lights                               | Blocked with the baker |
| Placeables: lights, probes, particles, audio, props, locators, paths, volumes | Inferred from the schema                                             | Place tool and palette                      | Planned                |
| Gameplay entities: camps, spawns, shops, triggers, regions                    | Inferred from the schema                                             | Guides                                      | Blocked                |
| Visibility layers and controllers for variants                                | Inferred from the schema and mapgeo                                  | Visibility authoring                        | In progress            |
| Nav region and terrain tags with display colors                               | Inferred from `NavGridConfig`                                        | Navigation guides                           | Blocked                |
| Terrain textures                                                              | Inferred                                                             | Map texture painting                        | Planned                |
| Ambient map actions and behaviors                                             | Inferred from `MapAction*`, `MapBehavior`                            | Inspector only                              | Planned                |
| Sub-maps in one container                                                     | Inferred from `MapContainsOtherMaps`                                 | One map document per sub-container          | Planned                |

## Vocabulary

| Term             | Meaning                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Map              | A `Map` object in `data/maps/shipping/map<N>/map<N>.bin`, and the files that it links                                             |
| Container        | A `MapContainer` and the files that share its path: `<path>.materials.bin` and `<path>.mapgeo`                                    |
| Map document     | The shell tab of one container. It edits the container's two files and the `Map` and `MapSkin` objects that link it               |
| Map settings     | The inspector's view when nothing is selected: the container, skin, audio, fog of war, minimap, visibility flags and dependencies |
| Mesh             | One `.mapgeo` mesh, with its transform, visibility layers, controller, flags and submeshes                                        |
| Submesh          | An index range of a mesh that names one material                                                                                  |
| Chunk            | A `MapPlaceableContainer` that the container's `chunks` lists                                                                     |
| Placeable        | One item of a chunk                                                                                                               |
| Visibility layer | One of the eight `LAYER_0..7` bits of a mesh. The word "layer" alone always means a project layer                                 |
| Controller       | A visibility controller object in the `.materials.bin`, rules in ADR-0064                                                         |
| Map state        | The variant, the visibility layer mask and the controller states that the viewport shows                                          |
| Guide            | A server-owned object that the editor draws and does not edit                                                                     |
| Dynamic light    | A light that the game draws at runtime: `MapDynamicPointLight` or `MapDynamicSpotlight`                                           |
| Static light     | A light that only the lightmap baker reads: `MapPointLight`, `MapSpotlight` or `MapUniquePointLight`                              |
| Bake             | A job that computes a file from the map: a minimap, a probe, a light grid or a lightmap                                           |
| Look             | The `MapSkin` fields that ADR-0052 copies between skins: sky, colorization, gamma, grass tint and the rest                        |

"Environment" is not used for the look, because GLOSSARY.md reserves it as a word to avoid for
the sandbox.

## Ways in

The routes are the ones that open the map shell today: a `.mapgeo`, a `.materials.bin`, or a
`Map`, `MapSkin` or `MapContainer` object. Every route opens the same map document. The file
route gains the inspector, so a `.mapgeo` opened from the file tree shows the same four panes as a
`MapContainer` opened from a bin.

**The sandbox decides whether the tools are enabled.** In the Game sandbox the shell is a viewer,
as it is today. The toolbar shows Edit in project, which copies the container into the active
layer of a chosen project and opens it there. In the Project sandbox the tools are enabled when
the document is editable, which is a layer file or a declared document (ADR-0042, ADR-0056).

**A shipped container is edited through declarations.** A `.materials.bin` that no layer ships
opens as a declared document. A placeable, material, component or controller edit becomes a
declaration in the active layer's `game_data.yaml`, through the module that the user chose
(ADR-0048, ADR-0049). A new component is a list append such as
`+components: !pointer(MapDynamicLighting) {}`, and a new placeable is a map key append on the chunk's `items`, as the game data reference
defines them (<https://wiki.leaguetoolkit.dev/reference/mod-packages/game-data/>). A `.mapgeo`
cannot be declared, because it is not a bin. The first geometry edit copies the `.mapgeo` into the
active layer, and the toolbar shows that the layer ships the file.

## Starting a map

The Workshop's New project menu gets a Map entry. It asks for the game map and for one of three
starting points.

| Starting point                | What the project contains                                                                                                | Use                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Edit the shipped map          | Nothing until the first edit                                                                                             | Small changes to a shipped map   |
| Custom map skin               | A copy of one skin's container under `maps/mapgeometry/map<N>/<slug>`, and declarations that point the map's skins at it | A map skin                       |
| Custom map skin from geometry | A copy of one skin's container with only its controller and region meshes, and the same declarations                     | A port such as the Season 1 Rift |

The declarations that point the skins at the new container are `mMapContainerLink` edits on every
`MapSkin` of the map, the same edits that the map-skins built-in mod writes (ADR-0052). The user
can limit them to chosen skins in the map settings. The server still selects the skin, so the new
container replaces the skins that it is linked from.

**The link and the path are written from one string.** The client finds a container by a
case-sensitive byte comparison of `MapContainer.mapPath` with the skin's `mMapContainerLink`. The
starting point writes both from the same value, and a rename in the map settings changes both.

**A copied container keeps its LOD files.** `MapQualityLodComponent` loads `<container>.LOD<n>`
geometry at matching quality levels. Copying a container copies its LOD `.mapgeo` files. The editor
does not author LODs.

**Custom map skin from geometry keeps the shipped state meshes.** The Season 1 port showed that replacing
the whole `.mapgeo` removes every controller-swapped feature, such as the Baron pit and the
elemental terrains. The starting point copies the skin's container with its placeables and
settings, and keeps only the meshes that have a controller or a region, 408 and 13 on Summoner's
Rift. The user adds the new geometry with Add mesh. The user can delete the state meshes, and the
Problems pane then reports each state that has no mesh.

## The shell

The map shell keeps its four panes and adds three. The default arrangement is:

```
+--------------------------------------------+-----------------------+
| Top bar: tool options | file | state | view | Outliner | Visibility |
| Tool  |                                    |                       |
| rail  |          Viewport                  +-----------------------+
|       |                                    | Inspector | Lighting  |
|       |                                    |                       |
+--------------------------------------------+                       |
| Palette | Minimap                          |                       |
+--------------------------------------------+-----------------------+
```

| Pane       | Contents                                                                           | Status                           |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| Viewport   | The map in the shown map state, the tools, the gizmo and the guides                | Available, tools Planned         |
| Outliner   | Meshes, chunks and placeables, and guides                                          | Available for chunks             |
| Visibility | Visibility layers and controllers                                                  | Available, authoring In progress |
| Inspector  | The selection, or the map settings when nothing is selected                        | Available, settings In progress  |
| Lighting   | Sun, sky, fog, color, shadows, clouds, dynamic lighting, volumes and light regions | In progress                      |
| Palette    | The classes and assets that the Place tool adds                                    | Planned                          |
| Minimap    | The minimap image with the world mapped onto it                                    | Planned                          |

The pane ids `lighting`, `palette` and `minimap` are added to `SHELL_PANES.map`. A saved
arrangement that does not contain them gets them back when it is read, as the skin shell does for
its later panes: Lighting as a tab behind the Inspector, Palette and Minimap as tabs of a new leaf
under the Viewport.

Problems are not a pane of the shell. The map rules report into the project's Problems pane
(docs/ux/PROJECT_PROBLEMS.md), and a problem row selects its mesh, submesh or placeable in the
shell.

## The map state

The toolbar shows the map state that the viewport draws: the variant menu, which exists today,
and a state menu. The state menu lists the flag sets of `Map.VisibilityFlagDefines` and the Baron
pit controllers, and selects one value of each, for example Ocean and the upgraded pit. It is a
shortcut over the Visibility pane, which still sets single visibility layers and controllers. The
unnamed `Map` field `0xd31ac6ce` also lists pit states, but the client does not read it, so the
menu uses the controllers.

**A state change fades as it does in game.** A logic driver controller fades over its driver's
time, a legacy flag controller over the flag's `TransitionTime`, and a child controller with its
first changing parent. Every other controller switches at once.

**An edit to per-state data targets the shown state.** `MapSkin.mAlternateAssets` holds a grass
tint, a fog of war overlay, a particle resolver and audio banks per visibility flag. When the
shown state has an alternate asset entry, the Lighting pane, the Paint tool and the map settings
edit that entry and label it with the state name. When it has none, they edit the skin's default
and the label reads Default. Add state override creates the entry for the shown state.

**A mesh outside the shown state is hidden, and not locked.** The outliner lists it with its eye
closed. Selecting it in the outliner shows it in the viewport with the selection color until the
selection changes.

## Selection

One selection spans the viewport, the outliner and the inspector, as it does today for
placeables. It now contains meshes, submeshes, placeables and guides.

- A click in the viewport selects the mesh or placeable under the pointer. Placeables are tested
  first, as screen-space dots. A mesh is found by a ray against the drawn map: the triangle it
  hits names an index run, and the submesh that draws the run names the mesh. The GPU id picking
  of `vfx/rendering/utils/pickRender.ts` needs the backdrop's materials to draw a pick pass, and
  replaces the ray if a click on Summoner's Rift takes too long.
- Alt and a click selects the submesh under the pointer.
- Shift adds and Ctrl toggles, as in the outliner.
- Box select selects the placeables inside the box, and the meshes whose screen-space bounds are
  inside it.
- Three chips in the toolbar limit picking to Meshes, Placeables and Guides. All three start on.
- A selected mesh is drawn in the selection color: a faint fill where it shows and its wireframe
  through whatever stands in front of it. The highlight follows the gizmo during a drag.
- A guide can be selected and inspected. The gizmo does not attach to it, and Delete skips it.
- `Ctrl+A` selects everything that the outliner lists under its current filter.

The inspector shows the lead of the selection. If the selection contains several items of one
kind, the inspector shows the fields that they share, and an edit applies to each of them as one
undo step. With nothing selected, the inspector shows the map settings.

## Tools

The viewport has two rails docked to its edges, as in Maya and Blender. The tool rail down the left
edge holds the tools, the box select, the local axes switch and the snap switch as icons. The rail
across the top edge holds labeled controls: the options of the current tool, such as the class that
Place adds, Add mesh and Save, and the variant menu on the left, and the Show menu, the view mode,
the camera and Frame on the right. The Show menu switches particles, structures, the sky, shaders,
event effects, region boundaries and placeable markers. The orientation gizmo sits in the bottom right corner. Each
tool has a single-key shortcut that works while the viewport or the outliner has focus.

| Tool   | Key | Action                                                |
| ------ | --- | ----------------------------------------------------- |
| Select | `Q` | Picks and box selects                                 |
| Move   | `W` | Gizmo translate                                       |
| Rotate | `E` | Gizmo rotate                                          |
| Scale  | `R` | Gizmo scale                                           |
| Place  | `P` | Adds the palette's current class at the clicked point |

The Paint tool of "Painting" is Planned. The rail has no Paint tool, and `B` has no binding.

**The gizmo commits on release.** A drag updates the scene on every frame and sends no edit.
Releasing the pointer sends one edit, and Esc during the drag restores the start transform. This
is the pattern of `bin/vfx/preview/components/EmitterTransform.tsx`. A gizmo on several items
moves them around the lead and sends one edit for all of them.

**Snapping.** The toolbar has a snap menu with three switches:

- Grid: positions snap to a grid step, default 10 units, and rotations to 15 degrees
- Ground: a moved or placed item drops onto the drawn triangles under it
- Guides: a position snaps to the nearest navgrid cell center, when a navgrid is read

Holding Ctrl during a drag inverts the grid switch. The ground test uses the drawn geometry and
not the scene graphs, because the scene graph is a simplified proxy and its heights differ from
the drawn ground.

**Transform space.** The gizmo works in world space by default. `X` toggles local space. The
inspector shows the position, rotation in degrees and scale of the lead, and a typed value applies
on Enter.

**Frame and focus.** `F` frames the middle of every selected mesh and placeable, in the viewport,
the outliner, the selection bar and the menu bar. A click on an outliner row frames that row's
object, as Enter does.

### Menu bar

The tab's header row draws the bar above the panes, so it works in every frame and in Properties.
A `.mapgeo` or `.materials.bin` tab draws the same bar in its toolbar, with its own Save, Undo and
Redo. Each item runs the action of the rail, the top bar or the row menu that it mirrors. The
handler and the menus read the keys from the `map.*` commands of the key registry, per "The
registry" in docs/ux/KEYS.md.

| Menu   | Items                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File   | Save. Add mesh, Export map, Save `.mapgeo`, Export selected, Reimport. The object's File items                                                                                             |
| Edit   | Undo, Redo. Delete, Duplicate, Rename, Drop to the floor. Select all, Clear the selection, Box select. The object's Edit items                                                             |
| Insert | The classes of the Place menu by group, Place a lighting volume, New controller                                                                                                            |
| Tools  | Select, Move, Rotate, Scale and Place as a choice. Local axes and Snap to grid as switches                                                                                                 |
| View   | Layout and Properties. Show, Camera, View mode. Frame map, Frame the selection. Hide or Show the selection, Show everything, Reset visibility. Sun, Post effects. Panes, Keys and gestures |
| Map    | Map skin, Target chunk. Select all in the chunk or controller, Move to chunk, Mesh controller, Visibility controllers                                                                      |

A command that does not apply stays listed and disabled, and shows its reason. A menu of choices
and switches on a map that takes no edits starts with a disabled line that gives the reason. Map
skin is left out of a map with one skin.

The Hide item names what `H` does: it hides the selection if any of it is shown, and it shows the
selection if all of it is hidden. `H` acts the same way in the viewport and the outliner.

Sun and Post effects apply on a read-only map and in the layout, because they open the popovers of
the top bar. An editable map edits both in the Lighting pane.

Select all selects every mesh and placeable that the outliner's filter keeps, in folded rows too.
`Ctrl+A` in the viewport does the same. `Ctrl+A` in the outliner selects the rows on screen. `End`
drops the selection from the viewport, and in the outliner it steps to the last row.

## Meshes

The outliner gets a Meshes section above the chunks. It lists the meshes of the `.mapgeo`, grouped
by controller, and ungrouped meshes under No controller. A mesh row shows the material of its
first submesh and the mesh's index. The `.mapgeo` versions that the client ships store no mesh
names, and the editor stores none either.

**The outliner works as the Maya and Blender outliners do.** It has two collections, Meshes and
Placeables, and each row of an object has an eye that hides it in the viewport. A right click
opens the row's actions, which act on the whole selection when the row is part of it:

| Row        | Actions                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| Mesh       | Duplicate, Delete, Frame, Hide, Controller                                             |
| Placeable  | Rename, Duplicate, Delete, Frame, Hide, Move to chunk, Place new objects in this chunk |
| Controller | Select all inside, Hide or show all inside                                             |
| Chunk      | Place new objects here, Select all inside, Hide                                        |

Dragging meshes onto a controller group assigns that controller, and dragging placeables onto a
chunk moves them there under their own keys. With the outliner focused, H hides the selection,
F frames the lead, and Delete, `Ctrl+D`, F2 and the undo keys act as they do in the viewport.

**One row of controls heads the outliner.** The search box matches names, classes, materials and
controllers. A filter menu beside it shows or hides the meshes and each kind of placeable that
the map holds, with a count per kind. A mesh row reads `Mesh <index>` with the last segment of
its first material, and the material gives way first when the pane is narrow.

**The chunks live only in the outliner.** The `MapContainer` inspector does not list
`chunks`, because the outliner is where a chunk is opened, targeted and filled.

The inspector of a mesh shows:

- Transform
- Visibility layers: eight checkboxes, titled by the flag names of the map
- Layer transition: Unaffected, Turn invisible or Turn visible
- Controller: a picker over the container's controllers, and None
- Region: a picker over the region entities of the chunks, and None
- Quality: five checkboxes, Very low to Very high
- Render flags: Decal, Distortion, Eye candy on only, Eye candy off only, Casts shadow, Shadow
  material
- Backface culling
- Lightmap: the baked and stationary light textures, with their scale and bias
- Submeshes: one row per submesh with its material, a picker and an Open material button

**Mesh edits go through one command.** `map_geometry_edit(id, MapGeometryEdit)` changes the
`.mapgeo` that the backend holds open, as `bin_edit` does for a bin (ADR-0051), and keeps the step
that reverts it. It returns the mesh deltas of the change: an updated mesh with the transform it
was drawn with, a removed mesh, or an inserted mesh. An undo and a redo return theirs the same way.
The viewport applies the deltas to the map buffer it holds and reads only the meshes an insert
adds, as `?as=map&geometry=<id>&meshes=<list>`, so it never fetches the whole `LTKM` buffer again,
which is 73 MiB for Summoner's Rift. A delta also moves the mesh ids that the selection and the
hidden set hold.

**An undo step stores mesh properties, never buffer ids.** A removal and an insert renumber the
vertex and index buffers, so a step restores the transform, region, controller, layers, quality,
culling and materials through the setters onto the current record.

**A move edits the mesh matrix.** Moving a mesh changes its matrix and recomputes its bounding box,
and leaves its vertices unchanged, so meshes that share a vertex buffer keep sharing it. 504 of 586
Summoner's Rift meshes have an identity matrix, so a moved shipped mesh gets its first
non-identity matrix. A region-anchored mesh moves relative to its region entity.

**A moved mesh stays in its scene graph.** The scene graph is the client's simplified copy of the
triangles for ground and picking queries. The shipped baker reads vertex positions without the
mesh matrix and leaves out meshes whose matrix is not identity. The editor's bake applies the
matrix, and a mesh that was in a scene graph before a move is in it after the move.

**Duplicate and delete.** `Ctrl+D` duplicates the selected meshes in place and selects the copies.
Delete removes them and drops the vertex buffers that no other mesh uses. Both are one undo step.

**Copy meshes from another map.** The Palette pane lists the install's maps under Meshes. Opening
one lists its meshes with a thumbnail, and a drag into the viewport copies a mesh with its
materials and textures into the project. The materials are copied into the container's
`.materials.bin` under their own names, and a name that already exists is reused.

### Saving geometry

**A `.mapgeo` saves on request.** Ctrl+S from any pane and the bar's Save write the tab's bin, the
queued `.materials.bin` and the `.mapgeo` once each. Save `.mapgeo` writes the `.mapgeo` alone. The
editor also saves it before Test runs and when the tab closes. A quit asks about it and does not
write it first. The toolbar shows a marker while the file has unsaved edits. A Summoner's Rift
`.mapgeo` is about 92 MB and every save bakes its scene graphs, so it does not use the automatic
save of a bin.

**A `.mapgeo` saves as version 18.** The writer of `ltk_mapgeo` writes only v18. When the opened
file is an older version, the toolbar shows the version and the first save converts it. Mesh
names, spherical harmonics and point lights exist only in versions that the client no longer
ships, so no shipped file loses them. The writer writes a baked paint texture as the sampler 0
override of v18. The only two shipped baked paint meshes are v17 sampler 0 overrides already, so a
save loses no shipped data. Half-float vertex streams decode through `ltk_mesh` 0.5.5.

**A region mesh does not move by its matrix.** Every mesh of one region carries the region's
placement as its matrix, and its bounding box and scene graph stay in local space. The Move tool
moves such a mesh only with its region entity.

**A save bakes the scene graphs.** The save rebuilds one scene graph per controller and region
pair. The user does not start this bake.

**A save writes through a temporary file** and fails if the file on disk changed since it was
opened, as a bin save does (ADR-0040).

The crate gaps are listed under "How it is built". They block every mesh edit except the
controller and visibility layer edits, which `meshes_mut()` supports today.

### Adding meshes

A new mesh comes from a model file. The importer reads:

| Format   | Extensions      | Notes                                                                |
| -------- | --------------- | -------------------------------------------------------------------- |
| glTF 2.0 | `.gltf`, `.glb` | Embedded and external buffers and textures, through the `gltf` crate |
| FBX      | `.fbx`          | Binary and ASCII, version 7, through the `ufbx` crate                |
| OBJ      | `.obj`          | With its `.mtl` when one is beside it, through the `ufbx` crate      |
| NVR      | `.nvr`          | Versions 8.1 and 9.1, through `ltk_mapgeo::nvr`                      |

There are three ways to start an import:

- Add mesh in the toolbar opens a file picker and then the import dialog
- Dropping a model file from the system onto the viewport opens the import dialog, with the
  placement set to the ground under the pointer
- Import in the Palette pane's Meshes group opens the file picker

**The import dialog** shows a preview of the file's meshes in the shown map, at the chosen
placement, and these fields:

- Meshes: the file's meshes, each with a checkbox. All start checked.
- Scale: read from the file's unit setting when it has one (the FBX `UnitScaleFactor`), else 1.
  The preview draws a champion-sized marker beside the meshes, so a wrong scale is visible.
- Up axis: read from the file when it has one (FBX `GlobalSettings`, Y for glTF), else Y
- Materials: per source material, Create, which makes a `StaticMaterialDef` from a template, or
  Use, which picks an existing material of the container
- Template: the shader that a created material links, `DefaultEnv_Flat` by default and
  `DefaultEnv_Flat_AlphaTest` for a material with alpha
- Textures: each texture that a created material uses, with its source file. A texture that the
  importer cannot find is listed as missing, and the user can pick the file.
- Visibility layers and controller for every new mesh, default all layers and no controller
- Placement: at the file's origin, at the viewport's center on the ground, or at the drop point

Import adds the checked meshes to the `.mapgeo`, adds the created materials to the
`.materials.bin`, and converts the textures to `.tex` files in the active layer, under
`assets/<map path>/` in lowercase, such as `assets/maps/mapgeometry/map11/base_srx/`. The new
meshes are selected, so the gizmo can place them right away. The import is one undo step. An
undo leaves the written `.tex` files in the layer. A new mesh joins the scene graph of its
controller and region with every face.

**What the importer converts:**

- The file's node transforms are applied to the vertices. The placement becomes the mesh
  transform, so a later move edits only the matrix.
- The axes are converted to the map's axes, the same flip that `AXIS_SIGN` applies in the
  viewport.
- Polygons with more than three corners are triangulated.
- A mesh without normals gets computed normals.
- Vertex streams map as follows: position, normal and the first UV set directly, the second UV
  set to `Texcoord7` (the lightmap UV), and vertex color to `PrimaryColor`.
- A mesh with more than 65535 vertices or more than 64 materials is split into several meshes,
  because the indices are u16 and the client stages at most 64 submeshes per mesh.
- Skeletons, skin weights, blend shapes, cameras, lights and animation are skipped. A skinned mesh
  is imported in its bind pose, and the dialog lists what was skipped.

**Export** writes the selected meshes, or the whole map, to glTF with their materials and
textures. The export embeds each mesh's index, container path and vertex count in its glTF extras.
Each mesh is a node with the mesh's transform.

**Reimport** replaces the selected mesh with a mesh from a model file and keeps its visibility
layers, controller, region, flags and lightmap fields. If the file contains several meshes, the
importer matches them by the glTF extras, then by mesh name. If neither matches, the dialog asks
the user to pick the source mesh. An index in the extras goes stale when a mesh with a lower index
is deleted, so a match whose vertex count differs from the mesh's also falls back to the dialog.
The new mesh draws the old mesh's materials in source material order. Its transform is the identity,
because the importer applies the file's node transforms to the vertices.

## Materials

A submesh row's picker lists the container's `StaticMaterialDef` entries. New material creates one
from the template of the import dialog and opens it in the material shell (ADR-0047). Open
material opens the existing one there.

**Only shipped shader permutations are offered.** A map material links one of the 87
`CustomShaderDef` in `data/shaders/shaders.bin`, and the client runs only the permutations that
`ShaderCache.dx11.wad.client` ships. The material shell lists only the defines that form a shipped
permutation with the defines already set. A material that already uses a missing permutation is
reported in Problems, because the client draws nothing for it.

**A new material follows the client's lookup rules.** A submesh finds its material by the FNV-1a
hash of the lowercased name, so the editor sets `name` to the entry path. It sets `type` to 0, the
static mesh family. It writes a `value` for every parameter and a `texturePath` for every sampler,
because the client reads a missing parameter value as zero and a missing sampler texture as the
engine fallback.

## Placeables

The outliner lists the chunks and their placeables, as it does today. Every placeable kind is
drawn in the viewport with an icon at one screen size:

| Kind                | Class                                                         | Drawn as                                                          |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Particle            | `MapParticle`, `VfxEntityTemplate`                            | The system, and an icon when Particles is off                     |
| Audio               | `MapAudio`                                                    | A speaker icon                                                    |
| Locator             | `MapLocator`, `MapScriptLocator`                              | Axes                                                              |
| Group               | `MapGroup`                                                    | Axes and its name. The data defines no members                    |
| Dynamic point light | `MapDynamicPointLight`                                        | A bulb icon and its radius as a wire sphere                       |
| Dynamic spotlight   | `MapDynamicSpotlight`                                         | Its frustum along -Z, with the projected texture on the far plane |
| Static light        | `MapPointLight`, `MapSpotlight`, `MapUniquePointLight`        | A bulb icon in the static light color                             |
| Cubemap probe       | `MapCubemapProbe`                                             | Its region as a wire box, and a sphere that shows the probe       |
| Lighting volume     | `MapLightingVolume`                                           | The unit cube under its transform. The extent is not traced       |
| Light region        | `LightRegionEntityTemplate`                                   | Its polygon on the ground                                         |
| Prop                | `MapAnimatedProp`, `CharacterMeshEntityTemplate`, level props | The character in its idle clip, as today                          |
| Environment mesh    | `EnvironmentEntityTemplate`                                   | The mesh                                                          |
| Banner              | `GdsMapObject`                                                | Its box, and the banner when its skin resolves                    |
| Motion path         | `MapMotionPath`                                               | The curve with its control points                                 |
| Region boundary     | `RegionBoundary`, `0x5a9697c1`                                | Its polygon and its walls, in its own colors. See below           |

**The inspector edits the placeable.** `PlaceableInspector` passes `editable` to its `BinTree`, so
the placeable's fields are edited in place through `useLeafEdit`. The gizmo writes the
placeable's `transform`, which is the matrix that positions the object in the client, and leaves
every other field unchanged. `MapPlaceable` declares a second matrix `0x617a316c`, which no
shipped bin sets and no client code that was traced reads. The outline carries the full
`transform` of each placeable and the extent that the viewport draws (`MapItemShape`).

**Region boundaries.** A `RegionBoundary` is a closed polygon of `Vertices`, local to its
transform, that the client draws as walls `DrawHeight` tall in its `LineColor` and `FillColor`.
The viewport draws every region the outliner lists the same way: the polygon and the top in the
line color, the walls in the fill color at a low opacity, and a selected region in the selection
color. The unnamed placeable `0x5a9697c1` holds `Vertices` too and draws as its flat polygon. Region
boundaries in the Show menu switches the drawing, and starts on. Off, the selected regions still
draw.

The lead region's vertices edit in the viewport under the Select and Move tools:

- a knob stands on each vertex. Dragging it slides the vertex along the ground at its own
  height, the scene follows every frame, and the release writes `Vertices[i]` as one undo step.
  Esc during the drag puts the vertex back. The grid snap applies, in the region's own units,
  and Ctrl inverts it
- a smaller knob stands on the middle of each edge. A click on it inserts a vertex there
- Alt and a click on a vertex removes it. A polygon keeps three vertices at least
- the inspector's `Vertices` rows, `DrawHeight` and the colors edit as any field does, and the
  viewport redraws when the edit is read back

**Place.** The Palette pane lists the placeable classes that the client reads, grouped as Effects,
Audio, Lighting, Markers and Props. Selecting a class and clicking in the viewport with the Place
tool adds a placeable at the ground under the pointer. A drag from the content browser also
places: a particle system adds a `MapParticle`, and a character skin adds a level prop.

**A new placeable goes into the target chunk.** The outliner marks one chunk as the target, and a
chunk row's menu has Set as target. The default target is the chunk of the current selection. A
new placeable gets a name from its class and a number, and its key is the hash of that name. A
duplicate takes the name of its source with the next free number. The client flattens the keys of
all chunks into one table, so the editor checks that a new key is unique across the container. On
a declared document the new item goes through the target module (ADR-0049).

**A stationary light needs a channel.** `MapBakeProperties.StationaryLightChannelAssignments` maps
the hash of a light's `name` to a shadow channel: 0 red, 1 green, 2 blue. The client reads it only
for a `MapDynamicPointLight` or `MapDynamicSpotlight` whose `type` is 0, and it does not draw such
a light when the table does not list it. Every other placeable needs no entry. When a light's
`type` is set to 0, the editor adds the light to the table with a free channel. The default `type`
is 1, which the table does not affect.

**Existing keys do not change.** Shipped keys are not the hash of any form of the item's name, and
a key can be any value that is unique across the container. The editor never rekeys an existing
item. A save keeps the empty `0x0 {}` items that shipped chunks contain.

**Rename rewrites references.** `F2` renames the lead placeable. Map actions refer to props,
particles and locators by name (`PropName`, `MapParticleName`, `LocationName`, `pathname`), so the
rename rewrites every such reference in the container in the same undo step. The key stays
unchanged.

**Chunks.** The outliner's menu adds a chunk, renames a chunk and moves the selected placeables to
another chunk. A new chunk is added to the container's `chunks`. `MapChunkVisibility` assigns a
controller to a whole chunk, and a chunk row's menu sets it.

**Map behaviors and actions** (`MapBehavior`, `MapAction*`) and motion paths are edited in the
inspector. Dragging a motion path's control points in the viewport is Proposed.

### Lights

**A dynamic light is drawn by the game.** It needs `MapDynamicLighting` on the container. Placing
the first dynamic light adds the component, and the Lighting pane shows that it is on. The
component switches every environment and character shader to its light loop variant. The
inspector shows the client's rules as field constraints:

- A light with a black color is dropped
- Only the first visible point light of `type` 2 gets a shadow map
- A spotlight whose `ProjectedTexture` does not resolve is not drawn
- A light whose controller is hidden at load is never registered

A light updater (`MapLightUpdaterType`, the logic driver and rotate updaters) is set in the
inspector.

**A static light is read only by the lightmap baker.** It writes nothing that the game draws. The
Palette lists static lights in the Lighting group after the dynamic ones.

## Visibility

The Visibility pane lists the visibility layers and the controllers, as it does today
(ADR-0045, ADR-0064). It gets the authoring actions:

- Dragging meshes or placeables from the outliner onto a controller row assigns the controller
- A controller row's menu has Select meshes, Select placeables and Isolate, which hides every mesh
  and placeable with another controller
- New controller creates a controller of a chosen kind
- A child controller row edits its parents and the plus or minus relation
- A visibility layer row's menu has Select meshes

New controller offers the kinds that the client reads:

| Kind             | Class                             | Fields                                     |
| ---------------- | --------------------------------- | ------------------------------------------ |
| Named            | `0xe07edfa4`                      | `name`, `DefaultVisible`                   |
| Named, with byte | `0xc406a533`, `0xec733fe2`        | The named fields and one unnamed byte      |
| Child            | `ChildMapVisibilityController`    | `Parents`, `ParentMode`                    |
| Mutator          | `MutatorMapVisibilityController`  | `MutatorName`                              |
| Legacy flag      | `LegacyVisFlagVisController`      | `VisFlags`                                 |
| Logic driver     | `LogicDriverVisibilityController` | `VisibilityDriver`, `TransitionTimeDriver` |

The pane labels the values that the client code defines:

- `ParentMode`: 0 all parents visible, 1 any parent visible, 2 exactly one parent visible, 3 no
  parent visible
- The byte of `0xc406a533` is a terrain mask. The meshes under the controller load only if the
  match's visibility flag mask shares a bit with it. Shipped values are single bits 1 to 6.
- The byte of `0xec733fe2` is tested against a second session mask in the same way. Shipped
  values are 1, 2, 4 and 8, one per Baron pit stage. Which data sets that mask is not traced.
- Visibility layer bit `i` is the `Map.VisibilityFlagDefines` entry whose `BitIndex` is `i`, and
  the pane names each bit by that entry's `PublicName`

## Lighting

The Lighting pane edits the container's lighting components and the look of the skin that the
variant menu shows. It writes the bins. An editable map hides the preview-only `SunControl` and
`PostEffectsControl` of the viewport toolbar, and a read-only map keeps them.

| Section          | Data                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Sun              | `MapSunProperties`: direction, color, intensity, sky, horizon and ground colors, shadow fields |
| Fog              | `MapSunProperties` fog fields                                                                  |
| Sky              | The environment cubemap of the skin, `MapSkin` field `0xd0a4e40b`                              |
| Color            | `MapSkin.mColorizationPostEffect`, `MapSkin.GammaParameters`, bloom                            |
| Post effects     | `PostEffectOptions` in `0x50db156b`: depth fog, height fog, depth of field                     |
| Shadows          | `MapSkin.ShadowsEnabled`                                                                       |
| Clouds           | `MapClouds`: texture, three layers, shadow color                                               |
| Dynamic lighting | `MapDynamicLighting`: a switch that adds or removes the component                              |
| Lighting volumes | The `MapLightingVolume` placeables of the container, with their overrides                      |
| Light regions    | `MapLightRegions`: texture size, default render data, per-region render data, rim light        |
| Light grid       | `MapBakeProperties`: grid file, size, scales, the RMA static light grid texture                |
| Other            | `MapLightingV2`, `MapSSAO`, `MapAntiAliasing`                                                  |

**Add follows the first-of-type rule.** The client takes the first component of each type from
`components` and ignores the rest. A section whose component the container does not contain shows
Add in its header, and Add appends the component. A section whose component exists has no Add.

**The look has client quirks that the pane shows.** Adding `mColorizationPostEffect` switches the
post chain, and the client reads only its first four values. An empty `mGrassTintTexture` keeps the
previous tint and does not reset it, so clearing the field is not offered. The pane offers Remove
for the whole field instead.

**The sun direction has a viewport handle.** With the Sun section open, the viewport draws an
arrow from the selection or the map center. Dragging the arrow sets the direction and commits on
release.

**Light regions are polygons on the ground.** A light region is a `LightRegionEntityTemplate`
placed with the Place tool, and its polygon points are dragged in the viewport. The Light regions
section edits the render data that each region uses: sun, fog, probe index and rim light color.
No shipped map uses light regions and their effect is not tested in game.

## Map settings

With nothing selected, the inspector shows the map settings in sections. Each section edits the
objects that the client reads for that area.

| Section          | Data                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Container        | `mapPath` and the skin links that use it, `boundsMin`, `boundsMax`, the components list                              |
| Skin             | `MaterialSwap`, `mResourceResolvers`, `mObjectSkinFallbacks`, the unit skin overrides `0x2d3285eb`, `WorldParticles` |
| Audio            | `MapAudioDataProperties`, `MapThemeMusic`, the audio banks of each state                                             |
| Fog of war       | `FogOfWarProperties`, the fog of war overlay of each state                                                           |
| Minimap          | `MapSkin.mMinimapBackgroundConfig` with its custom backgrounds, `MapMinimap`                                         |
| Visibility flags | `Map.VisibilityFlagDefines`: name, bit, public name, transition time. `InitialVisibilityMask`                        |
| Dependencies     | `Map.WadDependencies`                                                                                                |

**A dependency must resolve.** The client mounts each `WadDependencies` entry and stops the game
when a mount fails. The section offers the archives of the install, and Problems reports an entry
that resolves to no archive.

`MaterialSwap` restyles meshes by material without a second `.mapgeo`. Its rows pick from the
container's materials.

## Minimap

The Minimap pane shows `MapSkin.mMinimapBackgroundConfig.mDefaultTextureName` with the world
mapped onto it by the formula in docs/research/map-minimap-mapping.md. It draws the viewport's
camera footprint, the selection and the guides on the image. A click on the image moves the
camera there.

**Render minimap** renders the shown map state from above with an orthographic camera over the
minimap rectangle, writes a 512x512 BC3 `.tex` into the project, and sets the texture path. The
render options are the map state, the guides to include and the background color. Export PNG and
Import image support painting over the render in an image editor.

## Painting

This section specifies a Planned tool, per "Feature status". The Paint tool paints a map-wide
texture in world space. The toolbar's paint menu selects the texture:

- Grass tint (`MapSkin.mGrassTintTexture`, or the state's alternate asset)
- Fog of war overlay (`MapAlternateAsset.mFowOverlayTextureName`)
- Terrain paint (`MapTerrainPaint.TerrainPaintTexturePath`)

The texture maps onto the ground from above over the container bounds, the same mapping as
`TERRAIN_XFORM`. The client gives the terrain paint channels no meaning of their own: each material
shader reads them as masks or blend weights. The Paint tool offers R, G, B and A, and labels a
channel with the materials of the shown map that read it. The brush has a size in world units, hardness, opacity and color. Alt and a click
picks the color under the pointer. A stroke is one undo step and writes the `.tex` into the
project on save. If the texture is a shipped file, the first stroke copies it into the active
layer.

Edit externally exports the texture as PNG, watches the file, and imports it again when the file
changes.

## Guides

The toolbar's Guides menu switches the guides on and off. Guides start on.

| Guide                                        | Source                                                                  | Status  |
| -------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| Structures, camps, spawns, shops, superwards | Named map objects and the gameplay entity templates of the chunks       | Planned |
| Regions and area triggers                    | `RegionEntityTemplate`, `AreaTriggerEntityTemplate`                     | Planned |
| Lanes                                        | The `__NAV_` waypoint chains and the minion paths of class `0x3c995caf` | Planned |
| Bounds                                       | `boundsMin` and `boundsMax`, and the minimap rectangle                  | Planned |
| Navgrid                                      | The `.aimesh_ngrid` cells, colored by the tag colors of `NavGridConfig` | Blocked |
| Navgrid overlays                             | The grid of the shown map state, from `MapNavGridOverlaysComponent`     | Blocked |

A guide is drawn in a muted color and carries a lock in the outliner. The guides are listed in the
outliner under Guides.

**Conformance.** With a navgrid read, the viewport's view mode menu gets Conformance. It colors the
ground by the height difference to the navgrid cell under it, and outlines the brush cells and wall
cells. The Problems pane reports:

- a ground area whose height differs from the navgrid by more than a threshold, default 20 units
- a brush cell that no brush mesh covers
- a wall cell with no geometry over it

The Season 1 port measured a median gap of 6 units and patches of about 50 between shipped ground
and shipped navgrid, so the threshold is a setting.

## Bakes

The toolbar's Bake menu starts a bake. A bake runs in the backend with progress in the toolbar,
and writes its result into the active layer. A bake whose inputs changed after it ran is reported
as stale in Problems.

| Bake           | Output                                               | Status                         |
| -------------- | ---------------------------------------------------- | ------------------------------ |
| Scene graphs   | Inside the `.mapgeo`, on every save                  | Blocked with the mapgeo writer |
| Minimap        | A `.tex`                                             | Planned                        |
| Lightmaps      | `bakedLight` and `stationaryLight` textures per mesh | Blocked                        |
| Cubemap probes | One DDS cubemap per selected `MapCubemapProbe`       | Blocked                        |
| Light grid     | `LightGrid.dat` v3                                   | Blocked                        |

**The baker runs on the GPU in the backend.** It uses wgpu, outside the webview, on the
`.mapgeo` that the backend holds. The lightmap, probe and light grid bakes share its renderer.
The minimap render uses the viewport.

**The lightmap bake writes both channels.** `bakedLight` is the first texture of a mesh and
receives the sun, sky, static lights and bounce light. `stationaryLight` is the second texture and
holds one shadow mask per color channel, one channel per stationary light, as
`StationaryLightChannelAssignments` assigns them. The client fits three stationary lights in one
mask. The shader math that reads the mask is not traced. The textures use the format
and texel density of the map's shipped lightmaps, and Summoner's Rift, which ships none, uses the
values of Howling Abyss. The bake options are the map state, the texel density, the bounce count
and the meshes to bake.

**A baked mesh needs a second UV set.** A mesh whose second UV set overlaps or is missing gets one
from xatlas at bake time. A valid authored set is kept.

**A baked mesh needs a material that reads it.** All 183 Summoner's Rift materials set
`NO_BAKED_LIGHTING`, so the client ignores their lightmaps. The bake offers to switch each affected
material to the shipped permutation without that define, and Problems reports a lightmap that a
material ignores.

**A probe matches the map's other probes.** The client merges every probe into one cubemap array,
and a probe of another size, mip count or format crashes the client with `ALE-D0D00022`. The probe
bake writes the size, mips and format of the container's existing probes. It renders the six
faces at the probe's position in the shown map state.

**The light grid lights characters only.** It is one ambient cube per cell, rendered by the baker
at the cell centers. Map meshes do not read it.

## Testing

The project's Test action builds the overlay and starts the game, as it does for any project. A
map project adds the map to the action's menu: Test saves the `.mapgeo`, opens the game, and the
user starts a Practice Tool game on that map. Edits made while the game runs apply at the next game
(overlay live mutation).

The game starts in the state that the server selects. To show a decoration state in game, the
map-decorations built-in mod renames the mutator controller's key (ADR-0053).

## Problems

The map rules report into the project's Problems pane. Each rule selects its object in the shell.

| Rule                       | Severity | Cause                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------ |
| Missing shader permutation | Error    | The client draws nothing for the material                                      |
| Too many submeshes         | Error    | More than 64 submeshes corrupt client memory                                   |
| Too many vertices          | Error    | Indices are u16                                                                |
| Missing material           | Error    | The client draws `-missing@environment-`                                       |
| Missing texture            | Error    | A sampler that resolves no texture draws nothing                               |
| Mismatched cubemap probe   | Error    | The client crashes with `ALE-D0D00022`                                         |
| Missing required location  | Error    | The client crashes when a `RequiredLocations` name matches no item             |
| Unresolved dependency      | Error    | The client stops when a `WadDependencies` archive fails to mount               |
| Duplicate item key         | Error    | The client binary-searches one key table for the whole container               |
| Unlisted stationary light  | Error    | The client does not draw a `type` 0 dynamic light that the channel table omits |
| Broken name reference      | Warning  | A map action names a placeable that does not exist                             |
| Lightmap ignored           | Warning  | The mesh's material sets `NO_BAKED_LIGHTING`                                   |
| State without meshes       | Warning  | A controller or flag has no mesh or placeable                                  |
| Stale bake                 | Warning  | An input of the bake changed                                                   |
| Ground off navgrid         | Warning  | Conformance                                                                    |
| Uncovered brush cell       | Warning  | Conformance                                                                    |

## Undo and saving

A map document edits several files: the `.mapgeo`, the `.materials.bin`, the textures, and the
`Map` and `MapSkin` bins through declarations. The shell has one undo history for all of them.
`Ctrl+Z` undoes the most recent edit in any of them, through the history loans of
`editor/state/historyLoans.ts`. An import, a duplicate or a rename that touches several files is
one undo step.

The bins and the textures save on their own, after the same 600 ms delay as a bin
(`queueForSave`). The `.mapgeo` saves on request, as "Saving geometry" describes.

## Keys

| Key                 | Action                                             |
| ------------------- | -------------------------------------------------- |
| `Q` `W` `E` `R` `P` | Select, Move, Rotate, Scale, Place                 |
| `X`                 | Toggle world and local space                       |
| `F`                 | Frame the selection                                |
| `F2`                | Rename the lead placeable                          |
| `End`               | Drop the selected placeables to the floor          |
| `H`                 | Hide the selection, or show it if all of it hidden |
| `Alt+H`             | Show everything hidden                             |
| `Ctrl+D`            | Duplicate                                          |
| `Delete`            | Delete, skipping guides                            |
| `Ctrl+A`            | Select every listed item                           |
| `Ctrl+S`            | Save the tab's files                               |
| `Ctrl+Z`, `Ctrl+Y`  | Undo, redo across the map document                 |
| `Esc`               | Cancel a drag, then clear the selection            |

## Delivery order

Each step is usable without the next one. The `ltk_mapgeo` additions that step 4 needs shipped in
`ltk_mapgeo` 0.3.5.

1. Placeables: editable inspector, gizmo, place, duplicate, delete, rename, chunk target, every kind
   drawn
2. Lighting pane, map settings, lighting volumes, light regions and visibility authoring
3. Minimap pane and render, and map texture painting
4. Mesh editing and the `.mapgeo` save, on `ltk_mapgeo` 0.3.5
5. Lightmap bake, with the wgpu baker and xatlas
6. Import, export and reimport, and the Map entry in New project
7. Cubemap probe and light grid bakes on the baker's renderer, after their writers
8. Guides and conformance, after a navgrid reader

Steps 1 to 6 need no change outside this repository.

## How it is built

| Piece                   | Where                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Map shell and panes     | `src/modules/workshop/bin/shell/utils/shellPanes.ts`, `ClassFrames.tsx` (`MapShell`)                            |
| Map scene state         | `src/modules/workshop/bin/map/state/mapScene.tsx`                                                               |
| Viewport                | `src/modules/workshop/bin/map/components/MapViewport.tsx`, `src/modules/viewport/scene/components/Backdrop.tsx` |
| Outliner, visibility    | `src/modules/workshop/bin/map/components/MapOutliner.tsx`, `MapVisibilityPane.tsx`                              |
| Placeable inspector     | `PlaceableInspector`, to pass `editable` to `BinTree`                                                           |
| Gizmo pattern           | `src/modules/workshop/bin/vfx/preview/components/EmitterTransform.tsx`                                          |
| GPU picking             | `src/modules/workshop/bin/vfx/rendering/utils/pickRender.ts`                                                    |
| Map reads               | `src-tauri/src/services/preview/map.rs`, `crates/ltk-manager-game/src/map.rs`                                   |
| Map buffer              | `crates/ltk-manager-assets/src/preview/map.rs` (`LTKM` v3, ADR-0044)                                            |
| Outline                 | `crates/ltk-manager-game/src/map/outline.rs`, to carry the full matrix                                          |
| Mapgeo edits            | `map_edit`, a new command beside `bin_edit`                                                                     |
| Mapgeo writer use today | `crates/ltk-manager-library/src/overlay/builtin_mods/baked_meshes.rs`                                           |
| Bin edits, saves, undo  | `useLeafEdit.ts`, `binSaves.ts`, `useBinTab.ts`, `historyLoans.ts`                                              |

`ltk_mapgeo` 0.3.5 (league-toolkit #285 to #288) provides `set_mesh_transform` with the bounding box
recompute and the mesh property setters, `insert_mesh`, `duplicate_mesh` and `remove_mesh`, a scene
graph bake that applies the mesh matrix, and the baked paint override on write.

Changes still outside this repository, each through a league-toolkit PR:

| Crate                | Change                    | Unblocks            |
| -------------------- | ------------------------- | ------------------- |
| New                  | `.aimesh_ngrid` reader    | Guides, conformance |
| New or `ltk_texture` | DDS cubemap writer        | Probe bake          |
| New                  | `LightGrid.dat` v3 writer | Light grid bake     |

New dependencies in this repository: the `gltf` crate, the `ufbx` crate (a C library, built as
`dxbc-spirv-sys` is), wgpu for the baker, and xatlas for lightmap UVs.

## Ideas for review

These are proposals. None is a decision.

- **Navgrid painting.** Paint walkable, wall, brush and region tags on the cells, as the pathing
  layers of the StarCraft II and Dota 2 editors do. Some client visuals read the navgrid, such as
  the navmesh mask texture and the navgrid particle spawners, so a painted grid changes them. The
  server keeps its own grid, so a painted grid also makes the client's movement prediction differ
  from the match.
- **A private server target.** A server that reads the project's navgrid and entities would make
  the guides editable and allow new map ids.
- **Scatter brush.** Paints props, plants or particles over an area with a density and a random
  rotation and scale, as the Unreal foliage mode does.
- **Mesh combine on save.** Merges meshes with the same material and state within
  `MeshCombineRadius`, and writes half-float streams when `ConvertStreamsToHalfFloat` is set.
- **LOD authoring.** Generates or imports the `<container>.LOD<n>` geometry for
  `MapQualityLodComponent`.
- **Readability view mode.** Shows the map as value only, to check that the ground stays darker
  and less saturated than characters and effects, per the 2014 art rules of the Summoner's Rift
  update.
- **Footprint for props.** A prop declares the navgrid cells that it covers, and conformance checks
  that they are walls, as StarCraft II doodad footprints do.

## Open questions

| Question                                                                                           | What it decides                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Does the server check the client's navgrid or placeable positions?                                 | Whether a guide can be edited at all             |
| How does a shader combine the stationary channel selector with the `stationaryLight` mask?         | The stationary channel bake                      |
| Do light regions and the rim light change the image of a map whose materials set no Mantis define? | Whether their sections stay in the Lighting pane |
| Which code clamps the free camera to the map?                                                      | A camera bounds guide                            |
| How long does a v18 save of Summoner's Rift take, with the scene graph bake?                       | Whether the save needs progress in the toolbar   |

### Answered

| Question                                                           | Answer                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Is the map editor a separate tool?                                 | No. It is the map shell with its tools enabled                                       |
| Does the editor target a private server?                           | No. Riot's servers only                                                              |
| Can a project add a new playable map?                              | No. The server selects the map. A project makes a custom map skin                    |
| Which maps does the first version cover?                           | Summoner's Rift, Howling Abyss and Arena. Not the TFT boards                         |
| Are server-owned objects editable?                                 | No. They are guides. Cosmetic entity templates are editable unless replicated        |
| Is "Map Mountain" a documented Riot tool?                          | No public source names it. Parity is measured against the data Riot's tooling writes |
| Does a `.mapgeo` save automatically?                               | No. It saves on Ctrl+S, before Test and when the tab closes                          |
| Is there one undo history per file?                                | No. One history covers the map document                                              |
| Does v18 store mesh names?                                         | No. Only versions up to 11 do, and the editor stores none                            |
| How does a moved mesh stay in the scene graph?                     | The bake applies the mesh matrix                                                     |
| Are lightmaps baked outside the editor?                            | No. An in-editor wgpu baker writes both channels, with xatlas UVs                    |
| How is FBX read?                                                   | Through the `ufbx` crate, which also reads OBJ                                       |
| How is a component added to a shipped container?                   | A `game_data.yaml` list append on `components`                                       |
| Where do map-wide settings live?                                   | In the inspector when nothing is selected                                            |
| Does Test force the viewport's map state?                          | No. The server's state holds. Decorations use the map-decorations built-in mod       |
| Is the gameplay texture painted?                                   | No. `MapGameplayTexture` is edited in the inspector only                             |
| Which objects does the channel table list?                         | Dynamic lights at `type` 0 only, by the hash of their name                           |
| What does `stationaryLight` hold?                                  | One shadow mask per color channel, one channel per stationary light                  |
| What do the controller bytes and `ParentMode` mean?                | See "Visibility". Both were read from the 16.18 client code                          |
| Do `MapLightingV2`, `MapSSAO`, `MapAntiAliasing` change the image? | No. No traced client code reads them                                                 |
| What do the terrain paint channels mean?                           | Nothing fixed. Each material shader reads them as its own masks                      |
| Must a new item key be the hash of its name?                       | No. Any key that is unique across the container works                                |
