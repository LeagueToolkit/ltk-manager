import { ShieldAlert } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import { Checkbox, Tooltip } from "@/components";

import { LayerPopover } from "../LayerPopover";
import { MissingDepsBadge } from "../MissingDepsBadge";
import { WadCountBadge } from "../WadCountBadge";
import {
  ModCardMenu,
  ModCardThumbnail,
  ModCardToggle,
  ModPills,
  SkinhackInfoDialog,
} from "./ModCardParts";
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
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    onCardClick,
  } = view;

  const stateClass = match({ isSelected: inSelectedState, isEnabled: inEnabledState })
    .with({ isSelected: true }, () => "border-accent-500 bg-surface-800 ring-2 ring-accent-400/60")
    .with(
      { isEnabled: true },
      () =>
        "border-accent-500/40 bg-surface-800 shadow-[0_0_12px_-6px] shadow-accent-500/25 hover:-translate-y-px hover:shadow-[0_0_14px_-5px,0_4px_6px_-1px] hover:shadow-accent-500/30",
    )
    .otherwise(
      () =>
        "border-surface-600 bg-surface-800 hover:-translate-y-px hover:border-surface-400 hover:bg-surface-700/80 hover:shadow-md",
    );

  return (
    <div
      onClick={onCardClick}
      className={twMerge(
        "group relative flex h-full flex-col rounded-xl border transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out",
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
      <div
        className="absolute top-2 right-2 z-10"
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
      >
        <ModCardToggle variant="grid" view={view} />
      </div>

      {isFlagged && (
        <Tooltip content={skinhackReason}>
          <div className="absolute top-2 left-2 z-10 rounded-md bg-red-500/90 p-1">
            <ShieldAlert className="h-4 w-4 text-white" />
          </div>
        </Tooltip>
      )}

      <ModCardThumbnail variant="grid" thumbnailUrl={thumbnailUrl} displayName={mod.displayName} />

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-center gap-1">
          <h3 className="line-clamp-1 text-sm font-medium text-surface-100">{mod.displayName}</h3>
          {isFlagged && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />}
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
