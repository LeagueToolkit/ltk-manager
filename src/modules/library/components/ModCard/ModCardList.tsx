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

export function ModCardList({ view }: { view: ModCardView }) {
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
        "border-accent-500/40 bg-surface-900 shadow-[0_0_10px_-4px] shadow-accent-500/20 hover:-translate-y-px",
    )
    .otherwise(
      () =>
        "border-surface-700 bg-surface-900 hover:-translate-y-px hover:border-surface-600 hover:bg-surface-800/80 hover:shadow-md",
    );

  return (
    <div
      onClick={onCardClick}
      className={twMerge(
        "flex items-center gap-4 rounded-lg border p-4 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out",
        cursorClass,
        stateClass,
      )}
    >
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
      <ModCardThumbnail variant="list" thumbnailUrl={thumbnailUrl} displayName={mod.displayName} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-medium text-surface-100">{mod.displayName}</h3>
          {isFlagged && (
            <Tooltip content={skinhackReason}>
              <ShieldAlert className="h-4 w-4 shrink-0 text-danger-text" />
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
            <WadCountBadge modId={mod.id} />
          </span>
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <MissingDepsBadge modId={mod.id} enabled={mod.enabled} />
          </span>
        </div>
      </div>

      <div data-no-toggle onClick={(e) => e.stopPropagation()}>
        <ModCardToggle view={view} />
      </div>

      <div data-no-toggle onClick={(e) => e.stopPropagation()}>
        <ModCardMenu view={view} />
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
    </div>
  );
}
