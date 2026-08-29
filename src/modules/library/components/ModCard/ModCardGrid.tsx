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
  ModFaultDialog,
  ModPills,
  SkinhackInfoDialog,
} from "./ModCardParts";
import { ModWadFootprintDialog } from "./ModWadFootprintDialog";
import type { ModCardView } from "./useModCardController";

export function ModCardGrid({ view }: { view: ModCardView }) {
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
    isInteractive,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    faultInfoOpen,
    setFaultInfoOpen,
    onCardClick,
    onCardKeyDown,
  } = view;

  /* Every state below select mode is `edge-lit`, and what separates them is how
     far the light reaches down the border. The edge is the state, so it lands
     in one frame and only the lift and the fill under it ease - a grid is
     toggled by the handful, and anything that travels turns that into a queue
     of animations to sit through.

     Enabled takes no ring and no glow on top: an unbroken accent line outside
     the fade, or a halo under it, both put back the box the fade opens up. */
  const stateClass = match({ isSelected: inSelectedState, isEnabled: inEnabledState })
    .with({ isSelected: true }, () => "border-accent-400 bg-surface-800 ring-2 ring-accent-400")
    .with(
      { isEnabled: true },
      () =>
        "edge-lit [--edge-lit-reach:100%] hover:[--edge-lit-color:var(--accent-400)] hover:[--edge-lit-fill:var(--surface-800)] hover:-translate-y-px hover:shadow-md",
    )
    /* Dimmer and shorter than the enabled edge, so a hover cannot be misread as
       the mod having switched on: DS-HOVER. */
    .otherwise(
      () =>
        "edge-lit hover:[--edge-lit-color:var(--accent-hover)] hover:[--edge-lit-reach:60%] hover:[--edge-lit-fill:var(--surface-800)] hover:-translate-y-px hover:shadow-md",
    );

  /* Most of a library is switched on, so off is the state worth marking and the
     card recedes rather than the enabled one shouting. It also takes the accent
     out of a disabled card's pills, which were competing with the lit edge for
     the one hue that means enabled.

     A blocked mod is not off - it cannot be used at all - and `cursorClass`
     already dims it. Dimming it again as though it were merely switched off
     would file a broken mod under a state the reader chose. */
  const dimClass = !inEnabledState && !inSelectedState && !blocked ? "opacity-60 saturate-50" : "";

  /* The card is the context menu's trigger rather than a child of it, so the
     grid keeps sizing the element it always did. */
  const card = (
    <div
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
      role="button"
      tabIndex={isInteractive ? 0 : -1}
      aria-pressed={selectMode ? isSelected : mod.enabled}
      aria-label={mod.displayName}
      className={twMerge(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border-2 transition-[translate,box-shadow,background-color,border-color,opacity,filter,--edge-lit-fill] duration-150 ease-out select-none",
        "focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:outline-none",
        "hover:opacity-100 hover:saturate-100",
        dimClass,
        cursorClass,
        stateClass,
      )}
    />
  );

  return (
    <ModCardContextMenu view={view} card={card}>
      {/* One corner rather than four absolutes at the same coordinates, which
          stacked whenever a mod was in more than one of these states. */}
      <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
        {selectMode && (
          <div className="pointer-events-none">
            <Checkbox
              size="md"
              checked={isSelected}
              tabIndex={-1}
              aria-label={`Select ${mod.displayName}`}
              className="shadow-lg backdrop-blur-sm"
            />
          </div>
        )}
        {isFlagged && (
          <Tooltip content={skinhackReason}>
            <div className="rounded-md bg-danger/90 p-1">
              <ShieldWarningIcon className="h-4 w-4 text-brand-on" />
            </div>
          </Tooltip>
        )}
        {faultReason !== null && (
          <Tooltip content={faultReason}>
            <button
              type="button"
              data-no-toggle
              aria-label={`Why ${mod.displayName} failed`}
              onClick={(e) => {
                e.stopPropagation();
                setFaultInfoOpen(true);
              }}
              className="cursor-pointer rounded-md bg-danger/90 p-1 transition-colors hover:bg-danger"
            >
              <WarningIcon className="h-4 w-4 text-brand-on" />
            </button>
          </Tooltip>
        )}
        {/* A ground under the pill's own fill, so it reads over cover art:
            DS-GLASS. `empty:hidden` keeps a healthy mod from spending a gap on
            the badge it does not draw. */}
        <span
          data-no-toggle
          onClick={(e) => e.stopPropagation()}
          className="flex items-center rounded-sm bg-scrim/50 backdrop-blur-sm empty:hidden"
        >
          <ModHealthBadge modId={mod.id} />
        </span>
      </div>

      {/* Over the art rather than in the footer, which is the row it was making
          36px tall to hold a control nobody comes to a card for. */}
      <div
        className="absolute top-1.5 right-1.5 z-10"
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
      >
        {/* Keyboard focus, not `group-focus-within`: clicking a card to toggle
            it focuses the card, which left the kebab lit on every mod someone
            had just switched on. */}
        <ModCardMenu
          view={view}
          className="bg-scrim/50 opacity-0 backdrop-blur-sm group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
        />
      </div>

      <ModCardThumbnail
        variant="grid"
        thumbnailUrl={thumbnailUrl}
        displayName={mod.displayName}
        lit={inEnabledState}
      />

      {/* Name, then what the name is, then what is wrong with it. Spacing is
          the column's gap, so the badge row costs nothing but that when it has
          nothing in it: DS-GAP. */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-center gap-1">
          <h3 className="min-w-0 truncate text-sm font-medium text-surface-100 select-text">
            {mod.displayName}
          </h3>
          {isFlagged && <ShieldWarningIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" />}
          {faultReason !== null && (
            <WarningIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" />
          )}
        </div>

        <div className="flex items-center text-xs text-surface-500">
          <span>v{mod.version}</span>
          <span className="mx-1">•</span>
          <span className="flex-1 truncate">
            {mod.authors.length > 0 ? mod.authors[0] : "Unknown"}
          </span>
        </div>

        {/* Pinned to the foot, so a row of cards lines its badges up rather
            than hanging each set under a title of its own length. */}
        <div className="mt-auto flex items-center gap-1">
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
