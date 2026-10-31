import { ArrowsClockwiseIcon, ShieldWarningIcon, StackIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useState } from "react";

import {
  AlertBox,
  Button,
  Inline,
  SectionCard,
  Stack,
  TftIcon,
  useToast,
  Field,
} from "@/components";
import { errorSummary, m } from "@/i18n";
import { useFixLeagueElevated } from "@/modules/diagnostics/api";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";
import { useDetectLeagueRunAsAdmin } from "@/modules/settings/api";

import { useLoadedSettings, useUpdateSettings } from "../api";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { SettingRows } from "./SettingRows";
import { SettingSwitch } from "./SettingSwitch";
import { WadBlocklistEditor } from "./WadBlocklistEditor";

export function PatchingSection() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  const { data: leagueRunsAsAdmin } = useDetectLeagueRunAsAdmin();
  const fixLeagueElevated = useFixLeagueElevated();
  const { data: patcherStatus } = usePatcherStatus();
  const { mutate: rebuildOverlay, isPending: isRebuilding } = useRebuildOverlay();
  const toast = useToast();

  const isPatcherRunning = patcherStatus?.running ?? false;

  const handleRebuildOverlay = () => {
    rebuildOverlay(undefined, {
      onSuccess: () =>
        toast.success("Overlay rebuilt", "The overlay was regenerated from scratch."),
      onError: (error) => toast.error("Rebuild failed", errorSummary(error)),
    });
  };

  return (
    <Stack gap={6}>
      <SectionCard title="Patching" icon={<ShieldWarningIcon className="size-5" />}>
        <SettingGroup id="patching.injector" title="Injector">
          <SettingRow
            setting="patchTft"
            icon={<TftIcon className="size-4 shrink-0" />}
            description="Turn this off if you only play Summoner's Rift."
            hint="Applies mods to Map22.wad.client, the Teamfight Tactics map archive."
            control={<SettingSwitch setting="patchTft" />}
          />

          {leagueRunsAsAdmin && (
            <AlertBox tone="warning">
              <Stack gap={2}>
                {m["patcher.LEAGUE_ELEVATED.settings_description"]()}
                <Inline>
                  <Button variant="outline" size="sm" onClick={() => void fixLeagueElevated()}>
                    {m["patcher.LEAGUE_ELEVATED.fix_action"]()}
                  </Button>
                </Inline>
              </Stack>
            </AlertBox>
          )}

          <SettingRow
            setting="verbosePatcherLogging"
            description="Logs injector internals to the app log. Noisy, so keep it for bug reports."
            hint="Takes effect the next time the patcher starts."
            control={<SettingSwitch setting="verbosePatcherLogging" />}
          />

          <SettingRow
            setting="betaPatcher"
            description="Patcher builds come from the beta channel."
            hint="Takes effect the next time the patcher starts after the build downloads."
            control={<SettingSwitch setting="betaPatcher" />}
          />
        </SettingGroup>

        <SettingGroup id="patching.mod-safety" title="Mod safety">
          <SettingRow
            setting="blockScriptsWad"
            description="Stops mods from modifying Lua game scripts"
            control={<SettingSwitch setting="blockScriptsWad" />}
          />

          {!settings.blockScriptsWad && (
            <AlertBox tone="warning">
              Modding allows running Lua scripts. Only install from sources you trust.
            </AlertBox>
          )}
        </SettingGroup>

        <SettingGroup id="patching.game-archives" title="Game archives">
          <SettingRow
            setting="fullWadScan"
            description="Every archive gets verified up front at startup."
            hint="On-demand scanning can cause sporadic crashes, so the patcher only does it while League's Automatically Send Crash Reports setting is off. With crash reporting on, every WAD is scanned up front regardless."
            control={<SettingSwitch setting="fullWadScan" />}
          />

          <SettingRow
            setting="disableCrashReporting"
            description="League's crash reporting gets turned off when the patcher starts."
            hint="Archives are only verified on demand while Riot's crash reporting is off. It lives in LeagueClientSettings.yaml, which the client rewrites when it exits, so the patcher reapplies this at every start."
            control={<SettingSwitch setting="disableCrashReporting" />}
          />
        </SettingGroup>

        <SettingGroup id="patching.incidents" title="Incidents">
          <SettingRow
            setting="readGameLog"
            description="The incident reporter reads the game log to see what went wrong."
            hint="Turn this off to keep the manager from opening anything under the League install. An incident still records how the game ended, and the archives the patcher saw."
            control={<SettingSwitch setting="readGameLog" />}
          />

          <SettingRow
            setting="keepIncidents"
            description="How many incidents to keep"
            hint="The newest are kept, under 1 MB together, and the oldest goes first."
            control={
              <KeepIncidentsField
                value={settings.keepIncidents}
                onCommit={(keepIncidents) => update({ keepIncidents })}
              />
            }
          />
        </SettingGroup>
      </SectionCard>

      <SectionCard
        title="Overlay"
        icon={<StackIcon className="size-5" />}
        description="Options for the layered filesystem that the patcher uses"
      >
        <SettingRows>
          <SettingRow
            setting="applyStringOverridesToAllLocales"
            description="Every client locale will be overridden with Default or English."
            control={<SettingSwitch setting="applyStringOverridesToAllLocales" />}
          />

          <SettingRow
            kind="action"
            title="Rebuild overlay"
            description="Discards the cached overlay and builds it again. Stop the patcher first."
            hint="Use this when a mod looks applied here but not in-game, or the game crashes with the patcher on."
            control={
              <Button
                variant="outline"
                loading={isRebuilding}
                disabled={isPatcherRunning}
                left={<ArrowsClockwiseIcon weight="bold" className="size-4" />}
                onClick={handleRebuildOverlay}
              >
                Rebuild
              </Button>
            }
          />

          <SettingRow
            kind="action"
            layout="stacked"
            setting="wadBlocklist"
            control={<WadBlocklistEditor />}
          />
        </SettingRows>
      </SectionCard>
    </Stack>
  );
}

const MIN_KEPT_INCIDENTS = 1;
const MAX_KEPT_INCIDENTS = 200;

interface KeepIncidentsFieldProps {
  value: number;
  onCommit: (value: number) => void;
}

/**
 * A count that commits on blur or Enter, clamped to the store's range.
 *
 * A keystroke is not a save, because typing `150` would otherwise write `1`
 * and `15` on the way there.
 */
function KeepIncidentsField({ value, onCommit }: KeepIncidentsFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const parsed = draft.trim() === "" ? Number.NaN : Math.round(Number(draft));
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(MAX_KEPT_INCIDENTS, Math.max(MIN_KEPT_INCIDENTS, parsed));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") setDraft(String(value));
  }

  return (
    <Field.Control
      type="number"
      inputMode="numeric"
      min={MIN_KEPT_INCIDENTS}
      max={MAX_KEPT_INCIDENTS}
      step={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      aria-label="Keep incidents"
      className="w-20 text-right tabular-nums"
    />
  );
}
