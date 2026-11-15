import { ProhibitIcon } from "@phosphor-icons/react";

import { Button, useToast } from "@/components";
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
  const toggleMod = useToggleMod();
  const toast = useToast();

  const mod = mods?.find((candidate) => candidate.id === modId);
  if (!mod) return null;

  if (!mod.enabled) {
    return (
      <Button variant="ghost" size="sm" disabled>
        {m.diagnostics_suspect_disabled_label()}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={toggleMod.isPending}
      left={<ProhibitIcon weight="bold" className="size-3.5" />}
      onClick={() =>
        toggleMod.mutate(
          { modId, enabled: false },
          {
            onSuccess: () =>
              toast.warning(
                m.diagnostics_mod_disabled_title(),
                m.diagnostics_mod_disabled_description({ name: mod.displayName }),
              ),
            onError: (error) => toast.failure(m.diagnostics_mod_disable_failed_title(), error),
          },
        )
      }
    >
      {m.diagnostics_suspect_disable_action()}
    </Button>
  );
}
