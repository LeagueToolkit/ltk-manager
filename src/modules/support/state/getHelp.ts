import { createDialogStore } from "@/stores/createDialogStore";

/** The `Get help` dialog, which carries nothing when it opens. */
export const useGetHelpDialog = createDialogStore();

/** Opens the `Get help` dialog. */
export function openGetHelp(): void {
  useGetHelpDialog.getState().open();
}
