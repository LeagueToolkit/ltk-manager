import { ChevronDown, PackageCheck, PackageX, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { AlertBox, Button, Checkbox, Dialog, Spinner, Tooltip, useToast } from "@/components";
import type { LinkedBinOffenderInfo } from "@/lib/tauri";
import { useInstalledMods, useLinkedBinOffenders, useToggleMod } from "@/modules/library";
import { useLinkedBinGuardStore } from "@/stores";

import { usePatcherStatus } from "../api/usePatcherStatus";

/**
 * Reachable review dialog for mods whose property-bins reference linked dependencies
 * that didn't resolve in the most recent overlay build. Opened from a mod card's
 * `MissingDepsBadge` or the post-start warning toast, never as a pre-patch gate
 * (missing linked bins are non-fatal at injection). Lets the user disable the
 * offending mod(s). If the patcher is running, the change applies on the next reload.
 * Mounted globally.
 */
export function LinkedBinWarningDialog() {
  const open = useLinkedBinGuardStore((s) => s.open);
  const close = useLinkedBinGuardStore((s) => s.close);

  // Mount the content (and its queries/mutations) only while open.
  if (!open) return null;

  return <LinkedBinWarningContent onClose={close} />;
}

function LinkedBinWarningContent({ onClose }: { onClose: () => void }) {
  const { data: offenderMap, isLoading } = useLinkedBinOffenders();
  const { data: mods = [] } = useInstalledMods();
  const { data: patcherStatus } = usePatcherStatus();
  const toggleMod = useToggleMod();
  const toast = useToast();

  const offenders = Object.values(offenderMap ?? {}).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(offenders.map((o) => o.modId)),
  );
  // Detail is collapsed by default. Auto-open the list when there's only one mod.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    offenders.length === 1 ? new Set([offenders[0].modId]) : new Set(),
  );
  const [busy, setBusy] = useState(false);

  const selectedCount = selected.size;
  const isMulti = offenders.length > 1;
  const allSelected = offenders.length > 0 && selectedCount === offenders.length;
  const patcherRunning = patcherStatus?.running ?? false;

  const displayNameFor = (offender: LinkedBinOffenderInfo) =>
    mods.find((m) => m.id === offender.modId)?.displayName ?? offender.displayName;

  const toggleSelected = (modId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });

  const toggleExpanded = (modId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });

  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(offenders.map((o) => o.modId))));

  const handleDisable = async () => {
    setBusy(true);
    try {
      for (const offender of offenders) {
        if (selected.has(offender.modId)) {
          await toggleMod.mutateAsync({ modId: offender.modId, enabled: false });
        }
      }
      toast.warning(
        selectedCount === 1 ? "Mod disabled" : "Mods disabled",
        patcherRunning
          ? `${selectedCount} mod${selectedCount === 1 ? "" : "s"} disabled. Reload the patcher to apply.`
          : `${selectedCount} mod${selectedCount === 1 ? "" : "s"} with missing dependencies won't be loaded.`,
      );
      onClose();
    } catch {
      setBusy(false);
      toast.error("Couldn't disable mods", "Try again from the mod's menu.");
    }
  };

  if (!isLoading && offenders.length === 0) {
    return (
      <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Overlay size="sm">
            <Dialog.Header>
              <Dialog.Title className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success-text">
                  <PackageCheck className="h-4 w-4" />
                </span>
                No missing dependencies
              </Dialog.Title>
              <Dialog.Close />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-sm leading-relaxed text-surface-300">
                None of your enabled mods reference missing game files.
              </p>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="filled" onClick={onClose}>
                Close
              </Button>
            </Dialog.Footer>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const title = isMulti ? "Some mods are missing dependencies" : "A mod is missing dependencies";
  const sectionLabel = isMulti ? `Flagged mods (${offenders.length})` : "Flagged mod";
  const primaryLabel = selectedCount <= 1 ? "Disable" : `Disable ${selectedCount}`;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-text">
                <PackageX className="h-4 w-4" />
              </span>
              {title}
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body className="flex flex-col gap-5">
            <p className="text-sm leading-relaxed text-surface-300">
              These enabled mods reference game files that aren&apos;t installed. League may glitch
              or crash when it loads them.
            </p>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-surface-400">
                <Spinner size="sm" />
                Loading flagged mods…
              </div>
            )}

            {!isLoading && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-wide text-surface-400 uppercase">
                    {sectionLabel}
                  </span>
                  {isMulti && (
                    <Button
                      variant="transparent"
                      size="xs"
                      compact
                      className="text-accent-400 hover:text-accent-300"
                      onClick={toggleAll}
                    >
                      {allSelected ? "Deselect all" : "Select all"}
                    </Button>
                  )}
                </div>

                <div className="overflow-hidden rounded-lg border border-surface-700 bg-surface-900/60">
                  <div className="max-h-72 divide-y divide-surface-800 overflow-y-auto">
                    {offenders.map((offender) => {
                      const checked = selected.has(offender.modId);
                      const isOpen = expanded.has(offender.modId);
                      const count = offender.missingLinks.length;
                      return (
                        <div key={offender.modId}>
                          <div className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-800/40">
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                              <Checkbox
                                size="sm"
                                checked={checked}
                                onCheckedChange={() => toggleSelected(offender.modId)}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-surface-100">
                                {displayNameFor(offender)}
                              </span>
                            </label>
                            <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-text tabular-nums">
                              {count} missing
                            </span>
                            {count > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(offender.modId)}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? "Hide missing files" : "Show missing files"}
                                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
                              >
                                <ChevronDown
                                  className={twMerge(
                                    "h-4 w-4 transition-transform duration-150",
                                    isOpen && "rotate-180",
                                  )}
                                />
                              </button>
                            )}
                          </div>
                          {isOpen && count > 0 && (
                            <ul className="flex flex-col divide-y divide-surface-800/70 border-t border-surface-800 bg-surface-950/40">
                              {offender.missingLinks.map((link) => (
                                <Tooltip
                                  key={link}
                                  side="top"
                                  align="start"
                                  content={
                                    <span className="block max-w-sm font-mono text-xs break-all">
                                      {link}
                                    </span>
                                  }
                                >
                                  <li className="truncate py-1 pr-3 pl-9 font-mono text-xs leading-5 text-surface-400 transition-colors hover:bg-surface-800/40 hover:text-surface-200">
                                    {link}
                                  </li>
                                </Tooltip>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <AlertBox
              variant="warning"
              icon={<ShieldAlert className="h-5 w-5" />}
              title={
                patcherRunning
                  ? "Disabling takes effect after you reload the patcher."
                  : "Leaving these enabled may glitch or crash the game when they load."
              }
            />
          </Dialog.Body>

          <Dialog.Footer className="justify-end">
            <Button variant="ghost" className="text-surface-400" disabled={busy} onClick={onClose}>
              Dismiss
            </Button>
            <Button
              variant="filled"
              loading={busy}
              disabled={selectedCount === 0}
              onClick={handleDisable}
            >
              {primaryLabel}
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
