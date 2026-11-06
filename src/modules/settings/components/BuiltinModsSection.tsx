import { PuzzlePieceIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { AlertBox, Button, PathField, SectionCard, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { ForcibleMapSkin } from "@/lib/tauri";

import { settingsQueries, useForcibleMapSkins, useLoadedSettings, useUpdateSettings } from "../api";
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

const MEDIA_FILTERS = [
  {
    name: "Images and Videos",
    extensions: ["png", "jpg", "jpeg", "webp", "bmp", "mp4", "webm", "mov", "mkv", "avi", "gif"],
  },
  {
    name: "Images",
    extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
  },
  {
    name: "Videos",
    extensions: ["mp4", "webm", "mov", "mkv", "avi", "gif"],
  },
];

function isVideoPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const ext = path.split(".").pop()?.toLowerCase();
  return ["mp4", "webm", "mov", "mkv", "avi", "gif"].includes(ext ?? "");
}

/** Controls for the custom loading screen background. */
function LoadingScreenRows() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const navigate = useNavigate({ from: "/settings" });
  const loadingScreen = loadingScreenOf(settings);
  const { data: ffmpegInstalled = true } = useQuery(settingsQueries.ffmpeg());

  const isVideo = isVideoPath(loadingScreen.assets);

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
            {isVideo && !ffmpegInstalled && (
              <AlertBox
                tone="warning"
                actions={
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        search: (prev) => ({ ...prev, tab: "integrations" }),
                      })
                    }
                  >
                    {m.settings_builtins_loading_screen_integrations_action()}
                  </Button>
                }
              >
                {m.settings_builtins_loading_screen_ffmpeg_notice()}
              </AlertBox>
            )}
          </div>
        }
      />
    </>
  );
}
