import { Accordion } from "@base-ui/react/accordion";
import { CaretRightIcon } from "@phosphor-icons/react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { twMerge } from "tailwind-merge";

import { useResizeObserver } from "@/hooks";

export interface SidePanelSection {
  id: string;
  title: string;
  /** Sits after the title - a count, a size, anything qualifying the section. */
  meta?: ReactNode;
  /** The section's own controls, in its header while it is hovered. */
  actions?: ReactNode;
  content: ReactNode;
  /** Smallest the panel can be dragged to, in px. */
  minHeight?: number;
  /** Sizes the section to its content rather than to a share, capped at this many px. */
  autoHeight?: number;
}

export interface SidePanelProps {
  sections: readonly SidePanelSection[];
  /** Sections currently open. Everything else shows as a header alone. */
  openIds: readonly string[];
  onToggle: (id: string) => void;
  /** Panel height per section, in px. The first open section that sizes itself fills what is left. */
  heights?: Readonly<Record<string, number>>;
  onResize?: (id: string, height: number) => void;
  className?: string;
}

/* What a header costs is measured off the DOM: the spacing scale is zoom-aware,
   so h-7 is 31.5px at 100% and more above it. This is the share-out's guess
   until the first measure lands. */
const HEADER_HEIGHT = 28;
const DEFAULT_PANEL_HEIGHT = 180;
const MIN_PANEL_HEIGHT = 64;
/** How far one arrow key moves a boundary. */
const KEY_STEP = 16;
/** How far a collapsed section has to be pulled open before it opens. */
const OPEN_AT = 24;

/**
 * A stack of collapsible sections, each sized by the boundary between them.
 *
 * A boundary sizes the section below it and everything above rides along,
 * so the grabbed edge tracks the pointer. The first open section that does not
 * size itself fills what the rest leave. Base UI drives the open state and the
 * enter/exit timing, and every panel carries a pixel height, so opening one is
 * two transitions of equal length whose heights add up to the room they share.
 */
export function SidePanel({
  sections,
  openIds,
  onToggle,
  heights = {},
  onResize,
  className,
}: SidePanelProps) {
  const drag = useRef<{ id: string; startY: number; startHeight: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [available, setAvailable] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(HEADER_HEIGHT);
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});

  const reportContentHeight = useCallback((id: string, height: number) => {
    setContentHeights((current) => {
      if (current[id] === height) return current;
      return { ...current, [id]: height };
    });
  }, []);

  const observeRoot = useResizeObserver<HTMLDivElement>((root) => setAvailable(root.clientHeight));
  const observeHeader = useResizeObserver<HTMLDivElement>((header) =>
    setHeaderHeight(header.getBoundingClientRect().height),
  );

  const openSections = sections.filter((section) => openIds.includes(section.id));
  const room = Math.max(0, available - sections.length * headerHeight);

  /* A self-sizing section stands outside the share-out, and it holds that height
     until a drag stores one, which hands it back to the boundaries. The cap stands
     in until the first measure lands, so the panel shrinks into place instead of
     growing out of nothing. */
  const autoHeights: Record<string, number> = {};
  for (const section of openSections) {
    if (section.autoHeight === undefined) continue;
    if (heights[section.id] !== undefined) continue;
    autoHeights[section.id] = Math.min(
      contentHeights[section.id] ?? section.autoHeight,
      section.autoHeight,
    );
  }

  const fillsId = openSections.find((section) => autoHeights[section.id] === undefined)?.id;
  const panelHeights = shareOut(openSections, heights, autoHeights, room);

  function handleValueChange(value: unknown[]) {
    for (const section of sections) {
      if (openIds.includes(section.id) !== value.includes(section.id)) onToggle(section.id);
    }
  }

  /* A boundary over a collapsed section belongs to it, so pulling one open is
     the same gesture as resizing it - it just has to clear OPEN_AT first. */
  function resize(section: SidePanelSection, height: number) {
    if (!openIds.includes(section.id)) {
      if (height < OPEN_AT) return;
      onToggle(section.id);
    }

    /* Only the filling section gives room. The rest keep the height they were
       dragged to, so the boundary stops where that section runs out rather than
       carrying on and pulling the others out of shape. */
    const fixed = openSections
      .filter((other) => other.id !== section.id)
      .reduce(
        (sum, other) => sum + (other.id === fillsId ? minHeightOf(other) : heightOf(other)),
        0,
      );

    const clamped = Math.max(minHeightOf(section), Math.min(height, room - fixed));
    onResize?.(section.id, Math.round(clamped));
  }

  function heightOf(section: SidePanelSection): number {
    if (!openIds.includes(section.id)) return 0;
    return panelHeights[section.id] ?? DEFAULT_PANEL_HEIGHT;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, section: SidePanelSection) {
    event.preventDefault();
    drag.current = {
      id: section.id,
      startY: event.clientY,
      startHeight: heightOf(section),
    };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const section = sections.find((candidate) => candidate.id === state?.id);
    if (!state || !section) return;
    resize(section, state.startHeight - (event.clientY - state.startY));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    setResizing(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleHandleKeys(event: ReactKeyboardEvent<HTMLDivElement>, section: SidePanelSection) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    // The accordion moves focus between headers on the same keys.
    event.stopPropagation();
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? KEY_STEP : -KEY_STEP;

    // One press cannot clear OPEN_AT, so a collapsed section opens at the height
    // it was left at instead of creeping there a step at a time.
    if (!openIds.includes(section.id)) {
      if (delta > 0) resize(section, heights[section.id] ?? DEFAULT_PANEL_HEIGHT);
      return;
    }

    resize(section, heightOf(section) + delta);
  }

  return (
    <Accordion.Root
      ref={observeRoot}
      multiple
      keepMounted
      value={[...openIds]}
      onValueChange={handleValueChange}
      className={twMerge("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      {sections.map((section, index) => {
        const open = openIds.includes(section.id);
        const above = sections
          .slice(0, index)
          .reverse()
          .find((candidate) => openIds.includes(candidate.id));

        return (
          <Accordion.Item key={section.id} value={section.id} className="flex shrink-0 flex-col">
            {/* The filling section takes what the others leave, so a boundary on it
                would have nothing of its own to move. */}
            {above && section.id !== fillsId && (
              <ResizeHandle
                section={section}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onKeyDown={handleHandleKeys}
              />
            )}

            {/* Every header is the same height, so the first one measures for all. */}
            <div
              ref={index === 0 ? observeHeader : null}
              data-ui={`SidePanel:${section.id}:header`}
              className={twMerge(
                "group/header flex h-7 shrink-0 items-center gap-1.5 border-surface-700/50 pr-1.5 pl-2",
                index > 0 && "border-t",
              )}
            >
              <Accordion.Header className="flex min-w-0 flex-1">
                <Accordion.Trigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500/60">
                  <CaretRightIcon
                    weight="bold"
                    className={twMerge(
                      "h-3 w-3 shrink-0 text-surface-400 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="truncate text-[11px] font-medium tracking-wide text-surface-300 uppercase">
                    {section.title}
                  </span>
                  {section.meta !== undefined && (
                    <span className="shrink-0 text-[11px] text-surface-400 tabular-nums">
                      {section.meta}
                    </span>
                  )}
                </Accordion.Trigger>
              </Accordion.Header>

              {/* Held visible while one of them has a popover open. */}
              {section.actions && (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
                  {section.actions}
                </div>
              )}
            </div>

            <Accordion.Panel
              style={{ "--panel-height": `${panelHeights[section.id] ?? 0}px` } as CSSProperties}
              className={twMerge(
                "h-[var(--panel-height)] overflow-hidden transition-[height] duration-200 ease-out",
                "data-[ending-style]:h-0 data-[starting-style]:h-0",
                resizing && "transition-none",
              )}
            >
              <div data-ui={`SidePanel:${section.id}`} className="h-full overflow-auto">
                <PanelContent section={section} onMeasure={reportContentHeight} />
              </div>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion.Root>
  );
}

function minHeightOf(section: SidePanelSection): number {
  return section.minHeight ?? MIN_PANEL_HEIGHT;
}

/* A window too short for what was dragged trims from the bottom up, one section
   to its minimum before the next gives anything. Trimming every section a little
   would leave the rendered heights adrift from the dragged ones, and a boundary
   that no longer tracks the pointer. */
function shareOut(
  openSections: readonly SidePanelSection[],
  heights: Readonly<Record<string, number>>,
  autoHeights: Readonly<Record<string, number>>,
  room: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const fills = openSections.find((section) => autoHeights[section.id] === undefined);

  const rest = openSections.filter((section) => section.id !== fills?.id);
  const wanted = rest.map(
    (section) =>
      autoHeights[section.id] ??
      Math.max(minHeightOf(section), heights[section.id] ?? DEFAULT_PANEL_HEIGHT),
  );

  const budget = Math.max(0, room - (fills ? minHeightOf(fills) : 0));
  let overflow = wanted.reduce((sum, height) => sum + height, 0) - budget;

  for (let index = wanted.length - 1; index >= 0 && overflow > 0; index--) {
    /* A self-sizing section has no dragged height to protect, so it gives all of it
       before a section someone placed by hand gives any. */
    const section = rest[index]!;
    const floor = autoHeights[section.id] === undefined ? minHeightOf(section) : 0;
    const give = Math.min(overflow, wanted[index]! - floor);
    wanted[index]! -= give;
    overflow -= give;
  }

  let used = 0;
  rest.forEach((section, index) => {
    out[section.id] = wanted[index]!;
    used += wanted[index]!;
  });

  if (fills) out[fills.id] = Math.max(minHeightOf(fills), room - used);
  return out;
}

interface PanelContentProps {
  section: SidePanelSection;
  onMeasure: (id: string, height: number) => void;
}

/* The scroll box above the content hides how tall the content wants to be, so a
   self-sizing section gets a node of its own to measure. */
function PanelContent({ section, onMeasure }: PanelContentProps) {
  const { id, autoHeight } = section;
  const observe = useResizeObserver<HTMLDivElement>((node) =>
    onMeasure(id, node.getBoundingClientRect().height),
  );

  if (autoHeight === undefined) return <>{section.content}</>;
  return <div ref={observe}>{section.content}</div>;
}

interface ResizeHandleProps {
  /** The section under the boundary. Everything above it moves as one stack. */
  section: SidePanelSection;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, section: SidePanelSection) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, section: SidePanelSection) => void;
}

/* Sits on the boundary rather than in it: the header below draws the line, and
   the handle is the grab area over it. */
function ResizeHandle({
  section,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${section.title}`}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(event, section)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(event) => onKeyDown(event, section)}
      className="group/handle relative z-10 -my-[3px] h-1.5 shrink-0 cursor-row-resize outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 transition-colors group-hover/handle:bg-accent-500/60 group-focus-visible/handle:bg-accent-500"
      />
    </div>
  );
}
