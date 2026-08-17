import {
  AlertTriangle,
  Copy,
  type LucideIcon,
  Package,
  PackageX,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import { AlertBox, Button, Dialog, Spinner, useToast } from "@/components";
import type { WadScanFailedPayload } from "@/lib/tauri";

import { usePatcherStatus } from "../api/usePatcherStatus";
import { useStopPatcher } from "../api/useStopPatcher";
import { useWadScanFailure } from "../api/useWadScanFailure";
import { useWadScanOffenders } from "../api/useWadScanOffenders";

type FailureKind = "skinhack" | "missingBin" | "corrupt" | "outOfMemory" | "unknown";

/** Map an NTSTATUS-style code (e.g. `c0000225`) to a failure kind. */
function classifyStatus(status: string): FailureKind {
  const code = status.trim().toLowerCase().replace(/^0x/, "");
  if (code === "c0000229") return "skinhack";
  if (code === "c0000225") return "missingBin";
  if (code === "c000003e") return "corrupt";
  if (code === "c0000017" || code === "c000009a") return "outOfMemory";
  return "unknown";
}

/**
 * Choose which failure kind drives the dialog's copy. A skinhack is the most
 * serious and always wins. A uniform burst uses its single kind, and a mix of
 * different non-skinhack causes falls back to the generic copy so we never show
 * one cause's fix for a different cause's failure.
 */
function pickPrimaryKind(kinds: FailureKind[]): FailureKind {
  const uniqueKinds = [...new Set(kinds)];
  if (uniqueKinds.includes("skinhack")) return "skinhack";
  if (uniqueKinds.length === 1) return uniqueKinds[0] ?? "unknown";
  return "unknown";
}

interface KindConfig {
  title: string;
  icon: LucideIcon;
  tone: "red" | "amber";
  lead: string;
  fix: string;
}

const KIND_CONFIG: Record<FailureKind, KindConfig> = {
  skinhack: {
    title: "Skinhack detected",
    icon: ShieldAlert,
    tone: "red",
    lead: "The patcher's safety scan found a skinhack (an official Riot skin ported onto a base champion) among your enabled mods. To avoid crashing your game, the patcher was stopped and no mods were applied this session.",
    fix: "Remove or disable the offending mod(s), then start the patcher again.",
  },
  missingBin: {
    title: "A mod is incomplete",
    icon: PackageX,
    tone: "amber",
    lead: "The scan couldn't find a linked .bin file that a mod needs, so no mods were applied this session. This usually means the mod is broken or was built for a different game version.",
    fix: "Re-import or update the offending mod(s), then start the patcher again.",
  },
  corrupt: {
    title: "A mod file is corrupt",
    icon: PackageX,
    tone: "amber",
    lead: "A modded WAD couldn't be read (it's corrupt or built for an unsupported version), so no mods were applied this session.",
    fix: "Re-import the offending mod(s), then start the patcher again.",
  },
  outOfMemory: {
    title: "Ran out of memory",
    icon: AlertTriangle,
    tone: "amber",
    lead: "The game ran out of memory while loading mods, so no mods were applied this session.",
    fix: "Close other programs or reduce the number of enabled mods, then try again.",
  },
  unknown: {
    title: "Mods could not be applied",
    icon: AlertTriangle,
    tone: "amber",
    lead: "A modded file failed the game's integrity scan, so no mods were applied this session.",
    fix: "Remove or re-import the offending mod(s), then start the patcher again.",
  },
};

const TONE = {
  red: {
    badge: "bg-danger/15 text-danger-text",
    wad: "bg-danger/10 text-danger-text",
    close: "text-danger-text hover:bg-danger/15 hover:text-danger-text",
  },
  amber: {
    badge: "bg-warning/15 text-warning-text",
    wad: "bg-warning/10 text-warning-text",
    close: "text-warning-text hover:bg-warning/15 hover:text-warning-text",
  },
};

/** Strip the WAD extension for a readable label, so `Ahri.wad.client` → `Ahri`. */
function wadLabel(wad: string): string {
  return wad.replace(/\.wad(\.client|\.server)?$/i, "");
}

/**
 * Surfaces the `patcher-wad-scan-failed` event as a blocking dialog. The
 * integrity scan rejected a modded archive (a skinhack, a corrupt WAD, or out of
 * memory), so the DLL refused to load any mods and the patcher was auto-stopped.
 * The body pins the failure to the offending library mod(s) so the user knows
 * exactly what to fix. (Missing linked bins are non-fatal at injection and are
 * surfaced separately via the mod-card badges and `LinkedBinWarningDialog`, so the
 * `missingBin` kind here is a defensive fallback.)
 */
export function WadScanFailedDialog() {
  const { failure, clear } = useWadScanFailure();

  // Render the content (and its mod/report queries) only while a failure is
  // active, so the dialog stays inert when idle.
  if (!failure) return null;

  return <WadScanFailedContent failure={failure} onClose={clear} />;
}

function WadScanFailedContent({
  failure,
  onClose,
}: {
  failure: WadScanFailedPayload;
  onClose: () => void;
}) {
  const { data: patcherStatus } = usePatcherStatus();
  const stopPatcher = useStopPatcher();
  const toast = useToast();
  const { offenders, unmatchedWads, isLoading } = useWadScanOffenders(failure.failures);

  const kinds = failure.failures.map((f) => classifyStatus(f.status));
  const primaryKind = pickPrimaryKind(kinds);
  const config = KIND_CONFIG[primaryKind];
  const tone = TONE[config.tone];
  const Icon = config.icon;

  const offendersHeading =
    offenders.length === 1 ? "Offending mod" : `Offending mods (${offenders.length})`;
  const unmatchedLabel = offenders.length > 0 ? "Also flagged" : "Flagged files";

  const handleStop = () => {
    if (patcherStatus?.running) {
      stopPatcher.mutate(undefined, {
        onError: (error) => {
          // The injector may have already auto-stopped the thread by the time the
          // user clicks. A "not running" rejection here is a no-op, not a failure.
          console.error("Failed to stop patcher:", error.message);
        },
      });
    }
    onClose();
  };

  const handleCopyDetails = () => {
    const lines = [`LTK Manager - ${config.title}`];
    if (offenders.length > 0) {
      lines.push("Offending mods:");
      offenders.forEach((o) => lines.push(`  - ${o.displayName} (${o.wads.join(", ")})`));
    }
    if (unmatchedWads.length > 0) {
      lines.push(`Unmatched files: ${unmatchedWads.join(", ")}`);
    }
    const statuses = [...new Set(failure.failures.map((f) => f.status))];
    lines.push(`Status: ${statuses.join(", ")}`);

    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => toast.success("Copied", "Details copied to clipboard"))
      .catch(() => toast.error("Copy failed", "Could not access the clipboard"));
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header>
            <Dialog.Title className="flex items-center gap-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.badge}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              {config.title}
            </Dialog.Title>
            <Dialog.Close className={tone.close} />
          </Dialog.Header>

          <Dialog.Body className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-surface-300">{config.lead}</p>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-surface-400">
                <Spinner size="sm" />
                Identifying the responsible mods…
              </div>
            )}

            {!isLoading && offenders.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-surface-400 uppercase">
                  {offendersHeading}
                </p>
                <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                  {offenders.map((offender) => (
                    <div
                      key={offender.modId}
                      className="flex items-center justify-between gap-3 rounded-md bg-surface-900 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Package className="h-4 w-4 shrink-0 text-surface-400" />
                        <span className="truncate text-sm font-medium text-surface-100">
                          {offender.displayName}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {offender.wads.map((wad) => (
                          <span
                            key={wad}
                            title={wad}
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone.wad}`}
                          >
                            {wadLabel(wad)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isLoading && unmatchedWads.length > 0 && (
              <p className="text-xs text-surface-500">
                {unmatchedLabel} (no matching enabled mod):{" "}
                <span className="font-mono text-surface-400">{unmatchedWads.join(", ")}</span>
              </p>
            )}

            <AlertBox variant="warning" icon={<Wrench className="h-5 w-5" />} title={config.fix} />
          </Dialog.Body>

          <Dialog.Footer>
            <Button
              variant="ghost"
              className="mr-auto whitespace-nowrap text-surface-400"
              left={<Copy className="h-4 w-4" />}
              onClick={handleCopyDetails}
            >
              Copy details
            </Button>
            <Button
              variant="filled"
              className="whitespace-nowrap"
              loading={stopPatcher.isPending}
              onClick={handleStop}
            >
              Ok, Stop Patcher
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
