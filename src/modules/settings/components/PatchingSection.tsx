import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import { AlertBox, Button, SectionCard, Switch, useToast } from "@/components";
import { usePlatformSupport } from "@/hooks";
import { api, isErr, type PatcherPreflight, type Settings } from "@/lib/tauri";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";
import { useDetectLeagueRunAsAdmin } from "@/modules/settings/api";

import { WadBlocklistEditor } from "./WadBlocklistEditor";

interface PatchingSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function PatchingSection({ settings, onSave }: PatchingSectionProps) {
  const platform = usePlatformSupport();
  const { data: leagueRunsAsAdmin } = useDetectLeagueRunAsAdmin();
  const { data: patcherStatus } = usePatcherStatus();
  const { mutate: rebuildOverlay, isPending: isRebuilding } = useRebuildOverlay();
  const toast = useToast();
  const [preflight, setPreflight] = useState<PatcherPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const macSupport = platform.data?.os === "macos" ? platform.data : null;

  const isPatcherRunning = patcherStatus?.running ?? false;

  const handleRebuildOverlay = () => {
    rebuildOverlay(undefined, {
      onSuccess: () =>
        toast.success("Overlay rebuilt", "The overlay was regenerated from scratch."),
      onError: (error) => toast.error("Rebuild failed", error.message),
    });
  };

  async function runPreflight() {
    setChecking(true);
    setPreflightError(null);
    const result = await api.preflightPatcher();
    if (isErr(result)) {
      setPreflight(null);
      setPreflightError(result.error.message);
    } else {
      setPreflight(result.value);
    }
    setChecking(false);
  }

  return (
    <div className="space-y-4">
      {macSupport && (
        <SectionCard title="macOS Patcher" icon={<Wrench className="h-5 w-5" />}>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="block text-sm font-medium text-surface-200">
                  {macSupport.patcher.ready ? "Native helper ready" : "Native helper missing"}
                </span>
                <span className="block text-sm text-surface-400">
                  {macSupport.patcher.reason ??
                    "The ARM64 helper is bundled separately from the unprivileged app."}
                </span>
                {macSupport.patcher.helperVersion && (
                  <span className="mt-1 block text-xs text-surface-500">
                    Helper version {macSupport.patcher.helperVersion}
                  </span>
                )}
              </div>
              {macSupport.patcher.ready ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              )}
            </div>

            {!macSupport.patcher.ready && (
              <div className="rounded-md border border-surface-700 bg-surface-950/60 px-3 py-2 font-mono text-xs text-surface-300">
                pnpm macos:helper
              </div>
            )}

            {macSupport.patcher.permissionRequired && (
              <p className="text-xs text-surface-400">
                macOS asks for administrator approval when each patcher session starts. The main LTK
                Manager process remains unprivileged.
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={
                  macSupport.patcher.ready
                    ? runPreflight
                    : () => {
                        void platform.refetch();
                      }
                }
                disabled={macSupport.patcher.ready && !settings.leaguePath}
                loading={checking || platform.isFetching}
                left={
                  checking || platform.isFetching ? undefined : <ScanSearch className="h-4 w-4" />
                }
              >
                {macSupport.patcher.ready ? "Check game compatibility" : "Check helper again"}
              </Button>
              {preflight?.compatible && (
                <span className="text-xs text-green-400">
                  ARM64 signature {preflight.signature ?? "recognized"}
                </span>
              )}
            </div>

            {(preflightError || (preflight && !preflight.compatible)) && (
              <p className="text-xs text-red-400">
                {preflightError ?? preflight?.reason ?? "This League build is not supported."}
              </p>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Patching" icon={<ShieldAlert className="h-5 w-5" />}>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">Patch TFT files</span>
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
                runs as administrator. Leave this off unless mods fail to load — when on, Windows
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
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-300">
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
              <span className="block text-sm font-bold text-amber-400">
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
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-300">
                Anti-skinhack enforcement is off. Mods flagged as skinhacks will be allowed to load.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="WAD Blocklist" icon={<ShieldAlert className="h-5 w-5" />}>
        <WadBlocklistEditor settings={settings} onSave={onSave} />
      </SectionCard>

      <SectionCard title="Troubleshooting" icon={<Wrench className="h-5 w-5" />}>
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
      </SectionCard>
    </div>
  );
}
