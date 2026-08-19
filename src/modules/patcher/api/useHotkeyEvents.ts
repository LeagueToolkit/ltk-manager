import { useToast } from "@/components";
import { useTauriEvent } from "@/lib/useTauriEvent";

/**
 * Listen for hotkey-triggered error events from the backend.
 *
 * A hotkey reload restarts the session from the config it was started with, so
 * the reported status carries the projects under test and nothing here has to
 * re-sync them.
 */
export function useHotkeyEvents() {
  const toast = useToast();

  useTauriEvent<string>("hotkey-error", (message) => {
    toast.error("Hotkey Error", message);
  });
}
