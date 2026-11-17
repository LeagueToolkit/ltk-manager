import type { ReportOrigin } from "@/lib/tauri";

import { createDialogStore } from "./createDialogStore";

/** What the `Get help` dialog opens with. Every field is optional. */
export interface GetHelpContext {
  /** The incident that the report is about. The dialog uses the newest incident without one. */
  incidentId?: string;
  /** The mod that the report is about. The form starts with it chosen. */
  modId?: string;
  /** The event that led the user to the dialog. */
  origin?: ReportOrigin;
}

/** The `Get help` dialog that the root layout mounts. */
export const useGetHelpDialog = createDialogStore<GetHelpContext>();

/** Opens the `Get help` dialog with `context`. */
export function openGetHelp(context: GetHelpContext = {}): void {
  useGetHelpDialog.getState().open(context);
}
