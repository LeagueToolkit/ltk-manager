import { SphereIcon } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";

import { m } from "@/i18n";
import type { AssetRef, BinDocumentId } from "@/lib/tauri";
import { usePreviewMaterialOnShape, useSetPreviewDisplay } from "@/stores";

import { SkinPreview } from "../../skin/components/SkinPreview";
import { Notice } from "../../vfx/preview/components/Notice";
import { ViewToggle } from "../../vfx/preview/components/ViewToggle";
import { type LinkingSkin, useLinkingSkin } from "../hooks/useLinkingSkin";
import { ProgramNotes } from "./ProgramNotes";

/** The material viewport, in a chunk of its own as the skin viewport is. */
const MaterialViewport = lazy(() => import("./MaterialViewport"));

/** Start that chunk's fetch, so the preview's first paint is not what asks for it. */
export function preloadMaterialViewport(): void {
  void import("./MaterialViewport");
}

export interface MaterialPreviewProps {
  document: BinDocumentId;
  /** What the document was read from, which the skin preview reads its assets near. */
  asset: AssetRef;
  /** The `StaticMaterialDef` object the preview draws. */
  entry: string | null;
  /** The backend no longer holds `document`, so the tab reopens it. */
  onNotOpen?: () => void;
}

/**
 * A material on the character of its own file, or on a preview shape behind a toggle.
 * "The material shell" in docs/ux/BIN_EDITOR.md.
 *
 * A material no skin of the file draws with takes the shape, and no toggle.
 */
export function MaterialPreview({ document, asset, entry, onNotOpen }: MaterialPreviewProps) {
  const linking = useLinkingSkin(document, entry);
  const onShape = usePreviewMaterialOnShape();
  const setDisplay = useSetPreviewDisplay();

  return (
    <div
      data-ui="MaterialPreview"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden select-none"
      role="group"
      aria-label={m.workshop_bin_material_preview_label()}
    >
      <Subject
        document={document}
        asset={asset}
        entry={entry}
        onNotOpen={onNotOpen}
        linking={linking}
        onShape={onShape}
      />
      <ProgramNotes document={document} entry={entry} />

      {linking.status === "skin" && (
        <div
          data-ui="MaterialPreview:on-shape"
          /* DS-GLASS, DS-RADIUS, DS-VEIL */
          className="absolute bottom-2 left-2 z-10 rounded-md border border-surface-veil bg-scrim p-1 shadow-md backdrop-blur-sm"
        >
          <ViewToggle
            label={m.workshop_bin_material_preview_on_shape_label()}
            active={onShape}
            icon={<SphereIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setDisplay({ previewMaterialOnShape: !onShape })}
          />
        </div>
      )}
    </div>
  );
}

/** What the preview draws, which waits on the skin search so the shape does not flash first. */
function Subject({
  document,
  asset,
  entry,
  onNotOpen,
  linking,
  onShape,
}: MaterialPreviewProps & { linking: LinkingSkin; onShape: boolean }) {
  if (!onShape && linking.status === "reading") {
    return <Notice text={m.workshop_bin_material_preview_loading_label()} />;
  }
  if (!onShape && linking.status === "skin") {
    return (
      <SkinPreview document={document} asset={asset} entry={linking.entry} onNotOpen={onNotOpen} />
    );
  }
  return (
    <Suspense fallback={<Notice text={m.workshop_bin_material_preview_loading_label()} />}>
      <MaterialViewport document={document} entry={entry} />
    </Suspense>
  );
}
