import {
  ArrowsClockwiseIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  StackIcon,
} from "@phosphor-icons/react";

import { AlertBox, Button, SectionCard, Separator, Switch, TftIcon, useToast } from "@/components";
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
            title="Lazy WAD scan"
            description="Archives get verified on demand when mounting."
            hint="This can cause sporadic crashes, so it only applies when League's Automatically Send Crash Reports setting is off. With crash reporting on, the patcher scans up front as usual."
            control={
              <Switch
                checked={settings.lazyWadScan}
                onCheckedChange={(checked) => onSave({ ...settings, lazyWadScan: checked })}
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
