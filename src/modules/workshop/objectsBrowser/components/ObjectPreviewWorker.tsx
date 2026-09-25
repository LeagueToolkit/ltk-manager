import { lazy, Suspense } from "react";

import { ErrorBoundary } from "@/components";
import { Viewport } from "@/modules/viewport";

import { FAILED_OUTCOME, type PreviewOutcome } from "../state/previewStills";
import { objectPreviewKey } from "../utils/objectPreview";
import type { ObjectRowNode } from "../utils/objectTree";
import { PreviewSettled } from "./PreviewSettled";

const ObjectPreviewScene = lazy(() => import("./ObjectPreviewScene"));

/** The highest pixel ratio a preview renders at, for stills and played tiles. */
const MAX_DPR = 2;

interface ObjectPreviewWorkerProps {
  node: ObjectRowNode | null;
  playing: boolean;
  onOutcome: (outcome: PreviewOutcome) => void;
}

/** A retained GPU surface for one slot in the grid's bounded preview pool. */
export default function ObjectPreviewWorker({
  node,
  playing,
  onOutcome,
}: ObjectPreviewWorkerProps) {
  return (
    <Viewport
      active={node !== null}
      dpr={Math.min(window.devicePixelRatio, MAX_DPR)}
      gizmo={false}
      stage={false}
      textured={false}
      camera="orbit"
      clearColor="ground"
    >
      <Suspense fallback={null}>
        {node !== null && (
          <ErrorBoundary
            key={objectPreviewKey(node)}
            fallback={() => <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />}
          >
            <ObjectPreviewScene node={node} playing={playing} onOutcome={onOutcome} />
          </ErrorBoundary>
        )}
      </Suspense>
    </Viewport>
  );
}
