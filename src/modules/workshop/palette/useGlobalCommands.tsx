import {
  ArrowsClockwiseIcon,
  FileZipIcon,
  GearSixIcon,
  GitBranchIcon,
  PackageIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { useProjectImports } from "../api/useProjectImports";
import { useRefreshGameIndex } from "../gameBrowser";
import { useNewProjectDialog } from "../state";
import type { ProjectCommand } from "./types";

const GLYPH = "h-4 w-4";

/**
 * The actions that need no project, so the bar can run them from either surface.
 *
 * A project's bar folds these into its own list, which is why the palette reads
 * the same in an editor as it does over the grid. The four that make a project
 * are here rather than beside the grid for the same reason: making one from
 * inside another is the same action, and the shell mounts their dialogs.
 */
export function useGlobalCommands(): readonly ProjectCommand[] {
  const navigate = useNavigate();
  const refreshGameIndex = useRefreshGameIndex();
  const imports = useProjectImports();
  const openNewProjectDialog = useNewProjectDialog((s) => s.open);

  const refresh = refreshGameIndex.mutate;

  return useMemo<readonly ProjectCommand[]>(
    () => [
      {
        id: "workshop.newProject",
        title: "New project",
        group: "Workshop",
        shortcut: "Ctrl+N",
        keywords: ["create", "add", "blank"],
        icon: <PlusIcon weight="bold" className={GLYPH} />,
        run: openNewProjectDialog,
      },
      {
        id: "workshop.importFantome",
        title: "Import from Fantome",
        group: "Workshop",
        keywords: ["archive", "zip", "open"],
        icon: <FileZipIcon weight="bold" className={GLYPH} />,
        run: imports.fromFantome,
      },
      {
        id: "workshop.importModpkg",
        title: "Import from Modpkg",
        group: "Workshop",
        keywords: ["package", "open"],
        icon: <PackageIcon weight="bold" className={GLYPH} />,
        run: imports.fromModpkg,
      },
      {
        id: "workshop.importGitRepo",
        title: "Import from a Git repository",
        group: "Workshop",
        keywords: ["clone", "github", "url"],
        icon: <GitBranchIcon weight="bold" className={GLYPH} />,
        run: imports.fromGitRepo,
      },
      {
        id: "game.rebuildIndex",
        title: "Rebuild the game index",
        group: "Game",
        keywords: ["rescan", "refresh", "wad"],
        icon: <ArrowsClockwiseIcon className={GLYPH} />,
        run: () => refresh(),
      },
      {
        id: "settings.open",
        title: "Open settings",
        group: "Settings",
        shortcut: "Ctrl+,",
        keywords: ["preferences", "options"],
        icon: <GearSixIcon className={GLYPH} />,
        run: () => void navigate({ to: "/settings" }),
      },
    ],
    [imports, navigate, openNewProjectDialog, refresh],
  );
}
