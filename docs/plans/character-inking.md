# Character inking built-in mod

The fifth built-in mod draws the League Classic ink outline around champions. The decision is
ADR-0078. This file holds the design that the ADR does not, the facts read out of the game, and
the in-game tests that are still open.

## Status

| Stage | Work                                                                                   | State                                |
| ----- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| 0     | In-game tests (below)                                                                  | Open                                 |
| 1     | Settings model: `CharacterInking`, `Rgb8`, the enums, defaults, bindings, `SettingKey` | Built, unit tests pass               |
| 2     | Generator, `list_inking_maps`, mesh cache                                              | Built, applies cleanly to 16.21 bins |
| 3     | Settings rows, copy, search index, `hasBuiltinMods`                                    | Built                                |
| 4     | Live preview: `inking_outline`, game-sandbox skin read, viewport embed                 | Built, not checked on screen         |
| 5     | Wiki page `manager/settings/built-in-mods.mdx`, release note                           | Open                                 |

## Engine contract

| Piece      | Where                | Shape                                                                                                                     |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Category   | a map bin            | `CharacterOutlineCategory` (`0x5d7c19de`, since 16.10), one field `Material: Link<IMaterialDef>`                          |
| Material   | a map bin            | `StaticMaterialDef` whose pass uses `Shaders/SkinnedMesh/Jade_CharacterOutline`                                           |
| Skin list  | each skin bin        | `SkinMeshDataProperties.OutlineCategorySubmeshes` (`0x9a817954`), `List2<Embed<CharacterOutlineSubmeshes>>`               |
| List entry | inside the skin list | `CharacterOutlineSubmeshes` (`0x993f8595`): `Submeshes: String`, `category: Link`, `materialOverride: Link<IMaterialDef>` |

`Jade_CharacterOutline` takes `Outline_Color`, `Outline_Width`, `Outline_CameraDistanceMod`,
`Outline_CameraDepthOffset`, `Outline_FinalAlphaMult`, `Outline_Mask` and
`Outline_Mask_ChannelMask`. The mod fixes the depth offset at `-20` and the mask at
`assets/shared/materials/white.tex` on its red channel, as Map453 does.

## Facts read out of 16.21

- 2,188 skin bins list an outline category. Almost all of them belong to `Jade_*` characters in
  the champion archives, such as `data/characters/jade_aatrox/skins/skin0.bin`. The rest are
  Map453 monsters, Map12 `S3_*` characters and the Map11 minion skins `skin28`.
- Riot writes one entry per submesh name, and lists a submesh that `initialSubmeshToHide` hides.
  `Jade_Aatrox` skin 0 lists `Wings`, `Body`, `Sword` and `Shoulder` and hides `Wings`. A
  submesh hidden at start therefore needs no special case.
- Every list links `0xe1043940`, the one `CharacterOutlineCategory` in `map453.bin`. The Map11
  minion skins link it too, and `map11.bin` does not define it.
- `0xb9ce95d8` is `RegaliaConfig` with one field, `RankedCrestLookup: Hash`, since 16.17. The
  JADE mode lists an empty one in `ConfigsClient`, which reads as "no ranked crests". The mod
  declares none, so the ranked crests are unchanged.
- `0xd428e2c8`, also since 16.10 and in the JADE mode, links a `PortraitSet` and is not the
  outline either.

## Design changes from the handoff

- **Maps, not modes.** No mode switch exists, so a map holds the outline for every mode played
  on it. The settings are `maps` and `chosenMaps` (map names such as `map11`), and the command is
  `list_inking_maps`.
- **The Style row has no key.** It writes the three values of its preset, so it is not in the
  search index.
- **The preview is folded.** It sits under a disclosure that is closed by default, and the
  viewer and the champion read load only while it is open. It reads a preview project that the backend writes for the champion, through the skin
  viewer the library uses, so the outline is the build's.
- **Advanced rows** sit under a disclosure, so a search link to one of them opens the tab and
  not the row.
- **Lane minions and structures** have a switch each, off by default. The characters are a fixed
  list in `character_inking.rs`, because the map archives name no character without the WAD
  path tables.

## In-game tests

Build a test mod with one layer per test, or turn the built-in mod on, and play a custom game or
the Practice Tool.

| #   | Test                     | Setup                                                                                                            | Pass                                                                                |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Shader variants          | One champion per `.skn` vertex type, plus Rengar (a known crash with an outline mod), Annie, Yunara, a legendary | The game loads, `r3dlog` has no shader failure, each champion has an outline        |
| 2   | Map gate                 | Inking on Summoner's Rift only, then play Howling Abyss                                                          | Summoner's Rift draws the outline. Howling Abyss draws none and does not crash      |
| 3   | Hidden and swapped parts | Kayn, Udyr, a skin with `initialSubmeshToHide`                                                                   | No outline around a hidden part                                                     |
| 4   | Team colors              | Turn `INKING_TEAM_COLORS` on in `src/modules/settings/builtinMods.ts`, bots on both teams                        | Allies and enemies differ, and the player's champion is an ally                     |
| 5   | Visibility               | Own champion in brush, Twitch, Evelynn and Akali stealth, Shaco and Wukong clones, death and respawn             | The outline fades with the body, never shows a stealthed unit, plays the death fade |
| 6   | Cost                     | Every champion, 10 inked champions in a bot fight                                                                | Frame rate acceptable, overlay size near 16 GB                                      |
| 7   | Color space              | A saturated color, compared between the preview and the game                                                     | The two match. If not, the backend converts sRGB to linear in `outline_values`      |
| 8   | Minions and structures   | Lane minions and Structures on, a Summoner's Rift and a Howling Abyss game, destroy a turret and an inhibitor    | Minions, turrets, inhibitors and nexuses have an outline, rubble shows no outline   |

A champion skin that test 1 shows to crash goes on a deny-list in
`crates/ltk-manager-library/src/overlay/builtin_mods/character_inking.rs`, with a comment that
names the failure.

## Open items

- A crash that the outline causes lists library mods as suspects, never the built-in mod. The
  verdict's `ModFootprint` list has no entry for a built-in, and the Disable action works on
  library mods only.
- The Bold and Subtle presets and the default team colors are first guesses.
