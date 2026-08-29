import { ShieldWarningIcon, WarningIcon } from "@phosphor-icons/react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import { Checkbox, Tooltip } from "@/components";
import { SuspectBadge } from "@/modules/diagnostics";

import { LayerPopover } from "../LayerPopover";
import { MissingDepsBadge } from "../MissingDepsBadge";
import { ModHealthBadge } from "../ModHealthBadge";
import {
  ModCardContextMenu,
  ModCardMenu,
  ModCardThumbnail,
  ModCardToggle,
  ModFaultDialog,
  ModPills,
  SkinhackInfoDialog,
} from "./ModCardParts";
import { ModWadFootprintDialog } from "./ModWadFootprintDialog";
import type { ModCardView } from "./useModCardController";

export function ModCardList({ view }: { view: ModCardView }) {
  const {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    faultReason,
    isMultiLayer,
    selectMode,
    isSelected,
    inSelectedState,
    inEnabledState,
    blocked,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    faultInfoOpen,
    setFaultInfoOpen,
    onCardClick,
  } = view;

  const stateClass = match({ isSelected: inSelectedState, isEnabled: inEnabledState })
    .with({ isSelected: true }, () => "border-accent-500 bg-surface-800 ring-2 ring-accent-400/60")
    /* The same three answers the row below gives a pointer. Enabled had only
       the 1px lift, which is nothing to see once it eases instead of jumping,
       and the dim coming off is what a disabled row was answering with. */
    .with(
      { isEnabled: true },
      () =>
        "border-accent-500/40 bg-surface-900 shadow-[0_0_10px_-4px] shadow-accent-500/20 hover:-translate-y-px hover:border-accent-500 hover:bg-surface-800/80 hover:shadow-md",
    )
    .otherwise(
      () =>
        "border-surface-700 bg-surface-900 hover:-translate-y-px hover:border-accent-hover hover:bg-surface-800/80 hover:shadow-md",
    );

  /* Lighter than the grid's, because a row carries a switch and does not need
     the recede to be what says the mod is off. It is here for the same reason
     the grid has it: an off row's pills stop competing for the accent.

     A blocked mod is dimmed by `cursorClass` already, and being unusable is not
     the same as being switched off. */
  const dimClass = !inEnabledState && !inSelectedState && !blocked ? "opacity-75 saturate-75" : "";

  /* The card is the trigger rather than a child of it, so the list keeps
     laying out the element it always did. */
  const row = (
    <div
      onClick={onCardClick}
      className={twMerge(
        "flex items-center gap-4 rounded-lg border p-4 transition-[translate,box-shadow,background-color,border-color,opacity,filter] duration-150 ease-out",
        "hover:opacity-100 hover:saturate-100",
        dimClass,
        cursorClass,
        stateClass,
      )}
    />
  );

  return (
    <ModCardContextMenu view={view} card={row}>
      {selectMode && (
        <div className="pointer-events-none shrink-0">
          <Checkbox
            size="md"
            checked={isSelected}
            tabIndex={-1}
            aria-label={`Select ${mod.displayName}`}
          />
        </div>
      )}
      <ModCardThumbnail
        variant="list"
        thumbnailUrl={thumbnailUrl}
        displayName={mod.displayName}
        lit={inEnabledState}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-medium text-surface-100">{mod.displayName}</h3>
          {isFlagged && (
            <Tooltip content={skinhackReason}>
              <ShieldWarningIcon className="h-4 w-4 shrink-0 text-danger-text" />
            </Tooltip>
          )}
          {faultReason !== null && (
            <Tooltip content={faultReason}>
              <WarningIcon className="h-4 w-4 shrink-0 text-danger-text" />
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm text-surface-500">
            v{mod.version} • {mod.authors.join(", ") || "Unknown author"}
          </p>
          <ModPills mod={mod} max={3} />
          {isMultiLayer && <LayerPopover mod={mod} disabled={view.interactionsDisabled} />}
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <MissingDepsBadge modId={mod.id} enabled={mod.enabled} />
          </span>
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <SuspectBadge modId={mod.id} enabled={mod.enabled} />
          </span>
        </div>
      </div>

      {/* Beside the switch rather than among the metadata: it is a thing to act
          on, and `empty:hidden` keeps a healthy row from holding the gap open
          for a badge it does not draw.

          These three are `flex` so their control is a flex item rather than an
          inline one. A line box would hang the font's descender space under each
          button, which lands them all off the row's centre. */}
      <span
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center empty:hidden"
      >
        <ModHealthBadge modId={mod.id} />
      </span>

      <div
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center"
      >
        <ModCardToggle view={view} />
      </div>

      <div
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center"
      >
        <ModCardMenu view={view} />
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
      <ModFaultDialog view={view} open={faultInfoOpen} onOpenChange={setFaultInfoOpen} />
      <ModWadFootprintDialog
        view={view}
        open={view.wadFootprintOpen}
        onOpenChange={view.setWadFootprintOpen}
      />
    </ModCardContextMenu>
  );
}
