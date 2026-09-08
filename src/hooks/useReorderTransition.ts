import { useEffect, useLayoutEffect, useRef } from "react";

import { useReducedMotion } from "./useReducedMotion";

const SLIDE_MS = 260;
const EASING = "cubic-bezier(0.25, 1, 0.5, 1)";

/** Past a screen's worth of travel a slide reads as a smear, so the card cuts. */
const MAX_SLIDE_PX = 1200;

/**
 * How long the offset is held after a reorder.
 *
 * Long enough to outlast a focus restore that runs a popover's close animation
 * out first, which is what a single frame of holding missed.
 */
const HOLD_MS = 450;

type Holder = () => void;
const holders = new Set<Holder>();

/**
 * Take every mounted list's scroll offset now, before the reorder that follows.
 *
 * A list syncs its order from props in an effect, so the DOM rearranges a paint
 * after the data changes and anything that moves the offset has already moved
 * it by then. Reading the offset at that point pins the jump instead of
 * undoing it, so the offset to hold is taken while the reader's own click is
 * still the last thing to have happened.
 */
export function beginReorderHold() {
  for (const hold of holders) hold();
}

/** The same children in a different order, which is the case worth handling. */
function isReorder(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length || before.length === 0) return false;
  if (before.every((id, index) => id === after[index])) return false;

  const members = new Set(before);
  return after.every((id) => members.has(id));
}

/** The nearest ancestor that scrolls, which is what a list is windowed against. */
export function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Pin `scroller` to `top` until the reader scrolls or the hold expires.
 *
 * Whatever moves the offset after a reorder - a focus restore, an anchoring
 * adjustment - does it on its own schedule, so the offset is re-asserted every
 * frame instead of once. "instant" over an assignment: [data-scroll-mode] puts
 * scroll-behavior: smooth on every element.
 */
function holdScroll(scroller: HTMLElement, top: number): () => void {
  const gestures = ["wheel", "touchstart", "keydown"] as const;
  let frame = 0;

  const release = () => {
    cancelAnimationFrame(frame);
    for (const gesture of gestures) scroller.removeEventListener(gesture, release);
  };

  const started = performance.now();
  const tick = () => {
    if (Math.abs(scroller.scrollTop - top) > 0.5) {
      scroller.scrollTo({ top, behavior: "instant" });
    }
    if (performance.now() - started < HOLD_MS) frame = requestAnimationFrame(tick);
    else release();
  };

  for (const gesture of gestures) {
    scroller.addEventListener(gesture, release, { passive: true });
  }
  scroller.scrollTo({ top, behavior: "instant" });
  frame = requestAnimationFrame(tick);

  return release;
}

/**
 * How far the content at the top of the viewport moved.
 *
 * The reader is looking at whatever sits under the scroller's top edge, so that
 * is what holds still. A child that travelled more than a viewport is the
 * promoted one rather than a neighbour closing a gap, and makes a poor anchor.
 */
function anchorShift(
  ids: readonly string[],
  wasAt: Map<string, number>,
  slots: readonly DOMRect[],
  scroller: HTMLElement,
): number {
  const edge = scroller.getBoundingClientRect().top;
  let nearest = Number.POSITIVE_INFINITY;
  let shift = 0;

  for (let index = 0; index < ids.length; index++) {
    const previousIndex = wasAt.get(ids[index]);
    if (previousIndex === undefined) continue;

    const from = slots[previousIndex];
    const to = slots[index];
    if (!from || !to) continue;

    const moved = to.top - from.top;
    if (Math.abs(moved) > scroller.clientHeight) continue;

    const distance = Math.abs(from.top - edge);
    if (distance < nearest) {
      nearest = distance;
      shift = moved;
    }
  }

  return shift;
}

/**
 * Slide a list's children from the slot they held to the one they hold now.
 *
 * Reordering moves the DOM nodes at once, which reads as a blink. Each child is
 * put back where the reader last saw it and animated forward, and the scroller
 * is offset so the card under the reader holds still while the list rearranges
 * around it. Children opt in with `data-flip-id`.
 *
 * Slot geometry is read once, after the change: a permutation leaves the slots
 * themselves where they were, so the rect now at a child's old index is where
 * that child came from.
 */
export function useReorderTransition<T extends HTMLElement>(active = true) {
  const container = useRef<T | null>(null);
  const previous = useRef<string[] | null>(null);
  const release = useRef<(() => void) | null>(null);
  const baseline = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const hold = () => {
      const node = container.current;
      const scroller = node && scrollerOf(node);
      if (!scroller) return;

      baseline.current = scroller.scrollTop;
      release.current?.();
      release.current = holdScroll(scroller, scroller.scrollTop);
    };

    holders.add(hold);
    return () => {
      holders.delete(hold);
    };
  }, []);

  useLayoutEffect(() => {
    const node = container.current;
    /* A drag re-renders on every pointer move and leaves the order alone, so
       measuring across it would cost a DOM read per frame for no change. */
    if (!node || !active) return;

    /* Descendants rather than children: a windowed list wraps each row, so the
       cards are a level down from the element the animation is mounted on. */
    const children = Array.from(node.querySelectorAll<HTMLElement>("[data-flip-id]"));
    const ids = children.map((child) => child.dataset.flipId as string);
    const before = previous.current;
    previous.current = ids;

    if (!before || !isReorder(before, ids)) return;

    const slots = children.map((child) => child.getBoundingClientRect());
    const wasAt = new Map(before.map((id, index) => [id, index]));

    const scroller = scrollerOf(node);
    if (scroller) {
      const from = baseline.current ?? scroller.scrollTop;
      baseline.current = null;
      release.current?.();
      release.current = holdScroll(scroller, from + anchorShift(ids, wasAt, slots, scroller));
    }

    if (reducedMotion || typeof node.animate !== "function") return;

    ids.forEach((id, index) => {
      const previousIndex = wasAt.get(id);
      if (previousIndex === undefined || previousIndex === index) return;

      const from = slots[previousIndex];
      const to = slots[index];
      if (!from || !to) return;

      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.hypot(dx, dy) > MAX_SLIDE_PX) return;

      children[index].animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
        { duration: SLIDE_MS, easing: EASING },
      );
    });
  });

  useEffect(() => () => release.current?.(), []);

  return container;
}
