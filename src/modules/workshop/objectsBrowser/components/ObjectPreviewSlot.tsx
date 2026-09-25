import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ErrorBoundary, Popover } from "@/components";
import { m } from "@/i18n";

import { FAILED_OUTCOME, type PreviewOutcome, savePreviewOutcome } from "../state/previewStills";
import type { ObjectRowNode } from "../utils/objectTree";
import type { PreviewJob } from "../utils/previewSlots";

const ObjectPreviewWorker = lazy(() => import("./ObjectPreviewWorker"));
const JOB_TIMEOUT_MS = 15_000;

/** One preview job of the objects grid. */
export type ObjectPreviewJob = PreviewJob<ObjectRowNode>;

/** Where a slot's surface draws: hidden in the dock, over its tile's art, or in the large popover. */
export type PreviewDisplay =
  | { readonly mode: "dock" }
  | { readonly mode: "tile"; readonly stage: HTMLElement }
  | { readonly mode: "large"; readonly anchor: HTMLElement };

export const DOCKED: PreviewDisplay = Object.freeze({ mode: "dock" });

interface ObjectPreviewSlotProps {
  job: ObjectPreviewJob | null;
  display: PreviewDisplay;
  /** The retry generation. A retry starts a new request for the same key. */
  generation: number;
  /** Called when the large popover closes. */
  onDismiss: () => void;
}

/** One bounded renderer slot, docked for stills or shown over a tile or in the large popover. */
export function ObjectPreviewSlot({ job, display, generation, onDismiss }: ObjectPreviewSlotProps) {
  const key = job?.key ?? null;
  /* Incremented when the slot takes a new key, so a key assigned again ignores its last outcome. */
  const [run, setRun] = useState({ key, count: 0 });
  if (run.key !== key) setRun({ key, count: run.count + 1 });
  const request = `${generation}:${run.count}:${key}`;
  const current = useRef(request);
  const dock = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  // A stable portal host keeps the renderer mounted when it moves between the dock, a tile and the popover.
  const [surface] = useState(() => {
    const element = document.createElement("div");
    element.className = "pointer-events-none absolute inset-0 size-full";
    element.setAttribute("aria-hidden", "true");
    return element;
  });
  const [settled, setSettled] = useState<{ request: string; kind: PreviewOutcome["kind"] } | null>(
    null,
  );
  const shown = settled?.request === request ? settled.kind : null;

  useLayoutEffect(() => {
    current.current = request;
  }, [request]);

  useLayoutEffect(() => {
    let parent: HTMLElement | null = dock.current;
    if (display.mode === "tile") parent = display.stage;
    if (display.mode === "large") parent = popup.current ?? dock.current;

    if (parent && surface.parentElement !== parent) {
      parent.appendChild(surface);
    }

    surface.style.opacity = shown === "image" ? "1" : "0";
  });
  useLayoutEffect(() => () => surface.remove(), [surface]);

  const report = useCallback(
    (outcome: PreviewOutcome) => {
      if (key === null || current.current !== request) return;

      setSettled({ request, kind: outcome.kind });
      savePreviewOutcome(key, outcome);
    },
    [key, request],
  );

  useEffect(() => {
    if (key === null || shown !== null) return;

    const timer = window.setTimeout(() => report(FAILED_OUTCOME), JOB_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [key, shown, report]);

  const large = display.mode === "large" ? display : null;
  const drawing = shown !== "failed" && shown !== "empty";

  return (
    <>
      <div
        ref={dock}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 w-48 overflow-hidden opacity-0"
        style={{ aspectRatio: "1 / 0.72" }}
      />
      <Popover.Root
        open={large !== null}
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={large?.anchor ?? null}
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={12}
          >
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              aria-label={job?.node.name}
              className="w-96 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl"
            >
              <div className="border-b border-surface-veil-strong px-3 py-2 text-row font-medium text-surface-100">
                {job?.node.name}
              </div>
              <div
                ref={(element) => {
                  popup.current = element;
                  if (element && large !== null) element.appendChild(surface);
                }}
                className="relative aspect-[1/0.72] bg-surface-950/40"
              >
                {shown === null && <PopupStatus label={m.workshop_objects_loading_label()} />}
                {shown === "failed" && (
                  <PopupStatus label={m.workshop_objects_preview_failed_label()} />
                )}
                {shown === "empty" && (
                  <PopupStatus label={m.workshop_objects_preview_empty_label()} />
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {createPortal(
        <ErrorBoundary key={generation} fallback={() => null}>
          <Suspense fallback={null}>
            <ObjectPreviewWorker
              node={drawing ? (job?.node ?? null) : null}
              playing={display.mode !== "dock"}
              onOutcome={report}
            />
          </Suspense>
        </ErrorBoundary>,
        surface,
      )}
    </>
  );
}

function PopupStatus({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="absolute inset-0 grid place-items-center text-meta text-surface-400"
    >
      {label}
    </span>
  );
}
