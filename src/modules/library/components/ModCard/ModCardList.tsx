import { ShieldAlert } from "lucide-react";
import { memo } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import { Tooltip } from "@/components";
import { useLibrarySelectionStore } from "@/stores";

import { LayerPopover } from "../LayerPopover";
import { MissingDepsBadge } from "../MissingDepsBadge";
import { WadCountBadge } from "../WadCountBadge";
import {
  ModCardMenu,
  ModCardThumbnail,
  ModCardToggle,
  ModPills,
  ModSelectionIndicator,
  SkinhackInfoDialog,
} from "./ModCardParts";
import type { ModCardView } from "./useModCardController";

export function ModCardList({ view }: { view: ModCardView }) {
  const isSelected = useLibrarySelectionStore((state) => state.selectedIds.has(view.mod.id));

  const stateClass = match({ isSelected, isEnabled: view.inEnabledState })
    .with({ isSelected: true }, () => "border-accent-500 bg-surface-800 ring-2 ring-accent-400/60")
    .with(
      { isEnabled: true },
      () =>
        "border-accent-500/40 bg-surface-800 shadow-[0_0_10px_-4px] shadow-accent-500/20 hover:-translate-y-px",
    )
    .otherwise(
      () =>
        "border-surface-700 bg-surface-900 hover:-translate-y-px hover:border-surface-600 hover:bg-surface-800/80 hover:shadow-md",
    );

  return (
    <div
      onClick={view.onCardClick}
      onClickCapture={view.onCardClickCapture}
      className={twMerge(
        "mod-card mod-card-list flex items-center gap-4 rounded-lg border p-4 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out",
        view.cursorClass,
        stateClass,
      )}
      aria-selected={isSelected || undefined}
    >
      <ModSelectionIndicator variant="list" checked={isSelected} />
      <ModCardListContent view={view} />
    </div>
  );
}

const ModCardListContent = memo(function ModCardListContent({ view }: { view: ModCardView }) {
  const {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    isMultiLayer,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
  } = view;

  return (
    <>
      <ModCardThumbnail variant="list" thumbnailUrl={thumbnailUrl} displayName={mod.displayName} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-medium text-surface-100">{mod.displayName}</h3>
          {isFlagged && (
            <Tooltip content={skinhackReason}>
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
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
        <ModCardToggle variant="list" view={view} />
      </div>

      <div data-no-toggle onClick={(e) => e.stopPropagation()}>
        <ModCardMenu view={view} />
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
    </>
  );
});
