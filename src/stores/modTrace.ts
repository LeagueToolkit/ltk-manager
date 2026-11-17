import type { TraceSubject } from "@/lib/tauri";

import { createDialogStore } from "./createDialogStore";

/** The mod or the project that the trace panel opens for. */
export interface ModTraceTarget {
  subject: TraceSubject;
  /** The name that the panel shows as its title. */
  name: string;
}

/** The mod trace panel that the root layout mounts. */
export const useModTraceDialog = createDialogStore<ModTraceTarget>();

/** Opens the mod trace panel for `target`. */
export function openModTrace(target: ModTraceTarget): void {
  useModTraceDialog.getState().open(target);
}
