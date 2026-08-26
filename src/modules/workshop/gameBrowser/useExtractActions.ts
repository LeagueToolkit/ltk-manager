import { useCallback, useMemo } from "react";

import type { ExtractTarget } from "@/lib/tauri";
import {
  useExtractDialogStore,
  useExtractRunning,
  useOpenExtractDialog,
  useStartExtract,
} from "@/stores";

import { useProjectContext } from "../components/ProjectContext";
import { layerTitle } from "../documents/contentDocument";
import { useSelectedLayerName } from "../state";

/** Which of the three ways out of the browser a gesture asked for. */
export type ExtractHow = "quick" | "dialog" | "copy";

export interface ExtractActions {
  /** Start the aim, whichever way was asked for. */
  run: (how: ExtractHow, targets: readonly ExtractTarget[], subject: string) => void;
  /**
   * The remembered folder's own name, which labels the quick item. `null`
   * until an extract has been through the dialog once, when there is no folder
   * to go straight to and only the dialog is offered.
   */
  lastFolder: string | null;
  /** What a copy lands in, or `null` when the project holds no layer. */
  layerLabel: string | null;
  /**
   * An extract is in flight, so a second cannot start.
   *
   * What a live control does about that, rather than a guard: the runner turns
   * a request that arrives anyway into the answer that one is already running,
   * which is what a key press has to get.
   */
  busy: boolean;
}

/**
 * The three ways a browser row leaves the browser.
 *
 * **Copy** writes into the project's selected layer, at the path the game
 * reads, which is the design's copy into a layer run through the extractor.
 * **Quick** repeats the last extract's answers into the last folder, and the
 * **dialog** is where those answers are given in the first place.
 *
 * Only usable inside a project, which every game browser tab is.
 */
export function useExtractActions(): ExtractActions {
  const openDialog = useOpenExtractDialog();
  const start = useStartExtract();
  const busy = useExtractRunning();

  const destination = useExtractDialogStore((s) => s.destination);
  const layout = useExtractDialogStore((s) => s.layout);
  const perArchiveFolder = useExtractDialogStore((s) => s.perArchiveFolder);
  const recoverNames = useExtractDialogStore((s) => s.recoverNames);
  const existing = useExtractDialogStore((s) => s.existing);
  const openWhenDone = useExtractDialogStore((s) => s.openWhenDone);

  const project = useProjectContext();
  const layerName = useSelectedLayerName();
  const layerLabel = layerName ? layerTitle(project, layerName) : null;

  const run = useCallback(
    (how: ExtractHow, targets: readonly ExtractTarget[], subject: string) => {
      if (how === "dialog") {
        openDialog(targets, subject);
        return;
      }

      if (how === "copy") {
        if (!layerName || !layerLabel) return;
        start({
          targets,
          subject,
          /* The path the game reads, and never over an edit already made: a
             file already in the layer is the modder's, not the game's. */
          options: {
            destination: `${project.path}/content/${layerName}`,
            layout: "paths",
            perArchiveFolder: true,
            existing: "skip",
            recoverNames,
            kinds: null,
          },
          reveal: false,
          intoLayer: layerLabel,
          projectPath: project.path,
        });
        return;
      }

      /* No folder has been picked yet, so the quick route is the dialog. */
      if (!destination) {
        openDialog(targets, subject);
        return;
      }

      start({
        targets,
        subject,
        options: { destination, layout, perArchiveFolder, existing, recoverNames, kinds: null },
        reveal: openWhenDone,
      });
    },
    [
      openDialog,
      start,
      layerName,
      layerLabel,
      project.path,
      destination,
      layout,
      perArchiveFolder,
      existing,
      recoverNames,
      openWhenDone,
    ],
  );

  return useMemo(
    () => ({ run, lastFolder: folderName(destination), layerLabel, busy }),
    [run, destination, layerLabel, busy],
  );
}

/** The last segment of a path, whichever separator wrote it. */
function folderName(path: string): string | null {
  const parts = path.split("\\").flatMap((part) => part.split("/"));
  return parts.filter(Boolean).at(-1) ?? null;
}
