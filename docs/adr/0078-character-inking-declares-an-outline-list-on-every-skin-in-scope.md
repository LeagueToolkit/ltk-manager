# ADR-0078: Character inking declares an outline list on every skin in scope

- **Status:** Proposed (2026-11-03), pending the in-game tests in `docs/plans/character-inking.md`
- **Date:** 2026-11-03
- **Crates:** `ltk-manager-library`, in `overlay/builtin_mods`, and `ltk-manager-base` for the
  settings
- **Related:** [ADR-0043](0043-a-built-in-mod-is-a-generated-project-above-every-mod.md), the built-in
  mod this one is. [ADR-0052](0052-a-map-skin-choice-copies-one-skins-environment-over-the-others.md),
  the first built-in mod to declare properties. `docs/plans/character-inking.md`, the design and
  the in-game tests.

## Context and problem statement

League Classic (Map453) draws an ink outline around champions. The game draws the outline around
a submesh when the skin's `SkinMeshDataProperties.OutlineCategorySubmeshes` lists a
`CharacterOutlineSubmeshes` entry for it, and the entry links a `CharacterOutlineCategory` whose
`Material` is a `StaticMaterialDef` on `Shaders/SkinnedMesh/Jade_CharacterOutline`.

At 16.21 the lists live on separate `Jade_*` characters, such as `Characters/Jade_Aatrox`, one
entry per submesh, hidden submeshes included. The category and its material live in
`map453.bin`. No base champion skin carries a list. Users want the outline on ordinary champions
in ordinary games.

## Decision

**Character inking is one built-in mod, `character-inking`, that declares an outline list on
every champion skin in scope, and creates one category and one material in every map bin in
scope.**

- **Skin lists.** For each skin bin of each champion in scope, the mod declares
  `skinMeshProperties.OutlineCategorySubmeshes` on `Characters/<c>/Skins/Skin<N>`, one entry per
  named submesh of the skin's `simpleSkin` mesh, in mesh order, each linking
  `Mods/builtin/character-inking/Category`.
- **The loaded bin decides.** The facts come from the bin the game loads: a mod's copy if a mod
  ships it, the base skin's if base skins stands in for the skin, else the game's. A mesh a mod
  ships is read out of the mod.
- **A listed skin is left alone.** A skin that already lists an outline category is skipped, so
  the mod never overwrites or appends.
- **Maps, not modes.** The category and the material are created in
  `data/maps/shipping/<map>/<map>.bin` of each unlocalized map archive in scope, TFT's aside. On a
  map without them every list links a missing category. Riot's minion skins do the same on
  Map11, and test 2 of the plan checks that no outline draws there. The outline draws in every
  mode of a map in scope.
- **No mode switch.** `0xb9ce95d8`, which Map453's JADE mode lists in `ConfigsClient`, is
  `RegaliaConfig` with one field, `RankedCrestLookup`. It appears at 16.17, after inking at 16.10,
  and the mod declares none.
- **Masked parts.** A submesh whose texture has a transparent texel, such as a tail or a cape,
  links its own outline material through `materialOverride`. The material reads that texture
  on its alpha channel as `Outline_Mask`, as the League Classic cape and prop materials do. The
  material is created in the skin bin. The texture is the submesh's material albedo, else its
  override texture, else the skin's `texture`.
- **The preview is the build.** `prepare_inking_preview` writes the declarations of one
  champion into a project in the app cache, and the shipped skin viewer reads it through a
  project sandbox. The outline then comes through the skin editor's own reads and translated
  shaders.
- **Cached reads.** The facts of each skin bin and the submesh names of each mesh are cached in
  the project directory, keyed by the game chunk checksum or the mod content hash. Each build
  keeps only the keys it used.
- **The settings** are `builtinMods.characterInking`: `enabled`, `scope` (`all`, `modded`,
  `chosen`) with `chosenChampions`, the switches `minions` and `structures`, `maps` (`all`,
  `summonersRift`, `chosen`) with `chosenMaps`,
  `colorMode` with `color`, `allyColor` and `enemyColor` as `#rrggbb`, and the integers `width`,
  `opacity`, `cameraDistance` and `deathFade`.

## Consequences

- Inking is something to patch, so it counts in the Play gate of ADR-0043.
- Every champion puts every champion archive in the overlay, about 16 GB at 16.21, the archives
  base skins on every champion already copies. At 16.21 every champion is 9,239 skin lists and an
  34 MB manifest with 11,379 masked materials. The first generation reads every skin bin, mesh
  header and texture in about 63 s, and a cached one takes under a second.
- Every declaration applies under the shipped meta schema with no diagnostic, checked against
  Ahri, Kled, Rengar and Map11 at 16.21.
- The outline follows the base skin of a stand-in, because the stand-in holds skin 0's mesh.
- `minions` outlines every skin of the Summoner's Rift and Howling Abyss lane minions, and
  `structures` every skin of the turrets, inhibitors and nexuses, from a fixed list of character
  names in the map archives. Both are off by default. At 16.21 the two together are 515 skin
  lists. A skin that lists a category already, such as minion `skin28`, keeps Riot's list.
- Companions that are characters of their own and jungle monsters get no outline.
- A crash the outline shader causes does not name the built-in mod as a suspect, because the
  verdict lists library mods and workshop projects only.
- Team colors stay hidden in the settings until an in-game test shows that
  `ColorChooserMaterialDriver` drives `Outline_Color`. The generator writes them already.
