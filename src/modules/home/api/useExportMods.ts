import { useMutation } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import {
  api,
  type AppError,
  type ExportProgress,
  type ExportScope,
  type ExportShape,
  type ExportSummary,
  revealPath,
} from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { mutationFn } from "@/utils/query";

interface ExportRequest {
  scope: ExportScope;
  shape: ExportShape;
  destination: string;
}

export interface ModExport {
  /** `false` when the picker was dismissed, so the caller can stay put. */
  start: (scope: ExportScope, shape: ExportShape) => Promise<boolean>;
  /** The mod being written, or `null` between runs. */
  progress: ExportProgress | null;
  running: boolean;
}

/**
 * Write the library out to a folder or a zip the user picks.
 *
 * The result is a toast rather than anything on the page: the run outlives the
 * surface that asked for it, per "Export" in docs/ux/HOME.md.
 */
export function useExportMods(): ModExport {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const toast = useToast();

  useTauriEvent<ExportProgress>("export-progress", setProgress);

  const exportMods = useMutation<ExportSummary, AppError, ExportRequest>({
    meta: { silentError: true },
    mutationFn: mutationFn(({ scope, shape, destination }) =>
      api.exportMods(scope, shape, destination),
    ),
    onSuccess: (summary) => announce(summary),
    onError: (e) => toast.error(m.home_library_export_failed_title(), errorSummary(e)),
    onSettled: () => setProgress(null),
  });

  function announce(summary: ExportSummary) {
    const skipped = summary.skipped.length;
    toast.toast({
      type: skipped > 0 ? "warning" : "success",
      title:
        skipped > 0
          ? m.home_library_export_partial_title({
              exported: summary.exported,
              total: summary.exported + skipped,
            })
          : m.home_library_export_done_title({ count: summary.exported }),
      description:
        skipped > 0 ? m.home_library_export_skipped_hint({ count: skipped }) : summary.destination,
      /* Longer than a plain success: the destination is worth reaching for. */
      timeout: 8000,
      action: {
        label: m.home_library_export_reveal_action(),
        onClick: () => revealPath(summary.destination),
      },
    });
  }

  async function start(scope: ExportScope, shape: ExportShape) {
    const destination =
      shape === "zip"
        ? await save({
            title: m.home_library_export_zip_title(),
            defaultPath: "ltk-mods.zip",
            filters: [{ name: "Zip", extensions: ["zip"] }],
          })
        : await open({ directory: true, title: m.home_library_export_folder_title() });

    /* Dismissed, which is not a failure and gets no toast. */
    if (destination === null) return false;

    exportMods.mutate({ scope, shape, destination });
    return true;
  }

  return { start, progress, running: exportMods.isPending };
}
