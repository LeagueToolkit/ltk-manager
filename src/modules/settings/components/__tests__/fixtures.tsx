import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ToastProvider } from "@/components";
import type { Settings } from "@/lib/tauri";
import { createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { settingsKeys } from "../../api";

/** A fresh install, as `get_default_settings` would report it. */
export function freshSettings(): Settings {
  return createMockSettings({ accentColor: { preset: null, customHue: null } });
}

interface RenderSettingsOptions {
  /** What the app currently holds, over the fresh values. */
  settings?: Partial<Settings>;
  /** What other commands answer, by name. Any other command answers `null`. */
  answers?: Record<string, unknown>;
}

/**
 * Renders a settings component with both tables a gear reads already answered.
 *
 * Without the defaults a row cannot know whether it is off them, so it draws no
 * gear at all - which is right in the app and useless in a test.
 */
export function renderSettings(ui: ReactElement, options?: RenderSettingsOptions) {
  const queryClient = createTestQueryClient();
  const fresh = freshSettings();
  const current = { ...fresh, ...options?.settings };

  queryClient.setQueryData(settingsKeys.defaults(), fresh);
  queryClient.setQueryData(settingsKeys.settings(), current);

  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) => {
    if (command === "get_settings") return Promise.resolve({ ok: true, value: current });
    if (command === "get_default_settings") return Promise.resolve({ ok: true, value: fresh });
    return Promise.resolve({ ok: true, value: options?.answers?.[command] ?? null });
  });

  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    ),
  });
}

/** The settings object one `save_settings` call carried. */
export function savedSettings(nth = 0): Settings {
  const saves = mockInvoke.mock.calls.filter(([command]) => command === "save_settings");
  return saves[nth]?.[1]?.settings as Settings;
}
