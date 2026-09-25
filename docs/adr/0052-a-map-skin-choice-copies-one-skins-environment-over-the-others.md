# ADR-0052: A map skin choice copies one skin's environment over the others

- **Status:** Accepted (2026-09-25)
- **Date:** 2026-09-25
- **Crates:** `ltk-manager-core`, in `overlay/builtin_mods`
- **Related:** [ADR-0043](0043-a-built-in-mod-is-a-generated-project-above-every-mod.md), the built-in
  mod this one is. [ADR-0042](0042-a-game-bin-edit-inside-a-project-declares-into-a-layer.md), the
  declarations it writes. league-mod ADR-0021, the game-copy references they carry.

## Context and problem statement

The server names a map skin at game start, `Default` in an ordinary game and an event's name in an
event game. The client looks the name up in the map bin's `Map.mapSkins` list, byte for byte, and
the first `MapSkin` whose `name` matches draws the map: its geometry container, grass tint, world
particles, minimap, color grading and resource resolvers. Everything the name resolves to is client
data. The reversing is in `league_structs`, `docs/reversing/MapSkin_Loading.md`.

Users want two switches: every game on the classic map, and every game on one chosen skin.

Riot ships a disable option for eleven legacy skins. It needs a `MapSkinOptionDisable<Name>(1)`
level property, which means editing the `globals` chunk of `Global.wad.client`, and the same key in
`<install>/Config/game.cfg`. That file sits outside the overlay and the game rewrites it.

## Decision

**A map skin choice is one built-in mod, `map-skins`, that declares one skin's environment over
every other skin the map links.** Classic takes `Default` as the source. A chosen skin takes the
skin of that name, and `Default` is one of the skins it writes over, so ordinary and event games
both show it. The server still sends its name, and that name now resolves to the source's
environment.

- **Declarations, not chunks.** The mod writes a `game_data.yaml` with one `target` module per map
  bin. It changes only the properties it names, so a lower mod's other edits to the same bin
  survive. `Overrides` gains the manifest beside its files.
- **References, not literals.** Each value is `!ref "<source entry>:<property>"`, which the build
  reads from the installed game. No value is rendered, and a patch that changes the source changes
  the result.
- **Only what differs.** A property is declared where the source's value and the skin's differ.
  One the source lacks and the skin holds is cleared: a string to `""`, a pointer, link or file to
  `null`, a list to `[]`, an embed to an empty struct. A declaration removes no property.
- **The environment only.** `mMapContainerLink`, `mMapObjectsCFG`, `mMinimapBackgroundConfig`,
  `mAlternateAssets`, `mWorldParticlesINI`, `WorldParticles`, `mGrassTintTexture`,
  `mSkyboxCubemapTexture`, `mColorizationPostEffect`, `GammaParameters`, `MaterialSwap`,
  `ShadowsEnabled` and `mResourceResolvers`. The navigation mesh, the server constants,
  `mObjectSkinFallbacks` and the character skin override list stay each skin's own, since the
  server still names unit skins and pathing.
- **Every map but TFT's.** The skins are read from each unlocalized map archive's
  `data/maps/shipping/<map>/<map>.bin`. `Map22` is left out, since its skins are boards a set
  chooses. A chosen name applies on every map defining it, and a name no map defines writes
  nothing.
- **The settings** are `builtinMods.mapSkin`, one of `game`, `classic` and `forced`, and
  `builtinMods.forcedMapSkin`, the chosen skin's `name`, kept while another mode is on. `forced`
  with no name turns nothing on.
- **The picker lists what can load.** `list_forcible_map_skins` answers each linked skin other
  than `Default` whose container's `.mapgeo` and `.materials.bin` ship in its map archive.

## Consequences

- Classic and a chosen skin are something to patch, so they count in the Play gate of ADR-0043.
- The overlay carries its own copy of each map archive the mod touches, about 2.4 GB for SR and
  1.1 GB for ARAM at 16.18, the same archives default ward skins already copies.
- A build with the mod on builds or loads the object index, since references need it.
- At 16.18 the mod writes about 140 properties on SR and 30 on ARAM for classic, and every one
  applies under the shipped meta schema with none refused.
- Only the environment follows the choice. Minions, turrets, music, the announcer and the loading
  screen come from mutators and stay the event's.
- An event's resource resolvers are replaced by the source's, so an event effect keyed only there
  resolves to the game's placeholder effect.
- The source is read from the installed game. A mod that reworks the `Default` skin in its own
  `map11.bin` is not what classic copies.
- A skin can list as loadable and still fail in game. A copy of `Bloom` into `Default` crashed after
  `GAMESTATE_SPAWN` during the research, cause unknown. The picker's hint says to try a new choice
  in the Practice Tool first.
- Riot's own disable option stays unused. It would add `Global.wad.client` to the overlay and a
  write outside it, and changes the same getters this does.
