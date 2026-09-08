import { ProhibitIcon } from "@phosphor-icons/react";

import { Button, Tooltip, useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { usePatcherStatus } from "@/modules/patcher";
import { m } from "@/paraglide/messages";

import { useInstalledMods } from "../api/queries";
import { useToggleMod } from "../api/useToggleMod";

/**
 * Turn off the mod a diagnostics suspect names.
 *
 * Draws nothing for a suspect the library no longer holds, which is how an
 * uninstalled mod keeps its row under a display name and offers no action.
 */
export function SuspectModAction({ modId }: { modId: string }) {
  const { data: mods } = useInstalledMods();
  const { data: patcherStatus } = usePatcherStatus();
  const toggleMod = useToggleMod();
  const toast = useToast();

  const mod = mods?.find((candidate) => candidate.id === modId);
  if (!mod) return null;

  if (!mod.enabled) {
    return (
      <Button variant="ghost" size="xs" disabled>
        {m.diagnostics_suspect_disabled_label()}
      </Button>
    );
  }

  const patcherRunning = patcherStatus?.running ?? false;
  const button = (
    <Button
      variant="outline"
      size="xs"
      disabled={patcherRunning}
      loading={toggleMod.isPending}
      left={<ProhibitIcon weight="bold" className="h-3.5 w-3.5" />}
      onClick={() =>
        toggleMod.mutate(
          { modId, enabled: false },
          {
            onSuccess: () =>
              toast.warning(
                m.diagnostics_mod_disabled_title(),
                m.diagnostics_mod_disabled_description({ name: mod.displayName }),
              ),
            onError: (error) =>
              toast.error(m.diagnostics_mod_disable_failed_title(), errorSummary(error)),
          },
        )
      }
    >
      {m.diagnostics_suspect_disable_action()}
    </Button>
  );

  if (!patcherRunning) return button;
  return (
    <Tooltip content={m.diagnostics_patcher_busy_hint()}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
}
