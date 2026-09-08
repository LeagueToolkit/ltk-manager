import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line no-restricted-imports -- the route validates search before the module loads
import { isSettingsTab, type SettingsTab } from "@/modules/settings/tabs";

import { Settings } from "../pages/Settings";

interface SettingsSearch {
  firstRun?: boolean;
  /** Optional, so the links that mean the whole page keep pointing at `/settings` alone. */
  tab?: SettingsTab;
  /**
   * A public setting id, or a group id, to point at.
   *
   * A string rather than a union, because the ids it addresses live in the settings
   * module rather than in the route. Both spellings are namespaced by tab, so an
   * unknown one still opens the right tab and marks nothing - the right failure for
   * a link that outlived the setting it named.
   */
  focus?: string;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => {
    return {
      firstRun: search.firstRun === true || search.firstRun === "true",
      tab: isSettingsTab(search.tab) ? search.tab : undefined,
      focus: typeof search.focus === "string" ? search.focus : undefined,
    };
  },
  component: Settings,
});
