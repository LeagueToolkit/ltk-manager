import { TabsIcon } from "@phosphor-icons/react";

import { Inline, PathField, SectionCard, Slider, Switch } from "@/components";
import { m } from "@/i18n";
import {
  useForwardLookingMeta,
  useSearchGame,
  useSearchObjects,
  useSetForwardLookingMeta,
  useSetSearchGame,
  useSetSearchObjects,
  usePreviewOnClick,
  usePreviewSound,
  usePreviewSoundVolume,
  useSetPreviewDisplay,
  useSetPreviewOnClick,
} from "@/stores";

import { useLoadedSettings, useUpdateSettings } from "../api";
import { ComingPatchStatus } from "./ComingPatchStatus";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";

export function ProjectEditorSection() {
  const previewOnClick = usePreviewOnClick();
  const setPreviewOnClick = useSetPreviewOnClick();
  const searchGame = useSearchGame();
  const setSearchGame = useSetSearchGame();
  const searchObjects = useSearchObjects();
  const setSearchObjects = useSetSearchObjects();
  const forwardLookingMeta = useForwardLookingMeta();
  const setForwardLookingMeta = useSetForwardLookingMeta();

  return (
    <SectionCard
      title={m.settings_project_editor_title()}
      icon={<TabsIcon className="size-5" />}
      description={m.settings_project_editor_description()}
    >
      <SettingGroup id="workshop.behavior" title={m.settings_project_behavior_title()}>
        <SettingRow
          setting="layout.previewOnClick"
          description={m.settings_preview_on_click_description()}
          hint={m.settings_preview_on_click_hint()}
          control={<Switch checked={previewOnClick} onCheckedChange={setPreviewOnClick} />}
        />

        <SettingRow
          setting="layout.searchGame"
          description={m.settings_search_game_description()}
          hint={m.settings_search_game_hint()}
          control={<Switch checked={searchGame} onCheckedChange={setSearchGame} />}
        />

        <SettingRow
          setting="layout.searchObjects"
          description={m.settings_search_objects_description()}
          hint={m.settings_search_objects_hint()}
          control={<Switch checked={searchObjects} onCheckedChange={setSearchObjects} />}
        />

        <SettingRow
          setting="layout.forwardLookingMeta"
          description={m.settings_forward_looking_description()}
          hint={m.settings_forward_looking_hint()}
          control={<Switch checked={forwardLookingMeta} onCheckedChange={setForwardLookingMeta} />}
        />
        <ComingPatchStatus />
      </SettingGroup>

      <ViewportGroup />
      <AudioGroup />
    </SectionCard>
  );
}

/** The viewport preferences that the toolbar of a viewport also sets. */
function ViewportGroup() {
  const sound = usePreviewSound();
  const volume = usePreviewSoundVolume();
  const setDisplay = useSetPreviewDisplay();

  return (
    <SettingGroup id="workshop.viewport" title={m.settings_viewport_title()}>
      <SettingRow
        setting="layout.previewSound"
        description={m.settings_viewport_sound_description()}
        hint={m.settings_viewport_sound_hint()}
        control={
          <Switch
            checked={sound}
            onCheckedChange={(previewSound) => setDisplay({ previewSound })}
          />
        }
      />

      <SettingRow
        kind="action"
        setting="layout.previewSoundVolume"
        description={m.settings_viewport_sound_volume_description()}
        controlClassName="w-72 shrink"
        control={
          <Inline gap={3}>
            <Slider
              aria-label={m.settings_viewport_sound_volume_title()}
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(previewSoundVolume) => setDisplay({ previewSoundVolume })}
            />
            <VolumeReading volume={volume} />
          </Inline>
        }
      />
    </SettingGroup>
  );
}

/** The tools that audio editing runs. */
function AudioGroup() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const setConsole = (wwiseConsolePath: string | null) =>
    update({ audio: { ...settings.audio, wwiseConsolePath } });

  return (
    <SettingGroup id="workshop.audio" title={m.settings_audio_title()}>
      <SettingRow
        kind="action"
        layout="stacked"
        setting="audio.wwiseConsolePath"
        description={m.settings_wwise_console_description()}
        control={
          <PathField
            pick="file"
            filters={[{ name: m.settings_wwise_console_title(), extensions: ["exe"] }]}
            aria-label={m.settings_wwise_console_title()}
            value={settings.audio.wwiseConsolePath ?? ""}
            onSelect={setConsole}
            onClear={() => setConsole(null)}
            placeholder={m.settings_wwise_console_placeholder()}
            dialogTitle={m.settings_wwise_console_dialog_title()}
          />
        }
      />
    </SettingGroup>
  );
}

/** The volume as a percent, beside its slider. */
function VolumeReading({ volume }: { volume: number }) {
  return (
    <span className="w-10 shrink-0 text-right font-mono text-xs text-surface-300 tabular-nums">
      {m.settings_viewport_sound_volume_reading({ percent: Math.round(volume * 100) })}
    </span>
  );
}
