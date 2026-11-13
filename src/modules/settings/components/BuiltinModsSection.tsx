import { PuzzlePieceIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { PathField, SectionCard, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { ForcibleMapSkin } from "@/lib/tauri";

import { useForcibleMapSkins, useLoadedSettings, useUpdateSettings } from "../api";
import {
  baseSkinsOptions,
  loadingScreenOf,
  mapSkinDescription,
  mapSkinOptions,
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
      icon={<PuzzlePieceIcon className="size-6" />}
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

        <LoadingScreenRows />

        <CharacterInkingRows />
      </SettingRows>
    </SectionCard>
  );
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

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];
const VIDEO_EXTENSIONS = ["webm"];

const MEDIA_FILTERS = [
  {
    name: "Images and WebM videos",
    extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS],
  },
  {
    name: "Images",
    extensions: IMAGE_EXTENSIONS,
  },
  {
    name: "WebM videos",
    extensions: VIDEO_EXTENSIONS,
  },
];

/** The extension of `path`, lowercased, or an empty string if it has none. */
function extensionOf(path: string | null | undefined): string {
  if (!path) return "";
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedPath(path: string | null | undefined): boolean {
  const extension = extensionOf(path);
  return IMAGE_EXTENSIONS.includes(extension) || VIDEO_EXTENSIONS.includes(extension);
}

/** Controls for the custom loading screen background. */
function LoadingScreenRows() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const loadingScreen = loadingScreenOf(settings);
  const hasAsset = !!loadingScreen.assets;
  const isSupported = isSupportedPath(loadingScreen.assets);

  return (
    <>
      <SettingRow
        setting="builtinMods.loadingScreen.enabled"
        description={m.settings_builtins_loading_screen_description()}
        hint={m.settings_builtins_loading_screen_hint()}
        control={
          <Switch
            checked={loadingScreen.enabled}
            onCheckedChange={(checked) =>
              update({
                builtinMods: {
                  ...settings.builtinMods,
                  loadingScreen: { ...loadingScreen, enabled: checked },
                },
              })
            }
          />
        }
      />

      <SettingRow
        setting="builtinMods.loadingScreen.assets"
        dependent
        hidden={!loadingScreen.enabled}
        layout="stacked"
        description={m.settings_builtins_loading_screen_assets_description()}
        control={
          <div className="flex w-full flex-col gap-2">
            <PathField
              pick="file"
              filters={MEDIA_FILTERS}
              aria-label={m.settings_builtins_loading_screen_assets_title()}
              value={loadingScreen.assets}
              validity={hasAsset ? (isSupported ? "valid" : "invalid") : undefined}
              error={
                hasAsset && !isSupported
                  ? m.settings_builtins_loading_screen_assets_unsupported()
                  : undefined
              }
              onSelect={(path) =>
                update({
                  builtinMods: {
                    ...settings.builtinMods,
                    loadingScreen: { ...loadingScreen, assets: path },
                  },
                })
              }
              onClear={() =>
                update({
                  builtinMods: {
                    ...settings.builtinMods,
                    loadingScreen: { ...loadingScreen, assets: null },
                  },
                })
              }
              placeholder={m.settings_builtins_loading_screen_assets_placeholder()}
              dialogTitle={m.settings_builtins_loading_screen_title()}
            />
          </div>
        }
      />
    </>
  );
}
