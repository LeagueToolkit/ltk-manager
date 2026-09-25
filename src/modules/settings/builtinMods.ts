import { m } from "@/i18n";
import type { BaseSkinsScope, MapDecorationMode, MapSkinMode, Settings } from "@/lib/tauri";

/** Whether a built-in mod is on that gives the patcher something to apply by itself. */
export function hasBuiltinMods(settings: Settings | undefined): boolean {
  const builtinMods = settings?.builtinMods;
  return (
    builtinMods?.defaultWardSkins === true ||
    builtinMods?.baseSkins === "allChampions" ||
    builtinMods?.mapSkin === "classic" ||
    (builtinMods?.mapSkin === "forced" && builtinMods.forcedMapSkin !== "") ||
    Object.keys(builtinMods?.mapDecorations ?? {}).length > 0
  );
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
