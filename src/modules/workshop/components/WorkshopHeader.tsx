import { twMerge } from "tailwind-merge";

import { ToolbarRow } from "@/components";

import { NavigationArrows } from "../palette/NavigationArrows";
import { WorkshopBar } from "../palette/WorkshopBar";
import { ProblemsBadge } from "../problems";
import { ContentLayoutPopover } from "./ContentLayoutPopover";
import { ProjectActions } from "./ProjectActions";
import { useOptionalProjectContext } from "./ProjectContext";
import { WorkshopActions, WorkshopViewControls } from "./WorkshopControls";

/**
 * The one row over both workshop surfaces.
 *
 * Opening a project refills the slots rather than swapping the chrome, so the
 * grid and the editor stop reflowing against each other.
 */
export function WorkshopHeader() {
  return (
    <ToolbarRow data-ui="WorkshopHeader" className="py-1 select-none">
      <HistorySlot />
      <BarSlot />
      <TrailingSlots />
    </ToolbarRow>
  );
}

/* Equal shares on both sides centre the bar in the row rather than in what is
   left beside it, and both have to grow or one carries it across on its own. */
const SIDE_SLOT = "min-w-max flex-1 basis-0";

/*
 * One stack across the shell, so the arrows stand over the grid as well: a back
 * there is the route into whichever project the user just left.
 *
 * `justify-end` is what holds them against the bar as their side grows, which is
 * the layout every editor draws them in - the two travel with the box they move
 * rather than the arrows holding an edge the bar has left. `ToolbarRow` spends
 * one gap on every junction of the row, and this junction wants less.
 */
function HistorySlot() {
  return (
    <div className={twMerge(SIDE_SLOT, "-mr-2 flex items-center justify-end")}>
      <NavigationArrows />
    </div>
  );
}

/** The right of the row: the badge, the view controls and the actions. */
function TrailingSlots() {
  return (
    <div className={twMerge(SIDE_SLOT, "flex items-center justify-end gap-1")}>
      <BadgeSlot />
      <ViewSlot />
      <ActionSlot />
    </div>
  );
}

function BarSlot() {
  return <WorkshopBar />;
}

function BadgeSlot() {
  const project = useOptionalProjectContext();

  if (!project) return null;
  return <ProblemsBadge />;
}

function ViewSlot() {
  const project = useOptionalProjectContext();

  /* Layout is view-level, so it sits here once rather than in every leaf's tab strip. */
  if (project) return <ContentLayoutPopover />;
  return <WorkshopViewControls />;
}

function ActionSlot() {
  const project = useOptionalProjectContext();

  if (!project) return <WorkshopActions />;
  return <ProjectActions project={project} />;
}
