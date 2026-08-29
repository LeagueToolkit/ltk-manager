import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
} from "react";

import { Dialog } from "@/components";
import { useModHealthDrawerStore } from "@/stores";

import { ModHealthSweepPanel } from "./ModHealthSweepPanel";

interface ModHealthSweepDrawerProps {
  open: boolean;
  onClose: () => void;
}

const MIN_WIDTH = 280;
/** What the sheet leaves of the library it covers. */
const GRID_KEPT = 320;
/** How far one arrow key moves the edge. */
const KEY_STEP = 16;

/**
 * What the sweep found, as a sheet down the right of the library.
 *
 * The panel is [`ModHealthSweepPanel`], which `ModHealthSweepDialog` also draws.
 * What this shell adds is the edge it arrives from and the handle that resizes
 * it, and neither survives the move to the middle of the screen.
 */
export function ModHealthSweepDrawer({ open, onClose }: ModHealthSweepDrawerProps) {
  const width = useModHealthDrawerStore((s) => s.width);
  const setWidth = useModHealthDrawerStore((s) => s.setWidth);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function resize(next: number) {
    const ceiling = Math.max(MIN_WIDTH, window.innerWidth - GRID_KEPT);
    setWidth(Math.round(Math.max(MIN_WIDTH, Math.min(next, ceiling))));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    resize(drag.current.startWidth - (event.clientX - drag.current.startX));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resize(width + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Focus starts on the panel, not on its first tab stop. That stop is the
            resize handle, which would open the drawer with a lit bar down its
            edge and nothing saying why. */}
        <Dialog.Sheet
          ref={panel}
          side="right"
          initialFocus={panel}
          data-ui="ModHealthSweepDrawer"
          aria-label="What the check found"
          style={{ width }}
          className="inset-y-3 right-3 overflow-hidden rounded-xl border border-surface-600"
        >
          <ModHealthSweepPanel onClose={onClose} />

          {/* Last, so the tab order is the list and its presses before the one
              control that only changes the shape of the panel. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the drawer"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={handleKeys}
            className="group/handle absolute inset-y-6 left-0 z-10 w-1.5 cursor-col-resize outline-none"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover/handle:bg-accent-500/60 group-focus-visible/handle:bg-accent-500"
            />
          </div>
        </Dialog.Sheet>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
