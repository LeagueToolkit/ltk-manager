import type { ReactNode } from "react";

import type { InstalledMod } from "@/lib/tauri";

interface DetailsCoverProps {
  mod: InstalledMod;
  /** The art to draw across the panel, or none for the letter plate. */
  thumbnailUrl?: string;
  /** What the reader gets over the art, such as the thumbnail picker. */
  children?: ReactNode;
}

/**
 * The mod's art across the panel, with its name knocked over the foot.
 *
 * A mod with no art keeps the cover and falls back to the letter plate the card
 * already draws. A panel whose first element appears and disappears per mod
 * reads as broken rather than as adaptive.
 */
export function DetailsCover({ mod, thumbnailUrl, children }: DetailsCoverProps) {
  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-linear-to-br from-surface-700 to-surface-800">
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {!thumbnailUrl && (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-5xl font-bold text-surface-500 select-none">
            {mod.displayName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {children}
      {/* DS-INVARIANT: the wash holds its tone in both themes, where every rung
          under it flips. */}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-linear-to-t from-scrim to-transparent px-3 pt-10 pb-2">
        <p className="min-w-0 flex-1 truncate text-lg font-medium text-brand-on select-text">
          {mod.displayName}
        </p>
        <span className="shrink-0 text-meta text-brand-on/70 select-text">v{mod.version}</span>
      </div>
    </div>
  );
}
