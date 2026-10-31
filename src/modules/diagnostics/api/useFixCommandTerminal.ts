import { useCallback } from "react";

import { useToast } from "@/components/Toast";
import { errorSummary, m } from "@/i18n";
import { api, isErr } from "@/lib/tauri";

/**
 * Returns a function that copies a fix command and opens an elevated terminal to paste it in.
 *
 * The command is not run for the reader, so they can review it first. If the clipboard write
 * fails, the terminal still opens and a warning asks for a manual copy.
 */
export function useFixCommandTerminal() {
  const toast = useToast();

  return useCallback(
    async (command: string) => {
      let copied = true;
      try {
        await navigator.clipboard.writeText(command);
      } catch {
        copied = false;
      }

      const result = await api.diagnostics.openElevatedTerminal(copied);
      if (isErr(result)) {
        toast.error(m.diagnostics_fix_terminal_failed_title(), errorSummary(result.error));
        return;
      }

      if (copied) {
        toast.success(
          m.diagnostics_fix_terminal_opened_title(),
          m.diagnostics_fix_terminal_opened_description(),
        );
      } else {
        toast.warning(
          m.diagnostics_fix_terminal_copy_failed_title(),
          m.diagnostics_fix_terminal_copy_failed_description(),
        );
      }
    },
    [toast],
  );
}

/**
 * Returns a function that opens the elevated terminal with the commands that stop League
 * running as administrator.
 *
 * Shows an info toast if no compatibility entry remains, since the setting was then already
 * turned off.
 */
export function useFixLeagueElevated() {
  const toast = useToast();
  const openTerminal = useFixCommandTerminal();

  return useCallback(async () => {
    const result = await api.diagnostics.leagueAdminFixCommand();
    if (isErr(result)) {
      toast.error(m.diagnostics_fix_terminal_failed_title(), errorSummary(result.error));
      return;
    }

    if (result.value === null) {
      toast.info(m.diagnostics_fix_league_admin_clear_title());
      return;
    }

    await openTerminal(result.value);
  }, [openTerminal, toast]);
}
