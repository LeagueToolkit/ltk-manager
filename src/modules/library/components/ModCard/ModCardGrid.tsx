import { ShieldWarningIcon } from "@phosphor-icons/react";
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
    isMultiLayer,
    hasSelection,
    isSelected,
    inEnabledState,
    blocked,
    isInteractive,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    onCardClick,
    onCardKeyDown,
    onCardContextMenu,
    onSelectionToggle,
  } = view;

  /* Every state below picked is `edge-lit`, and what separates them is how far
     the light reaches down the border. The edge is the state, so it lands in
     one frame and only the lift and the fill under it ease - a grid is toggled
     by the handful, and anything that travels turns that into a queue of
     animations to sit through.

     Enabled takes no ring and no glow on top: an unbroken accent line outside
     the fade, or a halo under it, both put back the box the fade opens up. */
  const stateClass = match({ isSelected, isEnabled: inEnabledState })
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
  const dimClass = !inEnabledState && !isSelected && !blocked ? "opacity-60 saturate-50" : "";

  /* Faded rather than absent, so tabbing to it still reaches a control. It is
     out of the corner's flow and the marks slide off it instead, or a card with
     nothing picked would hold 24px of nothing open beside its badges. */
  const checkboxClass = hasSelection
    ? ""
    : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";
  const marksShift = hasSelection
    ? "translate-x-6"
    : "group-hover:translate-x-6 group-focus-within:translate-x-6";

  /* The card is the context menu's trigger rather than a child of it, so the
     grid keeps sizing the element it always did. */
  const card = (
    <div
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
      onContextMenu={onCardContextMenu}
      role="button"
      tabIndex={isInteractive ? 0 : -1}
      aria-pressed={mod.enabled}
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
      <div className="absolute top-1.5 left-1.5 z-10">
        <span
          data-no-toggle
          onClick={(e) => e.stopPropagation()}
          className={twMerge("absolute top-0 left-0", checkboxClass)}
        >
          <Checkbox
            size="md"
            checked={isSelected}
            onCheckedChange={onSelectionToggle}
            aria-label={`Select ${mod.displayName}`}
            className="shadow-lg backdrop-blur-sm"
          />
        </span>
        <div
          className={twMerge(
            "flex items-center gap-1 transition-transform duration-150 ease-out",
            marksShift,
          )}
        >
          {isFlagged && (
            <Tooltip content={skinhackReason}>
              <div className="rounded-md bg-danger/90 p-1">
                <ShieldWarningIcon className="h-4 w-4 text-brand-on" />
              </div>
            </Tooltip>
          )}
          {/* A ground under the marks' own fill, so they read over cover art:
              DS-GLASS. `empty:hidden` keeps a mod with neither from spending a
              gap on the marks it does not draw. */}
          <span
            data-no-toggle
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 rounded-sm bg-scrim/50 backdrop-blur-sm empty:hidden"
          >
            <ModHealthBadge modId={mod.id} />
            <SuspectBadge modId={mod.id} enabled={mod.enabled} />
          </span>
        </div>
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
          {isMultiLayer && <LayerPopover mod={mod} disabled={view.disabled} />}
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <MissingDepsBadge modId={mod.id} enabled={mod.enabled} />
          </span>
        </div>
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
      <ModWadFootprintDialog
        view={view}
        open={view.wadFootprintOpen}
        onOpenChange={view.setWadFootprintOpen}
      />
    </ModCardContextMenu>
  );
}
