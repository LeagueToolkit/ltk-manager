import { lazy, Suspense } from "react";

import { m } from "@/i18n";
import type { AssetRef, BinDocumentId } from "@/lib/tauri";

import { Notice } from "../vfx/Notice";

/** The skin viewport, in a chunk of its own as the particle viewport is. */
const SkinViewport = lazy(() => import("./SkinViewport"));

/** Start that chunk's fetch, so the preview's first paint is not what asks for it. */
export function preloadSkinViewport(): void {
  void import("./SkinViewport");
}

export interface SkinPreviewProps {
  document: BinDocumentId;
  /** What the document was read from. */
  asset: AssetRef;
  /** The skin object, `0x` and eight hex digits, and null where the view holds no row. */
  entry: string | null;
}

/**
 * The skin on its skeleton, wearing its idle effects, filling whatever holds it.
 *
 * ADR-0035 for the drawing and ADR-0036 for where it sits.
 */
export function SkinPreview({ document, asset, entry }: SkinPreviewProps) {
  return (
    <div
      data-ui="SkinPreview"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden select-none"
      role="group"
      aria-label={m.workshop_bin_mesh_preview_label()}
    >
      {entry === null && <Notice text={m.workshop_bin_mesh_preview_missing_empty()} />}
      {entry !== null && (
        <Suspense fallback={<Notice text={m.workshop_bin_mesh_preview_loading_label()} />}>
          <SkinViewport document={document} asset={asset} entry={entry} />
        </Suspense>
      )}
    </div>
  );
}
