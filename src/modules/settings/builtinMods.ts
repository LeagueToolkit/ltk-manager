import { m } from "@/i18n";
import type {
  BaseSkinsScope,
  CharacterInking,
  InkingColorMode,
  InkingMaps,
  InkingScope,
  MapDecorationMode,
  MapSkinMode,
  Rgb8,
  Settings,
} from "@/lib/tauri";
import { colorHex, parseColorHex, type RgbColor } from "@/utils/color";

/** Whether a built-in mod is on that gives the patcher something to apply by itself. */
export function hasBuiltinMods(settings: Settings | undefined): boolean {
  const builtinMods = settings?.builtinMods;
  return (
    builtinMods?.defaultWardSkins === true ||
    builtinMods?.baseSkins === "allChampions" ||
    builtinMods?.mapSkin === "classic" ||
    (builtinMods?.mapSkin === "forced" && builtinMods.forcedMapSkin !== "") ||
    Object.keys(builtinMods?.mapDecorations ?? {}).length > 0 ||
    builtinMods?.characterInking?.enabled === true
  );
}

/** Character inking as a fresh install holds it: off, on the Original preset. */
export const FRESH_INKING: CharacterInking = {
  enabled: false,
  scope: "all",
  chosenChampions: [],
  maps: "all",
  chosenMaps: [],
  colorMode: "single",
  color: "#000000",
  allyColor: "#3399ff",
  enemyColor: "#ff3333",
  width: 50,
  opacity: 100,
  cameraDistance: 4500,
  deathFade: 500,
};

/**
 * Returns the character inking settings of `settings`. The backend always sends the group, and
 * the binding types it optional because `settings.json` may omit it.
 */
export function inkingOf(settings: Settings): CharacterInking {
  return settings.builtinMods.characterInking ?? FRESH_INKING;
}

/**
 * Whether the inking rows offer team colors. Off until an in-game test shows that
 * `ColorChooserMaterialDriver` drives `Outline_Color`, per stage 0 in
 * docs/plans/character-inking.md.
 */
export const INKING_TEAM_COLORS = false;

/** Each inking scope with its label, in the order the picker lists them. */
export function inkingScopeOptions(): { value: InkingScope; label: string }[] {
  return [
    { value: "all", label: m.settings_builtins_inking_scope_all_label() },
    { value: "modded", label: m.settings_builtins_inking_scope_modded_label() },
    { value: "chosen", label: m.settings_builtins_inking_scope_chosen_label() },
  ];
}

/** Each inking map scope with its label, in the order the picker lists them. */
export function inkingMapsOptions(): { value: InkingMaps; label: string }[] {
  return [
    { value: "all", label: m.settings_builtins_inking_maps_all_label() },
    { value: "summonersRift", label: m.settings_builtins_inking_maps_rift_label() },
    { value: "chosen", label: m.settings_builtins_inking_maps_chosen_label() },
  ];
}

/** Each inking color mode with its label, in the order the picker lists them. */
export function inkingColorModeOptions(): { value: InkingColorMode; label: string }[] {
  return [
    { value: "single", label: m.settings_builtins_inking_color_single_label() },
    { value: "team", label: m.settings_builtins_inking_color_team_label() },
  ];
}

/** An outline style that sets the thickness, the opacity and the zoom scaling together. */
export type InkingPreset = "original" | "bold" | "subtle";

/** The values each preset writes. Color is not part of a preset. */
export const INKING_PRESETS: Record<
  InkingPreset,
  Pick<CharacterInking, "width" | "opacity" | "cameraDistance">
> = {
  original: { width: 50, opacity: 100, cameraDistance: 4500 },
  bold: { width: 80, opacity: 100, cameraDistance: 4500 },
  subtle: { width: 30, opacity: 60, cameraDistance: 4500 },
};

/** The style picker's value: a preset, or `custom` if the values match none. */
export type InkingStyle = InkingPreset | "custom";

/** Returns the preset whose values `inking` holds, or `custom` if it holds none. */
export function inkingStyle(
  inking: Pick<CharacterInking, "width" | "opacity" | "cameraDistance">,
): InkingStyle {
  const presets = Object.entries(INKING_PRESETS) as [InkingPreset, typeof INKING_PRESETS.bold][];
  const match = presets.find(
    ([, values]) =>
      values.width === inking.width &&
      values.opacity === inking.opacity &&
      values.cameraDistance === inking.cameraDistance,
  );
  return match?.[0] ?? "custom";
}

/** Each style with its label, in the order the picker lists them. */
export function inkingStyleOptions(): { value: InkingStyle; label: string }[] {
  return [
    { value: "original", label: m.settings_builtins_inking_style_original_label() },
    { value: "bold", label: m.settings_builtins_inking_style_bold_label() },
    { value: "subtle", label: m.settings_builtins_inking_style_subtle_label() },
    { value: "custom", label: m.settings_builtins_inking_style_custom_label() },
  ];
}

/** Reads a stored `#rrggbb` color as sRGB channels, black if it is not one. */
export function rgb8ToColor(color: Rgb8): RgbColor {
  return parseColorHex(color) ?? [0, 0, 0];
}

/** Writes sRGB channels as the stored `#rrggbb` form. */
export function colorToRgb8(color: RgbColor): Rgb8 {
  return `#${colorHex(color).toLowerCase()}`;
}

/** Each of `chosen` that `available` does not hold, in `chosen`'s order. */
export function missingChoices(chosen: readonly string[], available: readonly string[]): string[] {
  const known = new Set(available.map((name) => name.toLowerCase()));
  return chosen.filter((name) => !known.has(name.toLowerCase()));
}

/** Each base skins scope with its label, in the order the picker lists them. */
export function baseSkinsOptions(): { value: BaseSkinsScope; label: string }[] {
  return [
    { value: "off", label: m.settings_builtins_base_skins_off() },
    { value: "moddedChampions", label: m.settings_builtins_base_skins_modded() },
    { value: "allChampions", label: m.settings_builtins_base_skins_all() },
  ];
}

/** Each map skin mode with its label, in the order the picker lists them. */
export function mapSkinOptions(): { value: MapSkinMode; label: string }[] {
  return [
    { value: "game", label: m.settings_builtins_map_skin_game() },
    { value: "classic", label: m.settings_builtins_map_skin_classic() },
    { value: "forced", label: m.settings_builtins_map_skin_chosen() },
  ];
}

/** What each map skin mode does, as the mode row describes it. */
export function mapSkinDescription(mode: MapSkinMode): string {
  switch (mode) {
    case "game":
      return m.settings_builtins_map_skin_game_description();
    case "classic":
      return m.settings_builtins_map_skin_classic_description();
    case "forced":
      return m.settings_builtins_map_skin_chosen_description();
  }
}

/** The map a map archive such as `Map11.wad.client` holds, by the name players know it by. */
export function mapLabel(archive: string): string {
  const map = archive.replace(/\.wad\.client$/i, "");

  switch (map.toLowerCase()) {
    case "map11":
      return m.settings_builtins_map_summoners_rift();
    case "map12":
      return m.settings_builtins_map_howling_abyss();
    default:
      return map;
  }
}

/** A decoration's mode as the picker holds it, `game` for one the settings leave out. */
export type DecorationChoice = MapDecorationMode | "game";

/** Each decoration mode with its label, in the order the picker lists them. */
export function decorationOptions(): { value: DecorationChoice; label: string }[] {
  return [
    { value: "game", label: m.settings_builtins_decoration_game() },
    { value: "hide", label: m.settings_builtins_decoration_hide() },
    { value: "show", label: m.settings_builtins_decoration_show() },
  ];
}

/** The decoration a mutator switches, by the name players know it by, or the mutator's own. */
export function decorationLabel(mutator: string): string {
  switch (mutator.toLowerCase()) {
    case "sr_hall_of_legends":
      return m.settings_builtins_decoration_hall_of_legends();
    case "msitrophy":
      return m.settings_builtins_decoration_msi_trophy();
    case "mapobjectesportsponsorbanners":
      return m.settings_builtins_decoration_esports_banners();
    default:
      return mutator;
  }
}

/** `decorations` with `mutator` set to `choice`, and without it for `game`. */
export function withDecoration(
  decorations: Partial<Record<string, MapDecorationMode>>,
  mutator: string,
  choice: DecorationChoice,
): Record<string, MapDecorationMode> {
  const next: Record<string, MapDecorationMode> = {};
  for (const [key, mode] of Object.entries(decorations)) {
    if (key !== mutator && mode) {
      next[key] = mode;
    }
  }

  if (choice !== "game") {
    next[mutator] = choice;
  }

  return next;
}
