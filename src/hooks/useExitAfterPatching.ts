import { exit } from "@tauri-apps/plugin-process";

import { useTauriEvent } from "@/lib/useTauriEvent";
import { useSettings } from "@/modules/settings";

export function useExitAfterPatching() {
  const { data: settings } = useSettings();

  useTauriEvent<void>(settings?.exitAfterPatching ? "patcher-injected" : null, () => {
    void exit(0);
  });
}
