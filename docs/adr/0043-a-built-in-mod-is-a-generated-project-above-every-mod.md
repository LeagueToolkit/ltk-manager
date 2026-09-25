# ADR-0043: A built-in mod is a generated project above every mod

- **Status:** Accepted (2026-09-19)
- **Date:** 2026-09-19
- **Crates:** `ltk-manager-core`, in `overlay/builtin_mods`
- **Related:** CONTEXT.md, **Built-in mod**. [ADR-0012](0012-the-overlay-merges-a-mod-over-the-games-copy.md),
  the merge a built-in mod's chunks stay outside of.
  [ADR-0024](0024-a-setting-id-is-its-key-in-settings-json.md), whose flat file the
  `builtinMods` group departs from.
  [ADR-0052](0052-a-map-skin-choice-copies-one-skins-environment-over-the-others.md), the first
  built-in mod that declares properties rather than overriding chunks.

## Context and problem statement

Some changes to the game are a switch rather than a mod. Default ward skins is the first: every
ward shows its own base skin, whatever skin its owner equipped. The user authors nothing, and the
content depends on the installed patch, since each patch can add ward skins.

Every ward kind reads skin N out of SightWard's `skin<N>.bin` in the map archives. The game
falls back to the ward's own `skin0.bin` when that chunk fails to load. A missing chunk fails,
and so does one whose bytes do not start with a bin's magic. A valid bin holding no objects
loads, and leaves the ward with no skin at all.

The overlay builder adds and replaces chunks. It removes none.

## Decision

**A built-in mod is a mod project the manager writes before each build.** It lives under
`<storage>/builtin/<slug>`, is read through `FsModContent` like a workshop project, and is
generated against the installed game and the mods below it. A file whose bytes are unchanged is
left alone, so the builder's content fingerprint holds and an unchanged overlay is reused. The project of a mod
turned off is deleted.

**A built-in mod outranks every other mod.** The order is built-in mods, workshop projects,
enabled mods. The setting is a promise about the game, so an installed mod that ships the same
chunk loses to it.

**Default ward skins breaks each skin bin with four bytes, `JUNK`.** It overrides every
`data/characters/sightward/skins/skin<N>.bin` with N from 1 to 511 that an archive in
`DATA/FINAL/Maps/Shipping` holds, in that archive. Ids are generated and matched against each
archive's chunk table, so no hash list is needed and a new patch's skins are picked up.

**Base skins gives each skin past the base a stand-in for the base skin.** The scope is modded
champions or every champion. Each `skin<N>.bin` with N from 1 to 511 that an unlocalized archive
in `DATA/FINAL/Champions` holds for a character in scope is overridden with a stand-in: the two
top-level objects of that character's `skin0.bin`, `Characters/<C>/Skins/Skin0` and its
`/Resources`, renamed to skin N, with the properties' link to the resolver renamed with it. The
stand-in depends on `skin0.bin` and on every bin `skin0.bin` depends on, where the objects the two
copies link to live. The game loads a whole skin N whose content is skin 0, a mod's where one
replaces it, and no fallback runs.

A champion does not take `JUNK` the way a ward does. At 16.18, a player's own champion on a
`JUNK` skin bin crashed the game as the loading screen came up, a null read in the game rather
than the fallback to `skin0.bin` the loader's code describes. A ward survives it because its own
`skin0.bin` loads and only the SightWard alias meets `JUNK`.

- A mod **ships** a skin bin when an enabled mod or workshop project holds it in a layer turned
  on, with bytes other than the game's. A bin a mod ships stays that mod's. A whole archive a
  mod repacks ships only the bins it changed.
- **Modded champions** takes in each character whose `skin0.bin` a mod ships. **Every
  champion** takes in each character with a skin bin in a champion archive.
- A skin bin is named by its plain path, by the WAD path tables, or as the skin bin of a
  character a champion archive is named after. The tables name a champion's companions, such as
  Tibbers in Annie's archive.
- A character whose `skin0.bin` does not hold both objects keeps its skins.
- What each mod ships is read out of it once and cached in the project directory, keyed by the
  mod's content fingerprint and layer selection.

## Consequences

- Turning a built-in mod on makes the overlay carry its own copy of each archive it touches. For
  default ward skins that is every map archive, several GB.
- The effect is on the user's screen alone. Every other player's wards show default there, and
  the server still names the equipped skin.
- `JUNK` stands in for a removal the builder cannot make. Chunk removal in `ltk_overlay` replaces
  it for wards, and that project then declares removals rather than files.
- A **merge** must pass a built-in mod's chunk through untouched. A `JUNK` chunk merged over the
  game's bin would load, and the fallback would not fire.
- Base skins on modded champions adds no archive to the overlay beyond the ones the skin mods
  already put there. On every champion it adds every champion archive, about 16 GB at 16.18.
- The first build with base skins on reads each enabled mod once more. Every champion writes
  about 14,000 stand-ins, about 100 MB, and generating and comparing them costs each build about
  4 s at 16.18.
- A stand-in still carries the original skin id, so the asset table the game builds from it can
  bring skin N's animations or particles onto the base skin.
- With no WAD path tables, a companion character keeps its skins.
- Another built-in mod is a type implementing `BuiltinMod`, which returns the chunks it
  overrides from the game and the mods below it, and a field of `BuiltinModSettings`. The
  game's skin bins and the ones a mod ships are read through `GameSkins` and `ModSkins`.
- The settings nest under one `builtinMods` object in `settings.json`, the one group in a file
  ADR-0024 keeps flat. They have a settings tab of their own, so a row's id is
  `builtins.defaultWardSkins` and its key the path `builtinMods.defaultWardSkins`. Base skins is
  `builtinMods.baseSkins`, one of `off`, `moddedChampions` and `allChampions`. The ids the rows
  carried on the patching tab stay as aliases, so a link written then still opens them.
- A built-in mod that changes the game alone is something to patch. Play and the patcher start
  with no library mod enabled while default ward skins or base skins on every champion is on.
  Base skins on modded champions only reworks other mods, so it does not count.
