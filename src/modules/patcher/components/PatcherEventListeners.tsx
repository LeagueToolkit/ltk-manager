import { useHotkeyEvents, usePatcherError, usePatcherStatusEvents } from "../api";

/**
 * Mounts the patcher's fire-and-forget event subscriptions.
 */
export function PatcherEventListeners() {
  usePatcherError();
  useHotkeyEvents();
  usePatcherStatusEvents();

  return null;
}
