import { useCallback, useState } from "react";

import type { WadScanFailedPayload } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

/**
 * Listens for the backend `patcher-wad-scan-failed` event, emitted when the
 * injected DLL's integrity scan rejects a modded archive (a skinhack, a corrupt
 * WAD, or out of memory) and auto-stops the patcher. Exposes the failure so the
 * UI can explain why no mods were applied. (Missing linked bins are non-fatal and
 * surfaced via the mod-card badges, not here.)
 */
export function useWadScanFailure() {
  const [failure, setFailure] = useState<WadScanFailedPayload | null>(null);

  useTauriEvent<WadScanFailedPayload>("patcher-wad-scan-failed", (payload) => {
    setFailure(payload);
  });

  const clear = useCallback(() => setFailure(null), []);

  return { failure, clear };
}
