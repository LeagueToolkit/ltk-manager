import { PuzzlePieceIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { SectionCard, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { ForcibleMapSkin, Settings } from "@/lib/tauri";

import { useForcibleMapSkins } from "../api";
import { baseSkinsOptions, mapSkinDescription, mapSkinOptions } from "../builtinMods";
import { ForcedMapSkinPicker } from "./ForcedMapSkinPicker";
import { MapDecorationsControl } from "./MapDecorationsControl";
import { SettingRow } from "./SettingRow";
import { SettingRows } from "./SettingRows";

interface BuiltinModsSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

/** The switches for the mods the manager generates, one row each. */
export function BuiltinModsSection({ settings, onSave }: BuiltinModsSectionProps) {
  return (
    <SectionCard
      title={m.settings_tab_builtins_title()}
      icon={<PuzzlePieceIcon className="h-5 w-5" />}
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
                onSave({
                  ...settings,
                  builtinMods: { ...settings.builtinMods, defaultWardSkins: checked },
                })
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
              value={settings.builtinMods.baseSkins}
              onChange={(baseSkins) =>
                onSave({ ...settings, builtinMods: { ...settings.builtinMods, baseSkins } })
              }
            />
          }
        />

        <SettingRow
          setting="builtinMods.mapSkin"
          description={mapSkinDescription(settings.builtinMods.mapSkin)}
          hint={m.settings_builtins_map_skin_hint()}
          control={
            <SegmentedControl
              aria-label={m.settings_builtins_map_skin_title()}
              options={mapSkinOptions()}
              value={settings.builtinMods.mapSkin}
              onChange={(mapSkin) =>
                onSave({ ...settings, builtinMods: { ...settings.builtinMods, mapSkin } })
              }
            />
          }
        />

        <ForcedMapSkinRow settings={settings} onSave={onSave} />

        <SettingRow
          setting="builtinMods.mapDecorations"
          layout="stacked"
          description={m.settings_builtins_map_decorations_description()}
          hint={m.settings_builtins_map_decorations_hint()}
          control={<MapDecorationsControl settings={settings} onSave={onSave} />}
        />
      </SettingRows>
    </SectionCard>
  );
}

/** The chosen skin's row, drawn only while the map skin mode is `forced`. */
function ForcedMapSkinRow({ settings, onSave }: BuiltinModsSectionProps) {
  const { data: skins = [], isPending } = useForcibleMapSkins(settings.leaguePath);
  const hasPath = !!settings.leaguePath;
  const value = settings.builtinMods.forcedMapSkin;

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
            onSave({ ...settings, builtinMods: { ...settings.builtinMods, forcedMapSkin } })
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
