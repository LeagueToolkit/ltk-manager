import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo } from "react";

import { useFantomeImportDialog, useGitImportDialog } from "../state";
import { useImportFromModpkg } from "./useImportFromModpkg";
import { usePeekFantome } from "./usePeekFantome";

/** The three routes into a project the workshop did not create itself. */
export interface ProjectImports {
  /** Picks an archive, reads what is in it, and opens the dialog over that. */
  readonly fromFantome: () => void;
  /** Picks a package and imports it, which needs nothing else asked. */
  readonly fromModpkg: () => void;
  readonly fromGitRepo: () => void;
  /** A pick is being read, which is the one step with nothing on screen. */
  readonly pending: boolean;
}

/**
 * The imports, apart from whatever runs them.
 *
 * The header's menu and the palette's commands are two ways into the same three
 * flows, so the flows live here rather than in the toolbar one of them is drawn
 * in.
 */
export function useProjectImports(): ProjectImports {
  const openFantomeImportDialog = useFantomeImportDialog((s) => s.open);
  const openGitImportDialog = useGitImportDialog((s) => s.open);

  const importFromModpkg = useImportFromModpkg();
  const peekFantome = usePeekFantome();

  const peek = peekFantome.mutate;
  const importModpkg = importFromModpkg.mutate;
  const pending = importFromModpkg.isPending || peekFantome.isPending;

  const fromFantome = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "Fantome Archive", extensions: ["fantome", "zip"] }],
    });
    if (!file) return;

    peek(file, {
      onSuccess: (peekResult) => openFantomeImportDialog({ peekResult, filePath: file }),
      onError: (err) => console.error("Failed to peek fantome:", err),
    });
  }, [openFantomeImportDialog, peek]);

  const fromModpkg = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "Mod Package", extensions: ["modpkg"] }],
    });
    if (!file) return;

    importModpkg(file, {
      onError: (err) => console.error("Failed to import modpkg:", err),
    });
  }, [importModpkg]);

  return useMemo(
    () => ({
      fromFantome: () => void fromFantome(),
      fromModpkg: () => void fromModpkg(),
      fromGitRepo: openGitImportDialog,
      pending,
    }),
    [fromFantome, fromModpkg, openGitImportDialog, pending],
  );
}
