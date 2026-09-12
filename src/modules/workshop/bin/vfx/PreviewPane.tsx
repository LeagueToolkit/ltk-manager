import { lazy, Suspense } from "react";

import { ErrorBoundary } from "@/components";
import { m } from "@/i18n";

import { Notice } from "./Notice";
import { PaneFault } from "./PaneFault";

/**
 * The particle viewport, in a chunk of its own.
 *
 * ThreeJS is around 600 KB and nothing outside this pane reads it, so the import is what
 * keeps it off every other route's chunk.
 */
const VfxViewport = lazy(() => import("./VfxViewport"));

/** Start that chunk's fetch, so the pane's first paint is not what asks for it. */
export function preloadVfxViewport(): void {
  void import("./VfxViewport");
}

/** What the preview draws under the viewport: a mini transport while no timeline shows, else nothing. */
export type PreviewTransport = "mini" | "none";

export interface PreviewPaneProps {
  /** The object's class is one the renderer draws. */
  drawable: boolean;
  transport: PreviewTransport;
}

/**
 * The system drawn, and the reason there is nothing to draw for any other class.
 *
 * The boundary is the pane's own, so a throw under it takes the pane and not the app,
 * whose unmount would lose the GL context with it.
 */
export function PreviewPane({ drawable, transport }: PreviewPaneProps) {
  if (!drawable) return <Notice text={m.workshop_bin_preview_pane_empty()} />;

  return (
    <ErrorBoundary fallback={(retry) => <PaneFault onRetry={retry} />}>
      <Suspense fallback={<Notice text={m.workshop_bin_preview_loading_label()} />}>
        <VfxViewport transport={transport} />
      </Suspense>
    </ErrorBoundary>
  );
}
