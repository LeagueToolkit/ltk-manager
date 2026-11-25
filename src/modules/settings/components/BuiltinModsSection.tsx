import { PuzzlePieceIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { MultiSelect, SectionCard, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { ForcibleMapSkin } from "@/lib/tauri";
import { championQueries } from "@/modules/champions";

import { useForcibleMapSkins } from "../api";
import { useLoadedSettings, useUpdateSettings } from "../api";
import {
  baseSkinsOptions,
  mapSkinDescription,
  mapSkinOptions,
  missingChoices,
} from "../builtinMods";
import { CharacterInkingRows } from "./CharacterInkingRows";
import { ForcedMapSkinPicker } from "./ForcedMapSkinPicker";
import { MapDecorationsControl } from "./MapDecorationsControl";
import { SettingRow } from "./SettingRow";
import { SettingRows } from "./SettingRows";

/** The switches for the mods the manager generates, one row each. */
export function BuiltinModsSection() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  return (
    <SectionCard
      title={m.settings_tab_builtins_title()}
      icon={<PuzzlePieceIcon className="size-5" />}
      description={m.settings_builtins_description()}
    >
      <SettingRows>
        <SettingRow
          setting="builtinMods.defaultWardSkins"
          description={m.settings_builtins_ward_skins_description()}
          hint={m.settings_builtins_ward_skins_hint()}
          control={
            <Switch
              checked={settings.builtinMods.defaultWardSkins}
              onCheckedChange={(checked) =>
                update({ builtinMods: { ...settings.builtinMods, defaultWardSkins: checked } })
              }
            />
          }
        />

        <SettingRow
          setting="builtinMods.baseSkins"
          description={m.settings_builtins_base_skins_description()}
          hint={m.settings_builtins_base_skins_hint()}
          control={
            <SegmentedControl
              aria-label={m.settings_builtins_base_skins_title()}
              options={baseSkinsOptions()}
              value={settings.builtinMods.baseSkins ?? "off"}
              onChange={(baseSkins) =>
                update({ builtinMods: { ...settings.builtinMods, baseSkins } })
              }
            />
          }
        />

        <BaseSkinsExcludedRow />

        <SettingRow
          setting="builtinMods.mapSkin"
          description={mapSkinDescription(settings.builtinMods.mapSkin ?? "game")}
          hint={m.settings_builtins_map_skin_hint()}
          control={
            <SegmentedControl
              aria-label={m.settings_builtins_map_skin_title()}
              options={mapSkinOptions()}
              value={settings.builtinMods.mapSkin ?? "game"}
              onChange={(mapSkin) => update({ builtinMods: { ...settings.builtinMods, mapSkin } })}
            />
          }
        />

        <ForcedMapSkinRow />

        <SettingRow
          setting="builtinMods.mapDecorations"
          layout="stacked"
          description={m.settings_builtins_map_decorations_description()}
          hint={m.settings_builtins_map_decorations_hint()}
          control={<MapDecorationsControl />}
        />

        <CharacterInkingRows />
      </SettingRows>
    </SectionCard>
  );
}

/** The champions that keep their own skins, drawn only while base skins is on. */
function BaseSkinsExcludedRow() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const leaguePath = settings.leaguePath;
  const hidden = (settings.builtinMods.baseSkins ?? "off") === "off";
  const excluded = settings.builtinMods.baseSkinsExcluded ?? [];
  const { data, isPending } = useQuery({
    ...championQueries.roster(leaguePath),
    enabled: !hidden && !!leaguePath,
  });

  const options = (data ?? []).map((champion) => ({
    value: champion.id.toLowerCase(),
    label: champion.name ?? champion.id,
  }));
  const missing = isPending
    ? []
    : missingChoices(
        excluded,
        options.map((option) => option.value),
      );

  return (
    <SettingRow
      setting="builtinMods.baseSkinsExcluded"
      dependent
      hidden={hidden}
      layout="stacked"
      description={excludedChampionsDescription(!!leaguePath, missing)}
      hint={m.settings_builtins_base_skins_excluded_hint()}
      control={
        <MultiSelect
          variant="field"
          options={options}
          selected={new Set(excluded)}
          placeholder={m.settings_builtins_base_skins_excluded_placeholder()}
          label={m.settings_builtins_base_skins_excluded_title()}
          disabled={!leaguePath || isPending}
          onChange={(selected) =>
            update({
              builtinMods: { ...settings.builtinMods, baseSkinsExcluded: [...selected].sort() },
            })
          }
        />
      }
    />
  );
}

/** What the excluded champions row says about the list as it stands. */
function excludedChampionsDescription(hasPath: boolean, missing: string[]): ReactNode {
  if (!hasPath) {
    return m.settings_builtins_base_skins_excluded_no_path();
  }

  if (missing.length > 0) {
    return (
      <span className="text-warning-text">
        {m.settings_builtins_base_skins_excluded_missing_description({
          names: missing.join(", "),
        })}
      </span>
    );
  }

  return m.settings_builtins_base_skins_excluded_description();
}

/** The chosen skin's row, drawn only while the map skin mode is `forced`. */
function ForcedMapSkinRow() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const { data: skins = [], isPending } = useForcibleMapSkins(settings.leaguePath);
  const hasPath = !!settings.leaguePath;
  const value = settings.builtinMods.forcedMapSkin ?? "";

  return (
    <SettingRow
      setting="builtinMods.forcedMapSkin"
      dependent
      hidden={settings.builtinMods.mapSkin !== "forced"}
      description={forcedMapSkinDescription(value, skins, hasPath, isPending)}
      hint={m.settings_builtins_forced_map_skin_hint()}
      control={
        <ForcedMapSkinPicker
          skins={skins}
          value={value}
          disabled={!hasPath || isPending}
          onChange={(forcedMapSkin) =>
            update({ builtinMods: { ...settings.builtinMods, forcedMapSkin } })
          }
        />
      }
    />
  );
}

/** What the chosen skin row says about the choice as it stands. */
function forcedMapSkinDescription(
  value: string,
  skins: ForcibleMapSkin[],
  hasPath: boolean,
  isPending: boolean,
): ReactNode {
  if (!hasPath) {
    return m.settings_builtins_forced_map_skin_no_path_description();
  }

  if (value === "") {
    return m.settings_builtins_forced_map_skin_none_description();
  }

  if (!isPending && !skins.some((skin) => skin.name === value)) {
    return (
      <span className="text-warning-text">
        {m.settings_builtins_forced_map_skin_missing_description({ name: value })}
      </span>
    );
  }

  return m.settings_builtins_forced_map_skin_description();
}
