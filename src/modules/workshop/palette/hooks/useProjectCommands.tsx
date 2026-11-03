import {
  AppWindowIcon,
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
import { useOfferedCommands } from "@/modules/editor";
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

const GLYPH = "size-4";

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
  const offered = useOfferedCommands(activeDocumentId);

  const layerPanelOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();
  const revealGameSearch = useRevealGameSearch();

  const declarationsOn = useDeclarationsOn(project.path) === true;
  const setUseDeclarations = useSetUseDeclarations();

  const layerCount = project.layers.length;

  return useMemo<readonly ProjectCommand[]>(() => {
    const testable = testState.kind === "idle";

    return [
      ...offered,
      {
        id: "project.test",
        title: m.workshop_palette_test_the_project(),
        group: m.workshop_palette_project(),
        keywords: ["run", "patch", "launch"],
        icon: <PlayIcon weight="bold" className={GLYPH} />,
        enabled: testable && layerCount > 0,
        disabledReason:
          layerCount === 0
            ? m.workshop_palette_no_layers()
            : m.workshop_palette_the_patcher_is_busy(),
        run: actions.handleTestProject,
      },
      {
        id: "project.testOverProfile",
        title: m.workshop_test_over_profile_action(),
        group: m.workshop_palette_project(),
        keywords: ["run", "patch", "profile"],
        icon: <PlayIcon weight="bold" className={GLYPH} />,
        enabled: testable && layerCount > 0,
        disabledReason:
          layerCount === 0
            ? m.workshop_palette_no_layers()
            : m.workshop_palette_the_patcher_is_busy(),
        run: actions.handleTestOverProfile,
      },
      {
        id: "project.pack",
        title: m.workshop_palette_pack_the_project(),
        group: m.workshop_palette_project(),
        keywords: ["export", "build", "modpkg", "fantome"],
        icon: <PackageIcon weight="bold" className={GLYPH} />,
        enabled: layerCount > 0 && !actions.isPacking,
        disabledReason: actions.isPacking
          ? m.workshop_palette_already_packing()
          : m.workshop_palette_no_layers(),
        run: actions.handlePack,
      },
      {
        id: "project.reveal",
        title: m.workshop_palette_open_the_project_folder(),
        group: m.workshop_palette_project(),
        keywords: ["explorer", "reveal", "directory"],
        icon: <FolderOpenIcon className={GLYPH} />,
        run: actions.handleOpenLocation,
      },
      {
        id: "project.useDeclarations",
        title: declarationsOn
          ? m.workshop_bin_declarations_stop_action()
          : m.workshop_bin_declarations_toggle_label(),
        group: m.workshop_palette_project(),
        keywords: ["game data", "declare", "game_data.yaml", "read-only"],
        icon: <SealCheckIcon className={GLYPH} />,
        run: () => setUseDeclarations(!declarationsOn),
      },
      {
        id: "project.delete",
        title: m.workshop_palette_delete_the_project(),
        group: m.workshop_palette_project(),
        keywords: ["remove"],
        icon: <TrashIcon className={GLYPH} />,
        run: actions.handleOpenDeleteDialog,
      },

      {
        id: "go.details",
        title: m.workshop_palette_open_mod_details(),
        group: m.workshop_palette_go_to(),
        keywords: ["metadata", "authors", "version", "thumbnail"],
        icon: <PlayerTitleIcon className={GLYPH} />,
        run: () => openDocument(detailsDocument()),
      },
      {
        id: "go.game",
        title: m.workshop_palette_open_the_game_index(),
        group: m.workshop_palette_go_to(),
        keywords: ["browse", "install", "assets"],
        icon: <LeagueIcon className={GLYPH} />,
        run: () => openDocument(gameDocument()),
      },
      {
        id: "go.gameWads",
        title: m.workshop_palette_open_the_game_wads(),
        group: m.workshop_palette_go_to(),
        keywords: ["archives", "browse"],
        icon: <FileArchiveIcon className={GLYPH} />,
        run: () => openDocument(gameWadsDocument()),
      },
      {
        id: "go.lcu",
        title: m.workshop_command_lcu_open_action(),
        group: m.workshop_palette_go_to(),
        keywords: ["browse", "league client", "client", "assets"],
        icon: <AppWindowIcon className={GLYPH} />,
        run: () => openDocument(gameDocument("lcu")),
      },
      {
        id: "go.lcuWads",
        title: m.workshop_command_lcu_wads_open_action(),
        group: m.workshop_palette_go_to(),
        keywords: ["archives", "browse", "league client", "client"],
        icon: <FileArchiveIcon className={GLYPH} />,
        run: () => openDocument(gameWadsDocument("lcu")),
      },
      {
        id: "go.objects",
        title: m.workshop_palette_open_the_objects_browser(),
        group: m.workshop_palette_go_to(),
        keywords: ["bin", "browse", "install", "index"],
        icon: <CubeIcon className={GLYPH} />,
        run: () => openDocument(objectsDocument()),
      },
      {
        id: "go.problems",
        title: m.workshop_palette_open_the_problems_list(),
        group: m.workshop_palette_go_to(),
        keywords: ["check", "findings", "errors", "warnings"],
        icon: <WarningDiamondIcon className={GLYPH} />,
        run: () => openDocument(problemsDocument()),
      },
      {
        id: "go.readme",
        title: m.workshop_palette_open_the_readme(),
        group: m.workshop_palette_go_to(),
        keywords: ["description", "markdown", "text"],
        icon: textFileKind("readme").icon(GLYPH),
        run: () => openDocument(projectTextDocument("readme")),
      },
      {
        id: "go.license",
        title: m.workshop_palette_open_the_license(),
        group: m.workshop_palette_go_to(),
        keywords: ["terms", "rights", "text"],
        icon: textFileKind("license").icon(GLYPH),
        run: () => openDocument(projectTextDocument("license")),
      },
      {
        id: "go.ignoreRules",
        title: m.workshop_palette_open_the_ignore_rules(),
        group: m.workshop_palette_go_to(),
        keywords: ["modignore", "exclude", "skip", "pack"],
        icon: <EyeSlashIcon className={GLYPH} />,
        run: () => openDocument(ignoreRulesDocument()),
      },
      {
        id: "go.references",
        title: m.workshop_palette_open_the_references(),
        group: m.workshop_palette_go_to(),
        keywords: ["usages", "links", "objects"],
        icon: <MagnifyingGlassIcon className={GLYPH} />,
        run: () => openDocument(referencesDocument()),
      },

      {
        id: "view.splitRight",
        title: m.workshop_palette_split_right(),
        group: m.workshop_palette_view(),
        keywords: ["group", "pane", "side"],
        icon: <SquareSplitHorizontalIcon className={GLYPH} />,
        enabled: activeDocumentId !== null,
        disabledReason: m.workshop_palette_nothing_open(),
        run: () => {
          if (activeDocumentId) splitWithDocument(activeDocumentId, activeLeafId, "right");
        },
      },
      {
        id: "view.splitDown",
        title: m.workshop_palette_split_down(),
        group: m.workshop_palette_view(),
        keywords: ["group", "pane", "below", "bottom"],
        icon: <SquareSplitVerticalIcon className={GLYPH} />,
        enabled: activeDocumentId !== null,
        disabledReason: m.workshop_palette_nothing_open(),
        run: () => {
          if (activeDocumentId) splitWithDocument(activeDocumentId, activeLeafId, "bottom");
        },
      },
      {
        id: "view.pinTab",
        title: activeDocumentPinned
          ? m.workshop_palette_unpin_the_tab()
          : m.workshop_palette_pin_the_tab(),
        group: m.workshop_palette_view(),
        keywords: ["stick", "keep", "front", "strip"],
        icon: activeDocumentPinned ? (
          <PushPinSlashIcon className={GLYPH} />
        ) : (
          <PushPinIcon className={GLYPH} />
        ),
        enabled: activeDocumentId !== null,
        disabledReason: m.workshop_palette_nothing_open(),
        run: () => {
          if (activeDocumentId) setDocumentPinned(activeDocumentId, !activeDocumentPinned);
        },
      },
      {
        id: "view.lockGroup",
        title: activeLeafLocked
          ? m.workshop_palette_unlock_the_group()
          : m.workshop_palette_lock_the_group(),
        group: m.workshop_palette_view(),
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
        title: m.workshop_palette_reset_the_layout(),
        group: m.workshop_palette_view(),
        keywords: ["merge", "groups", "panes"],
        icon: <LayoutIcon className={GLYPH} />,
        run: resetLayout,
      },
      ...group,
      {
        id: "view.toggleSidebar",
        title: layerPanelOpen
          ? m.workshop_palette_hide_the_side_panel()
          : m.workshop_palette_show_the_side_panel(),
        group: m.workshop_palette_view(),
        keywords: ["sidebar", "panel"],
        icon: <SidebarSimpleIcon weight="bold" className={GLYPH} />,
        run: () => setLayerPanelOpen(!layerPanelOpen),
      },

      {
        id: "game.find",
        title: m.workshop_palette_search_the_game_files(),
        group: m.workshop_palette_game(),
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
    offered,
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
