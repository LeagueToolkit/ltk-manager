import { getCurrentWindow } from "@tauri-apps/api/window";

import { useToast } from "@/components";
import type { LinkedBinWarningPayload } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useLinkedBinGuardStore } from "@/stores";

/**
 * Listens for the backend `linked-bins-warning` event — emitted after a patcher
 * start whose single overlay build found enabled mods with unresolved linked
 * dependencies (only when the dependency check is enabled).
 *
 * It surfaces the window (so the nudge is seen even when auto-start fired in tray
 * mode) and shows a one-time, non-blocking toast whose "Review" action opens the
 * reachable `LinkedBinWarningDialog`. The per-mod `MissingDepsBadge`s carry the
 * persistent signal; injection is never blocked.
 */
export function useSurfaceLinkedBinWarning() {
  const toast = useToast();
  const openDialog = useLinkedBinGuardStore((s) => s.openDialog);

  useTauriEvent<LinkedBinWarningPayload>("linked-bins-warning", ({ count }) => {
    const win = getCurrentWindow();
    void win.show();
    void win.setFocus();

    toast.toast({
      type: "warning",
      title:
        count === 1 ? "A mod is missing dependencies" : `${count} mods are missing dependencies`,
      description: "They may glitch or crash the game when loaded.",
      action: { label: "Review", onClick: openDialog },
    });
  });
}
