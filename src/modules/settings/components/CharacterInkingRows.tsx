import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { Checkbox, Disclosure, MultiSelect, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { CharacterInking } from "@/lib/tauri";
import { championQueries } from "@/modules/champions";

import { useInkingMaps, useLoadedSettings, useUpdateInking } from "../api";
import {
  INKING_PRESETS,
  INKING_TEAM_COLORS,
  inkingColorModeOptions,
  inkingMapsOptions,
  inkingOf,
  inkingScopeOptions,
  inkingStyle,
  inkingStyleOptions,
  mapLabel,
  missingChoices,
} from "../builtinMods";
import { CharacterInkingPreview } from "./CharacterInkingPreview";
import { ColorSwatch, InkingSliderRow } from "./InkingControls";
import { SettingRow } from "./SettingRow";

/**
 * The character inking switch and the rows under it: who gets the outline, on which maps, and
 * how it looks, with a live preview.
 *
 * Every row below the switch is dependent and draws nothing while inking is off, so the
 * choices outlive the switch.
 */
export function CharacterInkingRows() {
  const inking = inkingOf(useLoadedSettings());
  const updateInking = useUpdateInking();
  const off = !inking.enabled;

  return (
    <>
      <SettingRow
        setting="builtinMods.characterInking.enabled"
        description={m.settings_builtins_inking_description()}
        hint={m.settings_builtins_inking_hint()}
        control={
          <Switch
            checked={inking.enabled}
            onCheckedChange={(enabled) => updateInking({ enabled })}
          />
        }
      />

      <SettingRow
        setting="builtinMods.characterInking.scope"
        dependent
        hidden={off}
        hint={inking.scope === "all" ? m.settings_builtins_inking_scope_all_hint() : undefined}
        control={
          <SegmentedControl
            aria-label={m.settings_builtins_inking_scope_title()}
            options={inkingScopeOptions()}
            value={inking.scope}
            onChange={(scope) => updateInking({ scope })}
          />
        }
      />

      <ChosenChampionsRow inking={inking} hidden={off || inking.scope !== "chosen"} />

      <SettingRow
        setting="builtinMods.characterInking.maps"
        dependent
        hidden={off}
        hint={m.settings_builtins_inking_maps_hint()}
        control={
          <SegmentedControl
            aria-label={m.settings_builtins_inking_maps_title()}
            options={inkingMapsOptions()}
            value={inking.maps}
            onChange={(maps) => updateInking({ maps })}
          />
        }
      />

      <ChosenMapsRow inking={inking} hidden={off || inking.maps !== "chosen"} />

      <SettingRow
        title={m.settings_builtins_inking_style_title()}
        dependent
        hidden={off}
        control={
          <SegmentedControl
            aria-label={m.settings_builtins_inking_style_title()}
            options={inkingStyleOptions()}
            value={inkingStyle(inking)}
            onChange={(style) => {
              if (style !== "custom") updateInking(INKING_PRESETS[style]);
            }}
          />
        }
      />

      <ColorRow inking={inking} hidden={off} />

      <InkingSliderRow
        setting="builtinMods.characterInking.width"
        hidden={off}
        value={inking.width}
        min={10}
        max={150}
        readout={(width) => (width / 10).toFixed(1)}
        onSave={(width) => updateInking({ width })}
      />

      {!off && (
        <Disclosure.Root className="flex flex-col gap-3">
          <Disclosure.Trigger className="ml-4 flex items-center gap-1.5 text-sm font-medium text-surface-300">
            <Disclosure.Caret />
            {m.settings_builtins_inking_advanced_label()}
          </Disclosure.Trigger>
          <Disclosure.Panel className="flex flex-col gap-3">
            <InkingSliderRow
              setting="builtinMods.characterInking.opacity"
              value={inking.opacity}
              min={10}
              max={100}
              readout={(opacity) => m.settings_builtins_inking_percent_value({ value: opacity })}
              onSave={(opacity) => updateInking({ opacity })}
            />
            <InkingSliderRow
              setting="builtinMods.characterInking.cameraDistance"
              hint={m.settings_builtins_inking_camera_distance_hint()}
              value={inking.cameraDistance}
              min={1000}
              max={9000}
              step={100}
              readout={String}
              onSave={(cameraDistance) => updateInking({ cameraDistance })}
            />
            <InkingSliderRow
              setting="builtinMods.characterInking.deathFade"
              hint={m.settings_builtins_inking_death_fade_hint()}
              value={inking.deathFade}
              min={0}
              max={2000}
              step={100}
              readout={(fade) =>
                m.settings_builtins_inking_seconds_value({ value: (fade / 1000).toFixed(1) })
              }
              onSave={(deathFade) => updateInking({ deathFade })}
            />
          </Disclosure.Panel>
        </Disclosure.Root>
      )}

      {!off && <CharacterInkingPreview inking={inking} />}
    </>
  );
}

interface InkingRowProps {
  inking: CharacterInking;
  hidden: boolean;
}

/** The chosen champions, drawn only while the scope is `chosen`. */
function ChosenChampionsRow({ inking, hidden }: InkingRowProps) {
  const leaguePath = useLoadedSettings().leaguePath;
  const updateInking = useUpdateInking();
  const { data, isPending } = useQuery({
    ...championQueries.roster(leaguePath),
    enabled: !hidden && !!leaguePath,
  });
  const champions = data ?? [];

  const options = champions.map((champion) => ({
    value: champion.id.toLowerCase(),
    label: champion.name ?? champion.id,
  }));
  const missing = isPending
    ? []
    : missingChoices(
        inking.chosenChampions,
        options.map((option) => option.value),
      );

  return (
    <SettingRow
      setting="builtinMods.characterInking.chosenChampions"
      dependent
      hidden={hidden}
      layout="stacked"
      description={choiceDescription({
        hasPath: !!leaguePath,
        noPath: m.settings_builtins_inking_champions_no_path(),
        empty: inking.chosenChampions.length === 0,
        emptyText: m.settings_builtins_inking_champions_empty(),
        missing,
        fallback: m.settings_builtins_inking_champions_description(),
      })}
      control={
        <MultiSelect
          variant="field"
          options={options}
          selected={new Set(inking.chosenChampions)}
          placeholder={m.settings_builtins_inking_champions_placeholder()}
          label={m.settings_builtins_inking_champions_title()}
          disabled={!leaguePath || isPending}
          onChange={(selected) => updateInking({ chosenChampions: [...selected].sort() })}
        />
      }
    />
  );
}

/** One checkbox per map of the install, drawn only while the maps scope is `chosen`. */
function ChosenMapsRow({ inking, hidden }: InkingRowProps) {
  const leaguePath = useLoadedSettings().leaguePath;
  const updateInking = useUpdateInking();
  const { data, isPending } = useInkingMaps(leaguePath);
  const maps = data ?? [];
  const chosen = new Set(inking.chosenMaps);
  const missing = isPending
    ? []
    : missingChoices(
        inking.chosenMaps,
        maps.map((map) => map.name),
      );

  const toggle = (name: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) next.add(name);
    else next.delete(name);
    updateInking({ chosenMaps: [...next].sort() });
  };

  let control: ReactNode = (
    <div className="flex flex-wrap gap-x-4 gap-y-2" data-ui="CharacterInkingRows:maps">
      {maps.map((map) => (
        <Checkbox
          key={map.name}
          label={mapLabel(map.archive)}
          checked={chosen.has(map.name)}
          onCheckedChange={(checked) => toggle(map.name, checked)}
        />
      ))}
    </div>
  );
  if (leaguePath && isPending) {
    control = (
      <span className="text-sm text-surface-400">
        {m.settings_builtins_inking_chosen_maps_loading()}
      </span>
    );
  }

  return (
    <SettingRow
      setting="builtinMods.characterInking.chosenMaps"
      dependent
      hidden={hidden}
      layout="stacked"
      description={choiceDescription({
        hasPath: !!leaguePath,
        noPath: m.settings_builtins_inking_chosen_maps_no_path(),
        empty: inking.chosenMaps.length === 0,
        emptyText: m.settings_builtins_inking_chosen_maps_empty(),
        missing,
        fallback: undefined,
      })}
      control={control}
    />
  );
}

interface ChoiceDescription {
  hasPath: boolean;
  noPath: string;
  empty: boolean;
  emptyText: string;
  missing: string[];
  fallback: string | undefined;
}

/** What a chosen-list row says about the list as it stands. */
function choiceDescription({
  hasPath,
  noPath,
  empty,
  emptyText,
  missing,
  fallback,
}: ChoiceDescription): ReactNode {
  if (!hasPath) return noPath;
  if (empty) return emptyText;
  if (missing.length > 0) {
    return (
      <span className="text-warning-text">
        {m.settings_builtins_inking_missing_description({ names: missing.join(", ") })}
      </span>
    );
  }
  return fallback;
}

/** The outline color, or the ally and enemy colors with team colors on. */
function ColorRow({ inking, hidden }: InkingRowProps) {
  const updateInking = useUpdateInking();
  const team = INKING_TEAM_COLORS && inking.colorMode === "team";

  let swatches: ReactNode = (
    <ColorSwatch
      label={m.settings_builtins_inking_color_label()}
      value={inking.color}
      onCommit={(color) => updateInking({ color })}
    />
  );
  if (team) {
    swatches = (
      <>
        <ColorSwatch
          label={m.settings_builtins_inking_color_ally_label()}
          value={inking.allyColor}
          onCommit={(allyColor) => updateInking({ allyColor })}
        />
        <ColorSwatch
          label={m.settings_builtins_inking_color_enemy_label()}
          value={inking.enemyColor}
          onCommit={(enemyColor) => updateInking({ enemyColor })}
        />
      </>
    );
  }

  return (
    <SettingRow
      setting="builtinMods.characterInking.color"
      dependent
      hidden={hidden}
      hint={team ? m.settings_builtins_inking_color_team_hint() : undefined}
      control={
        <div className="flex items-center gap-2">
          {INKING_TEAM_COLORS && (
            <SegmentedControl
              size="sm"
              aria-label={m.settings_builtins_inking_color_title()}
              options={inkingColorModeOptions()}
              value={inking.colorMode}
              onChange={(colorMode) => updateInking({ colorMode })}
            />
          )}
          {swatches}
        </div>
      }
    />
  );
}
