# ADR-0053: A map decoration is forced by renaming its mutator controller's key

- **Status:** Accepted (2026-09-25)
- **Date:** 2026-09-25
- **Crates:** `ltk-manager-core`, in `overlay/builtin_mods`
- **Related:** [ADR-0043](0043-a-built-in-mod-is-a-generated-project-above-every-mod.md), the built-in
  mod this one is. [ADR-0052](0052-a-map-skin-choice-copies-one-skins-environment-over-the-others.md),
  the first built-in mod to declare properties. LeagueToolkit/league-toolkit#255, the `.mapgeo`
  writer the rest of this needs.

## Context and problem statement

Some map pieces draw only when the game applies a mutator: the Hall of Legends pedestal on
Summoner's Rift (`SR_Hall_Of_Legends`), the MSI winner effects (`MSITrophy`) and the esports
banners (`MapObjectESportSponsorBanners`). Users want to force such a piece off, or on in every game.

Each piece names a `MutatorMapVisibilityController` in its container's `.materials.bin`, through
a mapgeo mesh's `visibilityControllerPathHash`, a placeable's `VisibilityController`, or a
`MapChunkVisibility` entry. The controller's predicate is whether the game applied the key in
`MutatorName`, matched without case. It does not read the key's value. The game asks it when a
mesh loads and before each draw. The reversing is in `league_structs`,
`docs/reversing/MapVisibility_MutatorControllers.md`.

## Decision

**The map decorations mod renames each controller's `MutatorName` to a key whose answer is
fixed.** It is one declaration per controller, on every container materials bin a map's skins
draw with.

- **Hidden** renames to `LTK_MapDecorationHidden`, which no mutator expansion applies.
- **Always** renames to `HudSkin`, which the `Default` mutator group assigns in every game. Its
  value does not matter to the predicate.
- **Game** is a mutator left out of the settings, and the mod writes nothing for it.

**A hidden decoration's baked meshes move under its controller.** Some of a decoration is baked
into a container's `.mapgeo` with no controller, such as `HoL_TristanaStatue_A`. For a decoration
listed with a material name prefix (`SR_Hall_Of_Legends` with `hol_`), hiding it also rewrites
each container's `.mapgeo` with `ltk_mapgeo` 0.3: every mesh with no controller whose material
name starts with the prefix takes the decoration's controller, and the scene graphs are baked
again. The prefix is Riot's naming, not something the data declares, so the list holds only what
was checked against shipped maps.

A rewritten `.mapgeo` is cached in the project, keyed by the source chunk's checksum, so it is made
once per patch. The project's override is a hard link to the cached file. A `.mapgeo` the rewrite
cannot read is left as it ships and logged, and the declarations still apply.

The setting is `builtinMods.mapDecorations`, a map from a mutator's name to `hide` or `show`.
The mod matches a name without case, as the game does.

The settings list what to offer from the install: `list_map_decorations` reads every container
of every map but TFT's and returns each mutator a controller names, with the map archives
holding it. A new patch's decoration appears without a release. The three known mutators have
labels, and any other shows its own name.

## Consequences

- At 16.18 the mod writes into 20 Summoner's Rift containers, two properties each for two
  decorations, and every one applies under the shipped meta schema with none refused.
- At 16.18, hiding the Hall of Legends moves `HoL_TristanaStatue_A` in 17 containers. The
  first build after choosing it takes about 6 s for the rewrites, and a later build about 0.5 s.
  A rewritten `.mapgeo` is about 90 MB.
- A mod that ships its own `.mapgeo` for a container loses it to the rewrite, which starts from
  the game's copy.
- The carved mid-lane ground is the `HOL2026_Ground_C3_MidLane_A` mesh with
  `ground_c3_midlanecaps_a.tex`. It has no controller and its name is outside the prefix, since
  hiding it would likely leave a hole in the lane.
- `MSITrophy` switches only the two `SRU_MSI_Winner` particles in `base_srx`, and the setting's
  label says so.
- A piece a `MapChunkVisibility` entry covers is untested in game. The reader of that component
  was not found, so whether a false controller hides the chunk's placeables or skips loading the
  chunk is unknown. The Hall of Legends chunk holds one such placeable.
- The overlay carries its own copy of the map archive, 2.4 GB for Summoner's Rift, the same
  archive the map skin and default ward skins mods copy.
- Forcing a decoration on is something to patch, so it counts in the Play gate of ADR-0043.
- `HudSkin` is a convention of Riot's `Default` group. If a patch drops it from `Default`, a
  decoration forced on stops drawing.
