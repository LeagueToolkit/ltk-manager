import { FolderOpenIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components";
import { m } from "@/i18n";
import {
  useLayerPanelOpen,
  useLayerPanelSide,
  useSetLayerPanelOpen,
  useShowSidebarView,
  useSidebarView,
} from "@/stores";
import type { SidebarViewId } from "@/stores";
import { twMerge } from "@/utils";

import { useProjectActions } from "../api/useProjectActions";
import { useProjectContext } from "../components/ProjectContext";
import { useActiveDocumentId, useOpenDocument } from "../state";
import { railDocuments, railViews } from "./railViews";

/**
 * The strip of views down the content browser's outer edge, ADR-0038.
 *
 * The upper group selects what the primary side panel shows, and the lower group
 * opens the documents that belong to the whole project. A project's routes are
 * the same however the editor grid is arranged, so the rail sits outside the
 * panel it drives and stays on screen while that panel is hidden.
 */
export function SidebarRail() {
  const view = useSidebarView();
  const panelOpen = useLayerPanelOpen();
  const showView = useShowSidebarView();
  const setPanelOpen = useSetLayerPanelOpen();
  const side = useLayerPanelSide();

  const project = useProjectContext();
  const projectActions = useProjectActions(project);
  const openDocument = useOpenDocument();
  const activeId = useActiveDocumentId();

  /* The mark rides the window's own edge, so it reads as the panel's tab rather
     than as a border between the rail and the panel. */
  const markSide = side === "left" ? "left-0" : "right-0";
  const tooltipSide = side === "left" ? "right" : "left";

  /* Pressing the showing view's own icon hides the panel, which is the rail's
     only route to a closed panel and the gesture Visual Studio Code trained. */
  function selectView(id: SidebarViewId) {
    if (panelOpen && view === id) {
      setPanelOpen(false);
      return;
    }
    showView(id);
  }

  return (
    <div
      data-ui="SidebarRail"
      /* DS-GROUND: chrome beside the fold's islands rather than an island of its own. */
      className="flex w-11 shrink-0 flex-col items-center py-1.5 select-none"
    >
      <div
        role="tablist"
        aria-label={m.workshop_sidebar_rail_label()}
        aria-orientation="vertical"
        className="flex flex-col items-center gap-0.5"
      >
        {railViews().map((entry) => (
          <RailButton
            key={entry.id}
            label={entry.title}
            icon={entry.icon}
            current={panelOpen && view === entry.id}
            onClick={() => selectView(entry.id)}
            markSide={markSide}
            tooltipSide={tooltipSide}
            tab
          />
        ))}
      </div>

      <div className="flex-1" />

      <div aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-surface-700" />

      <div className="flex flex-col items-center gap-0.5">
        {railDocuments().map((entry) => (
          <RailButton
            key={entry.documentId}
            label={entry.label}
            icon={entry.icon}
            current={activeId === entry.documentId}
            onClick={() => openDocument(entry.document())}
            markSide={markSide}
            tooltipSide={tooltipSide}
          />
        ))}

        <RailButton
          label={m.workshop_sidebar_folder_action()}
          icon={<FolderOpenIcon className="h-5 w-5" />}
          current={false}
          onClick={projectActions.handleOpenLocation}
          markSide={markSide}
          tooltipSide={tooltipSide}
        />
      </div>
    </div>
  );
}

interface RailButtonProps {
  label: string;
  icon: ReactNode;
  /** This button's view is showing, or its document is the one on screen. */
  current: boolean;
  onClick: () => void;
  markSide: string;
  tooltipSide: "left" | "right";
  /** This button selects a view, rather than opening a document or a folder. */
  tab?: boolean;
}

function RailButton({
  label,
  icon,
  current,
  onClick,
  markSide,
  tooltipSide,
  tab,
}: RailButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        type="button"
        role={tab ? "tab" : undefined}
        aria-selected={tab ? current : undefined}
        aria-label={label}
        onClick={onClick}
        className={twMerge(
          "relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-surface-400 transition-colors outline-none",
          /* DS-VEIL */ "hover:bg-surface-veil hover:text-surface-100 active:bg-surface-veil-strong",
          "focus-visible:ring-1 focus-visible:ring-accent-500/60",
          current && "text-accent-200",
        )}
      >
        {icon}
        {current && (
          <span
            aria-hidden="true"
            className={twMerge("absolute inset-y-1.5 w-0.5 rounded-full bg-accent-500", markSide)}
          />
        )}
      </button>
    </Tooltip>
  );
}
