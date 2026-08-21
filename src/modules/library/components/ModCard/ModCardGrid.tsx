import { ShieldWarningIcon } from "@phosphor-icons/react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import { Checkbox, Tooltip } from "@/components";
import { SuspectBadge } from "@/modules/diagnostics";

import { LayerPopover } from "../LayerPopover";
import { MissingDepsBadge } from "../MissingDepsBadge";
import { WadCountBadge } from "../WadCountBadge";
import { ModCardMenu, ModCardThumbnail, ModPills, SkinhackInfoDialog } from "./ModCardParts";
import type { ModCardView } from "./useModCardController";

export function ModCardGrid({ view }: { view: ModCardView }) {
  const {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    isMultiLayer,
    selectMode,
    isSelected,
    inSelectedState,
    inEnabledState,
    isInteractive,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    onCardClick,
    onCardKeyDown,
  } = view;

  /* The glow has to die inside the grid's 16px gutter or it lands on the next card. */
  const stateClass = match({ isSelected: inSelectedState, isEnabled: inEnabledState })
    .with({ isSelected: true }, () => "border-accent-400 bg-surface-800 ring-2 ring-accent-400")
    .with(
      { isEnabled: true },
      () =>
        "border-accent-500 bg-surface-900 ring-1 ring-accent-500 shadow-[0_0_14px_1px] shadow-accent-500/30 hover:-translate-y-px hover:shadow-[0_0_16px_2px,0_4px_8px_-2px] hover:shadow-accent-500/40",
    )
    .otherwise(
      () =>
        "border-surface-600 bg-surface-900 hover:-translate-y-px hover:border-accent-hover hover:bg-surface-800/80 hover:shadow-md",
    );

  return (
    <div
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
      role="button"
      tabIndex={isInteractive ? 0 : -1}
      aria-pressed={selectMode ? isSelected : mod.enabled}
      aria-label={mod.displayName}
      className={twMerge(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:outline-none",
        cursorClass,
        stateClass,
      )}
    >
      {selectMode && (
        <div className="pointer-events-none absolute top-2 left-2 z-10">
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
          <div className="absolute top-2 left-2 z-10 rounded-md bg-danger/90 p-1">
            <ShieldWarningIcon className="h-4 w-4 text-brand-on" />
          </div>
        </Tooltip>
      )}

      <ModCardThumbnail variant="grid" thumbnailUrl={thumbnailUrl} displayName={mod.displayName} />

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-center gap-1">
          <h3 className="min-w-0 truncate text-sm font-medium text-surface-100">
            {mod.displayName}
          </h3>
          {isFlagged && <ShieldWarningIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" />}
        </div>

        <div className="mb-1 flex min-h-5 items-center gap-1">
          <ModPills mod={mod} max={3} />
          {isMultiLayer && <LayerPopover mod={mod} disabled={view.interactionsDisabled} />}
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <WadCountBadge modId={mod.id} />
          </span>
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <MissingDepsBadge modId={mod.id} enabled={mod.enabled} />
          </span>
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <SuspectBadge modId={mod.id} enabled={mod.enabled} />
          </span>
        </div>

        <div className="mt-auto flex items-center text-xs text-surface-500">
          <span>v{mod.version}</span>
          <span className="mx-1">•</span>
          <span className="flex-1 truncate">
            {mod.authors.length > 0 ? mod.authors[0] : "Unknown"}
          </span>
          <div className="ml-1 shrink-0" data-no-toggle onClick={(e) => e.stopPropagation()}>
            <ModCardMenu view={view} />
          </div>
        </div>
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
    </div>
  );
}
