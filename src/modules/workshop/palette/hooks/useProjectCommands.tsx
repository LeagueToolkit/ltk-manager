import {
  CubeIcon,
  EyeSlashIcon,
  FileArchiveIcon,
  FolderOpenIcon,
  LayoutIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlayIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SealCheckIcon,
  SidebarSimpleIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
  TrashIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { LeagueIcon, PlayerTitleIcon } from "@/components";
import { m } from "@/i18n";
import { useLayerPanelOpen, useSetLayerPanelOpen } from "@/stores";

import { useDeclarationsOn } from "../../bin/documents/hooks/useDeclared";
import {
  detailsDocument,
  gameDocument,
  gameWadsDocument,
  ignoreRulesDocument,
  objectsDocument,
  problemsDocument,
  projectTextDocument,
  referencesDocument,
} from "../../documents";
import { useRevealGameSearch } from "../../gameBrowser";
import { useProjectActions } from "../../projects/hooks/useProjectActions";
import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  useActiveDocumentId,
  useActiveLeafId,
  useLeafLocked,
  useOpenDocument,
  usePinnedDocumentIds,
  useResetLayout,
  useSetDocumentPinned,
  useSetLeafLocked,
  useSetUseDeclarations,
  useSplitWithDocument,
} from "../../state";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { textFileKind } from "../../text-files";
import type { ProjectCommand } from "../utils/types";
import { useGlobalCommands } from "./useGlobalCommands";
import { useGroupCommands } from "./useGroupCommands";

const GLYPH = "h-4 w-4";

/**
 * Every action the bar can run under a project, composed out of the modules'
 * own hooks.
 *
 * A command closes over the real mutation rather than over a copy of it, so
 * nothing registers into a global table at import time and a command that needs
 * project state reads it the way every other panel does. The ones that need no
 * project come from [`useGlobalCommands`], folded in where they used to sit.
 */
export function useProjectCommands(): readonly ProjectCommand[] {
  const project = useProjectContext();

  const actions = useProjectActions(project);
  const testState = useWorkshopTestState(project);
  const global = useGlobalCommands();
  const group = useGroupCommands();

  const openDocument = useOpenDocument();
  const resetLayout = useResetLayout();
  const splitWithDocument = useSplitWithDocument();
  const activeDocumentId = useActiveDocumentId();
  const activeLeafId = useActiveLeafId();
  const activeLeafLocked = useLeafLocked(activeLeafId);
  const setLeafLocked = useSetLeafLocked();
  const pinnedIds = usePinnedDocumentIds();
  const setDocumentPinned = useSetDocumentPinned();
  const activeDocumentPinned = activeDocumentId !== null && pinnedIds.includes(activeDocumentId);

  const layerPanelOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();
  const revealGameSearch = useRevealGameSearch();

  const declarationsOn = useDeclarationsOn(project.path) === true;
  const setUseDeclarations = useSetUseDeclarations();

  const layerCount = project.layers.length;

  return useMemo<readonly ProjectCommand[]>(() => {
    const testable = testState.kind === "idle";

    return [
      {
        id: "project.test",
        title: "Test the project",
        group: "Project",
        keywords: ["run", "patch", "launch"],
        icon: <PlayIcon weight="bold" className={GLYPH} />,
        enabled: testable && layerCount > 0,
        disabledReason: layerCount === 0 ? "No layers" : "The patcher is busy",
        run: actions.handleTestProject,
      },
      {
        id: "project.pack",
        title: "Pack the project",
        group: "Project",
        keywords: ["export", "build", "modpkg", "fantome"],
        icon: <PackageIcon weight="bold" className={GLYPH} />,
        enabled: layerCount > 0,
        disabledReason: "No layers",
        run: actions.handleOpenPackDialog,
      },
      {
        id: "project.reveal",
        title: "Open the project folder",
        group: "Project",
        keywords: ["explorer", "reveal", "directory"],
        icon: <FolderOpenIcon className={GLYPH} />,
        run: actions.handleOpenLocation,
      },
      {
        id: "project.useDeclarations",
        title: declarationsOn
          ? m.workshop_bin_declarations_stop_action()
          : m.workshop_bin_declarations_toggle_label(),
        group: "Project",
        keywords: ["game data", "declare", "game_data.yaml", "read-only"],
        icon: <SealCheckIcon className={GLYPH} />,
        run: () => setUseDeclarations(!declarationsOn),
      },
      {
        id: "project.delete",
        title: "Delete the project",
        group: "Project",
        keywords: ["remove"],
        icon: <TrashIcon className={GLYPH} />,
        run: actions.handleOpenDeleteDialog,
      },

      {
        id: "go.details",
        title: "Open mod details",
        group: "Go to",
        keywords: ["metadata", "authors", "version", "thumbnail"],
        icon: <PlayerTitleIcon className={GLYPH} />,
        run: () => openDocument(detailsDocument()),
      },
      {
        id: "go.game",
        title: "Open the game index",
        group: "Go to",
        keywords: ["browse", "install", "assets"],
        icon: <LeagueIcon className={GLYPH} />,
        run: () => openDocument(gameDocument()),
      },
      {
        id: "go.gameWads",
        title: "Open the game WADs",
        group: "Go to",
        keywords: ["archives", "browse"],
        icon: <FileArchiveIcon className={GLYPH} />,
        run: () => openDocument(gameWadsDocument()),
      },
      {
        id: "go.objects",
        title: "Open the objects browser",
        group: "Go to",
        keywords: ["bin", "browse", "install", "index"],
        icon: <CubeIcon className={GLYPH} />,
        run: () => openDocument(objectsDocument()),
      },
      {
        id: "go.problems",
        title: "Open the problems list",
        group: "Go to",
        keywords: ["check", "findings", "errors", "warnings"],
        icon: <WarningDiamondIcon className={GLYPH} />,
        run: () => openDocument(problemsDocument()),
      },
      {
        id: "go.readme",
        title: "Open the readme",
        group: "Go to",
        keywords: ["description", "markdown", "text"],
        icon: textFileKind("readme").icon(GLYPH),
        run: () => openDocument(projectTextDocument("readme")),
      },
      {
        id: "go.license",
        title: "Open the license",
        group: "Go to",
        keywords: ["terms", "rights", "text"],
        icon: textFileKind("license").icon(GLYPH),
        run: () => openDocument(projectTextDocument("license")),
      },
      {
        id: "go.ignoreRules",
        title: "Open the ignore rules",
        group: "Go to",
        keywords: ["modignore", "exclude", "skip", "pack"],
        icon: <EyeSlashIcon className={GLYPH} />,
        run: () => openDocument(ignoreRulesDocument()),
      },
      {
        id: "go.references",
        title: "Open the references",
        group: "Go to",
        keywords: ["usages", "links", "objects"],
        icon: <MagnifyingGlassIcon className={GLYPH} />,
        run: () => openDocument(referencesDocument()),
      },

      {
        id: "view.splitRight",
        title: "Split right",
        group: "View",
        keywords: ["group", "pane", "side"],
        icon: <SquareSplitHorizontalIcon className={GLYPH} />,
        enabled: activeDocumentId !== null,
        disabledReason: "Nothing open",
        run: () => {
          if (activeDocumentId) splitWithDocument(activeDocumentId, activeLeafId, "right");
        },
      },
      {
        id: "view.splitDown",
        title: "Split down",
        group: "View",
        keywords: ["group", "pane", "below", "bottom"],
        icon: <SquareSplitVerticalIcon className={GLYPH} />,
        enabled: activeDocumentId !== null,
        disabledReason: "Nothing open",
        run: () => {
          if (activeDocumentId) splitWithDocument(activeDocumentId, activeLeafId, "bottom");
        },
      },
      {
        id: "view.pinTab",
        title: activeDocumentPinned ? "Unpin the tab" : "Pin the tab",
        group: "View",
        keywords: ["stick", "keep", "front", "strip"],
        icon: activeDocumentPinned ? (
          <PushPinSlashIcon className={GLYPH} />
        ) : (
          <PushPinIcon className={GLYPH} />
        ),
        enabled: activeDocumentId !== null,
        disabledReason: "Nothing open",
        run: () => {
          if (activeDocumentId) setDocumentPinned(activeDocumentId, !activeDocumentPinned);
        },
      },
      {
        id: "view.lockGroup",
        title: activeLeafLocked ? "Unlock the group" : "Lock the group",
        group: "View",
        keywords: ["pin", "freeze", "pane", "tabs"],
        icon: activeLeafLocked ? (
          <LockSimpleOpenIcon className={GLYPH} />
        ) : (
          <LockSimpleIcon className={GLYPH} />
        ),
        run: () => setLeafLocked(activeLeafId, !activeLeafLocked),
      },
      {
        id: "view.resetLayout",
        title: "Reset the layout",
        group: "View",
        keywords: ["merge", "groups", "panes"],
        icon: <LayoutIcon className={GLYPH} />,
        run: resetLayout,
      },
      ...group,
      {
        id: "view.toggleSidebar",
        title: layerPanelOpen ? "Hide the side panel" : "Show the side panel",
        group: "View",
        keywords: ["sidebar", "panel"],
        icon: <SidebarSimpleIcon weight="bold" className={GLYPH} />,
        run: () => setLayerPanelOpen(!layerPanelOpen),
      },

      {
        id: "game.find",
        title: "Search the game files",
        group: "Game",
        shortcut: "Ctrl+Shift+F",
        keywords: ["find", "grep", "regex", "wad"],
        icon: <MagnifyingGlassIcon weight="bold" className={GLYPH} />,
        run: revealGameSearch,
      },
      ...global,
    ];
  }, [
    actions,
    activeDocumentId,
    activeDocumentPinned,
    activeLeafId,
    activeLeafLocked,
    global,
    group,
    declarationsOn,
    layerCount,
    layerPanelOpen,
    openDocument,
    resetLayout,
    revealGameSearch,
    setDocumentPinned,
    setLayerPanelOpen,
    setLeafLocked,
    setUseDeclarations,
    splitWithDocument,
    testState.kind,
  ]);
}
