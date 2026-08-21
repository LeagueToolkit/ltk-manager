import {
  ArrowsClockwiseIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useState } from "react";

import {
  AlertBox,
  Button,
  FieldControl,
  SectionCard,
  Separator,
  Switch,
  TftIcon,
  useToast,
} from "@/components";
import type { Settings } from "@/lib/tauri";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";
import { useDetectLeagueRunAsAdmin } from "@/modules/settings/api";

import { SettingRow } from "./SettingRow";
import { SettingsGrid } from "./SettingsGrid";
import { WadBlocklistEditor } from "./WadBlocklistEditor";

interface PatchingSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function PatchingSection({ settings, onSave }: PatchingSectionProps) {
  const { data: leagueRunsAsAdmin } = useDetectLeagueRunAsAdmin();
  const { data: patcherStatus } = usePatcherStatus();
  const { mutate: rebuildOverlay, isPending: isRebuilding } = useRebuildOverlay();
  const toast = useToast();

  const isPatcherRunning = patcherStatus?.running ?? false;

  const handleRebuildOverlay = () => {
    rebuildOverlay(undefined, {
      onSuccess: () =>
        toast.success("Overlay rebuilt", "The overlay was regenerated from scratch."),
      onError: (error) => toast.error("Rebuild failed", error.message),
    });
  };

  return (
    <SettingsGrid>
      <SectionCard title="Patching" icon={<ShieldWarningIcon className="h-5 w-5" />}>
        <div className="flex flex-col gap-3">
          <SettingRow
            title={
              <>
                <TftIcon className="h-4 w-4 shrink-0" />
                Patch TFT files
              </>
            }
            description="Turn this off if you only play Summoner's Rift."
            hint="Applies mods to Map22.wad.client, the Teamfight Tactics map archive."
            control={
              <Switch
                checked={settings.patchTft}
                onCheckedChange={(checked) => onSave({ ...settings, patchTft: checked })}
              />
            }
          />

          <SettingRow
            title="Run injector elevated"
            description="Leave off unless mods fail to load."
            hint="Required when League itself runs as administrator. Windows shows a UAC prompt each time the patcher starts, unless LTK Manager is already elevated."
            control={
              <Switch
                checked={settings.elevateInjector}
                onCheckedChange={(checked) => onSave({ ...settings, elevateInjector: checked })}
              />
            }
          />

          {leagueRunsAsAdmin && (
            <AlertBox variant="warning">
              League runs as administrator, so the injector elevates automatically. Expect a UAC
              prompt even with this off.
            </AlertBox>
          )}

          <SettingRow
            title="Verbose patcher logging"
            description="Logs injector internals to the app log. Noisy, so keep it for bug reports."
            hint="Takes effect the next time the patcher starts."
            control={
              <Switch
                checked={settings.verbosePatcherLogging}
                onCheckedChange={(checked) =>
                  onSave({ ...settings, verbosePatcherLogging: checked })
                }
              />
            }
          />
        </div>
      </SectionCard>

      <SectionCard title="Safety & Integrity" icon={<ShieldCheckIcon className="h-5 w-5" />}>
        <div className="flex flex-col gap-3">
          <SettingRow
            title="Block Scripts.wad.client"
            description="Stops mods from modifying game scripts."
            control={
              <Switch
                checked={settings.blockScriptsWad}
                onCheckedChange={(checked) => onSave({ ...settings, blockScriptsWad: checked })}
              />
            }
          />

          {!settings.blockScriptsWad && (
            <AlertBox variant="warning">
              Script modding is on, so a mod can run arbitrary game code. Only install from sources
              you trust.
            </AlertBox>
          )}

          <SettingRow
            title="Warn about missing dependencies"
            description="Flags enabled mods that reference files removed from the game."
            hint="Shown as a badge on each affected mod, plus a one-time warning when you start the patcher."
            control={
              <Switch
                checked={settings.linkedBinCheckEnabled}
                onCheckedChange={(checked) =>
                  onSave({ ...settings, linkedBinCheckEnabled: checked })
                }
              />
            }
          />

          <SettingRow
            title="Enforce anti-skinhack scan"
            description="Scans modded files for skinhacks and aborts patching if any are found."
            hint="Temporary. It goes away once third-party mod managers have adapted to the new anti-skinhack requirements."
            control={
              <Switch
                checked={settings.enforceSkinhackScan}
                onCheckedChange={(checked) => onSave({ ...settings, enforceSkinhackScan: checked })}
              />
            }
          />

          {!settings.enforceSkinhackScan && (
            <AlertBox variant="warning">
              Enforcement is off, so mods flagged as skinhacks will load.
            </AlertBox>
          )}

          <SettingRow
            title="Scan every WAD up front"
            description="Every archive gets verified up front at startup."
            hint="On-demand scanning can cause sporadic crashes, so the patcher only does it while League's Automatically Send Crash Reports setting is off. With crash reporting on, every WAD is scanned up front regardless."
            control={
              <Switch
                checked={settings.fullWadScan}
                onCheckedChange={(checked) => onSave({ ...settings, fullWadScan: checked })}
              />
            }
          />

          <SettingRow
            title="Disable crash reporting"
            description="League's crash reporting gets turned off when the patcher starts."
            hint="Archives are only verified on demand while Riot's crash reporting is off. It lives in LeagueClientSettings.yaml, which the client rewrites when it exits, so the patcher reapplies this at every start."
            control={
              <Switch
                checked={settings.disableCrashReporting}
                onCheckedChange={(checked) =>
                  onSave({ ...settings, disableCrashReporting: checked })
                }
              />
            }
          />

          <SettingRow
            title="Read League's game log after a game"
            description="League's r3dlog, read once a game ends, for the codes a verdict rests on"
            hint="Turn this off to keep the manager from opening anything under the League install. An incident still records how the game ended, and the archives the patcher saw."
            control={
              <Switch
                checked={settings.readGameLog}
                onCheckedChange={(checked) => onSave({ ...settings, readGameLog: checked })}
              />
            }
          />

          <SettingRow
            title="Keep incidents"
            description="How many games that went wrong stay on the Games tab"
            hint="The newest are kept, under 1 MB together, and the oldest goes first."
            control={
              <KeepIncidentsField
                value={settings.keepIncidents}
                onCommit={(keepIncidents) => onSave({ ...settings, keepIncidents })}
              />
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Overlay"
        icon={<StackIcon className="h-5 w-5" />}
        description="Options for the layered filesystem that the patcher uses"
        className="lg:col-span-2"
      >
        <div className="flex flex-col gap-3">
          <SettingRow
            title="Apply string overrides to all locales"
            description="Every client locale will be overridden with Default or English."
            control={
              <Switch
                checked={settings.applyStringOverridesToAllLocales}
                onCheckedChange={(checked) =>
                  onSave({ ...settings, applyStringOverridesToAllLocales: checked })
                }
              />
            }
          />

          <SettingRow
            kind="action"
            title="Rebuild overlay"
            description="Discards the cached overlay and builds it again. Stop the patcher first."
            hint="Use this when a mod looks applied here but not in-game, or the game crashes with the patcher on."
            control={
              <Button
                variant="outline"
                size="sm"
                loading={isRebuilding}
                disabled={isPatcherRunning}
                left={<ArrowsClockwiseIcon weight="bold" className="h-4 w-4" />}
                onClick={handleRebuildOverlay}
              >
                Rebuild
              </Button>
            }
          />

          <Separator className="my-0" />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-surface-200">WAD blocklist</span>
            <WadBlocklistEditor settings={settings} onSave={onSave} />
          </div>
        </div>
      </SectionCard>
    </SettingsGrid>
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
    <FieldControl
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
      className="w-20 px-2.5 text-right tabular-nums"
    />
  );
}
