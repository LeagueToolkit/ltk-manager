import {
  ArrowsClockwiseIcon,
  FileZipIcon,
  FolderOpenIcon,
  GearSixIcon,
  GitBranchIcon,
  PackageIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { m } from "@/i18n";

import { useOpenFolder } from "../../folders/hooks/useOpenFolder";
import { useRefreshGameIndex } from "../../gameBrowser";
import { useProjectImports } from "../../imports/hooks/useProjectImports";
import { useNewProjectDialog } from "../../state";
import type { ProjectCommand } from "../utils/types";

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
  const openFolder = useOpenFolder();
  const openNewProjectDialog = useNewProjectDialog((s) => s.open);

  const refresh = refreshGameIndex.mutate;

  return useMemo<readonly ProjectCommand[]>(
    () => [
      {
        id: "workshop.newProject",
        title: m.workshop_command_new_project_action(),
        group: m.workshop_nav_label(),
        shortcut: "Ctrl+N",
        keywords: ["create", "add", "blank"],
        icon: <PlusIcon weight="bold" className={GLYPH} />,
        run: openNewProjectDialog,
      },
      {
        id: "workshop.openFolder",
        title: m.workshop_folder_open_action(),
        group: m.workshop_nav_label(),
        shortcut: "Ctrl+O",
        keywords: ["folder", "directory", "recent", "cslol"],
        icon: <FolderOpenIcon weight="bold" className={GLYPH} />,
        run: openFolder.pick,
      },
      {
        id: "workshop.importFantome",
        title: m.workshop_command_import_fantome_action(),
        group: m.workshop_nav_label(),
        keywords: ["archive", "zip", "open"],
        icon: <FileZipIcon weight="bold" className={GLYPH} />,
        run: imports.fromFantome,
      },
      {
        id: "workshop.importModpkg",
        title: m.workshop_command_import_modpkg_action(),
        group: m.workshop_nav_label(),
        keywords: ["package", "open"],
        icon: <PackageIcon weight="bold" className={GLYPH} />,
        run: imports.fromModpkg,
      },
      {
        id: "workshop.importGitRepo",
        title: m.workshop_command_import_git_action(),
        group: m.workshop_nav_label(),
        keywords: ["clone", "github", "url"],
        icon: <GitBranchIcon weight="bold" className={GLYPH} />,
        run: imports.fromGitRepo,
      },
      {
        id: "game.rebuildIndex",
        title: m.workshop_game_rebuild_action(),
        group: m.workshop_game_source_label(),
        keywords: ["rescan", "refresh", "wad"],
        icon: <ArrowsClockwiseIcon className={GLYPH} />,
        run: () => refresh(),
      },
      {
        id: "settings.open",
        title: m.workshop_command_settings_open_action(),
        group: m.workshop_command_settings_group_label(),
        shortcut: "Ctrl+,",
        keywords: ["preferences", "options"],
        icon: <GearSixIcon className={GLYPH} />,
        run: () => void navigate({ to: "/settings" }),
      },
    ],
    [imports, navigate, openFolder.pick, openNewProjectDialog, refresh],
  );
}
