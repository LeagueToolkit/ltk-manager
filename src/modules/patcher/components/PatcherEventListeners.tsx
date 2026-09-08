import { useHotkeyEvents, usePatcherError, usePatcherStatusListener } from "../api";

/**
 * Mounts the patcher's fire-and-forget event subscriptions.
 */
export function PatcherEventListeners() {
  usePatcherError();
  useHotkeyEvents();
  usePatcherStatusListener();

  return null;
}
