import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";

import { AlertBox, Button, SectionCard, Switch, TftIcon, useToast } from "@/components";
import type { Settings } from "@/lib/tauri";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";
import { useDetectLeagueRunAsAdmin } from "@/modules/settings/api";

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
    <div className="space-y-6">
      <SectionCard title="Patching" icon={<ShieldAlert className="h-5 w-5" />}>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="flex items-center gap-2.5 text-sm font-medium text-surface-200">
                <TftIcon className="h-4 w-4 shrink-0" />
                Patch TFT files
              </span>
              <span className="block text-sm text-surface-400">
                Apply mods to Teamfight Tactics game files (Map22.wad.client). Disable this if you
                only play Summoner&apos;s Rift.
              </span>
            </div>
            <Switch
              checked={settings.patchTft}
              onCheckedChange={(checked) => onSave({ ...settings, patchTft: checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Apply string overrides to all locales
              </span>
              <span className="block text-sm text-surface-400">
                Patch mods&apos; text overrides into every installed game language instead of only
                the language your League client is set to. Enable this if you switch languages
                often.
              </span>
            </div>
            <Switch
              checked={settings.applyStringOverridesToAllLocales}
              onCheckedChange={(checked) =>
                onSave({ ...settings, applyStringOverridesToAllLocales: checked })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Run injector elevated
              </span>
              <span className="block text-sm text-surface-400">
                Runs the injection host with administrator privileges. Required when League itself
                runs as administrator. Leave this off unless mods fail to load. When on, Windows
                shows a UAC prompt each time the patcher starts (unless LTK Manager is already
                running as admin).
              </span>
            </div>
            <Switch
              checked={settings.elevateInjector}
              onCheckedChange={(checked) => onSave({ ...settings, elevateInjector: checked })}
            />
          </label>

          {leagueRunsAsAdmin && (
            <AlertBox variant="warning">
              League is configured to run as administrator, so the injector will be elevated
              automatically. You may see a UAC prompt when the patcher starts even with this setting
              off.
            </AlertBox>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Safety & Integrity" icon={<ShieldCheck className="h-5 w-5" />}>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Block Scripts.wad.client
              </span>
              <span className="block text-sm text-surface-400">
                Prevents mods from modifying game scripts. Disabling this allows mods to execute
                arbitrary game scripts.
              </span>
            </div>
            <Switch
              checked={settings.blockScriptsWad}
              onCheckedChange={(checked) => onSave({ ...settings, blockScriptsWad: checked })}
            />
          </label>

          {!settings.blockScriptsWad && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
              <p className="text-sm text-warning-text">
                Script modding is enabled. Only install mods from sources you trust.
              </p>
            </div>
          )}

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Warn about missing dependencies
              </span>
              <span className="block text-sm text-surface-400">
                Flag enabled mods whose property-bins reference files removed from the game.
              </span>
              <span className="block text-sm text-surface-400">
                Shown as a badge on each affected mod plus a one-time warning when you start the
                patcher. Disabling this hides the badges and the warning.
              </span>
            </div>
            <Switch
              checked={settings.linkedBinCheckEnabled}
              onCheckedChange={(checked) => onSave({ ...settings, linkedBinCheckEnabled: checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
                Enforce anti-skinhack scan
              </span>
              <span className="text-sm text-surface-400">
                Tells the patcher to scan modded files for skinhacks and abort if any are found.
                This is a temporary measure to prevent skinhacks from being loaded while third-party
                mod managers adapt to the new anti-skinhack requirements.{" "}
              </span>
              <span className="block text-sm font-bold text-warning-text">
                This setting will be removed in a future update once third-party mod managers have
                adapted to the new anti-skinhack requirements.
              </span>
            </div>
            <Switch
              checked={settings.enforceSkinhackScan}
              onCheckedChange={(checked) => onSave({ ...settings, enforceSkinhackScan: checked })}
            />
          </label>

          {!settings.enforceSkinhackScan && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
              <p className="text-sm text-warning-text">
                Anti-skinhack enforcement is off. Mods flagged as skinhacks will be allowed to load.
              </p>
            </div>
          )}

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">Lazy WAD scan</span>
              <span className="block text-sm text-surface-400">
                Verifies modded archives as the game loads them instead of scanning every archive up
                front.
              </span>
              <span className="block text-sm text-surface-400">
                Because of how the overlay serves files this can cause sporadic crashes, so it only
                applies when League&apos;s &quot;Automatically Send Crash Reports&quot; setting is
                turned off. With crash reporting on, the patcher just scans up front as usual.
              </span>
            </div>
            <Switch
              checked={settings.lazyWadScan}
              onCheckedChange={(checked) => onSave({ ...settings, lazyWadScan: checked })}
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="WAD Blocklist" icon={<ShieldAlert className="h-5 w-5" />}>
        <WadBlocklistEditor settings={settings} onSave={onSave} />
      </SectionCard>

      <SectionCard title="Troubleshooting" icon={<Wrench className="h-5 w-5" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">Rebuild overlay</span>
              <span className="block text-sm text-surface-400">
                Discards the cached overlay and regenerates it from scratch. Use this if a mod looks
                applied in the manager but isn&apos;t showing in-game, or the game crashes with the
                patcher on. The patcher must be stopped.
              </span>
            </div>
            <Button
              variant="outline"
              loading={isRebuilding}
              disabled={isPatcherRunning}
              left={<RefreshCw className="h-4 w-4" />}
              onClick={handleRebuildOverlay}
            >
              Rebuild
            </Button>
          </div>

          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Verbose patcher logging
              </span>
              <span className="block text-sm text-surface-400">
                Makes the injector and the injected DLL log their internals to the app log file.
                Turn this on only when gathering a log for a bug report, since it is noisy. Takes
                effect the next time the patcher starts.
              </span>
            </div>
            <Switch
              checked={settings.verbosePatcherLogging}
              onCheckedChange={(checked) => onSave({ ...settings, verbosePatcherLogging: checked })}
            />
          </label>
        </div>
      </SectionCard>
    </div>
  );
}
