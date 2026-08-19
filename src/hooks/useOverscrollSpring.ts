import { useEffect } from "react";

import { useDisplayStore } from "@/stores";

import { useReducedMotion } from "./useReducedMotion";

/** Spread on a scroll container, or anything above one, to opt out of the bounce. */
export const NO_OVERSCROLL = { "data-overscroll": "none" } as const;

/* Chromium on Windows has no rubber-banding, so the bounce is drawn by hand: a
   wheel event that pushes past a boundary is swallowed and turned into a damped
   translate on the container's contents, which springs back on release. */

/** Travel the band approaches but never reaches, however hard it is pulled. */
const MAX_OFFSET = 28;
/** Fraction of a wheel delta that becomes raw pull. */
const PULL = 0.1;
/** Share of the remaining distance the band covers each frame. */
const FOLLOW = 0.18;
/** Wheel quiet time that counts as letting go. */
const RELEASE_MS = 70;
/** Longest the band answers a run of pushes before it gives up on them. */
const MAX_HOLD_MS = 500;
/** Quiet needed before a spent run counts as over and the band re-arms. */
const REARM_MS = 400;

const SPRING_MS = 300;
/** Under 1 the spring overshoots rest, which is the counter-bounce you feel. */
const SPRING_DAMPING = 0.55;
/** Radians per second. Paired with the damping to settle inside `SPRING_MS`. */
const SPRING_FREQUENCY = 24;
const SPRING_STEPS = 30;

interface Overscroll {
  /** Undamped pull, so the band's travel stays a pure function of it. */
  raw: number;
  /** Where the pull says the band should be. */
  target: number;
  /** Where it has actually got to, chasing the target a frame at a time. */
  rendered: number;
  frame: number;
  /** When the current pull began, so it can be capped. Zero while at rest. */
  heldSince: number;
  /** Set when the cap fires, so the same run cannot immediately re-bounce. */
  spent: boolean;
  releaseTimer: number;
  rearmTimer: number;
  /** In-flight spring animations, cancelled when a new pull starts. */
  springs: Animation[];
}

/* Asymptotic rather than clamped: the band answers the first flick readily, then
   stiffens, and never hits a wall the pointer can feel. */
function bandOffset(raw: number): number {
  return MAX_OFFSET * Math.tanh(raw / MAX_OFFSET);
}

/* A damped harmonic oscillator, sampled. The curve carries the motion, so the
   animation itself runs linear - a cubic-bezier cannot cross its own end value
   and so cannot counter-bounce. */
function springFrames(from: number): Keyframe[] {
  const damped = SPRING_FREQUENCY * Math.sqrt(1 - SPRING_DAMPING * SPRING_DAMPING);
  const decay = SPRING_DAMPING * SPRING_FREQUENCY;
  const frames: Keyframe[] = [];

  for (let step = 0; step <= SPRING_STEPS; step++) {
    const progress = step / SPRING_STEPS;
    const t = progress * (SPRING_MS / 1000);
    const displacement =
      from *
      Math.exp(-decay * t) *
      (Math.cos(damped * t) + (decay / damped) * Math.sin(damped * t));
    frames.push({ transform: `translateY(${displacement.toFixed(2)}px)`, offset: progress });
  }

  frames[frames.length - 1] = { transform: "translateY(0px)", offset: 1 };
  return frames;
}

/* Whether an element scrolls is a style question and the answer effectively never
   changes, so it is asked once per element. The layout question - whether it has
   anything to scroll - is asked every time, and only of the elements that can. */
const scrolls = new WeakMap<HTMLElement, boolean>();

function scrollsVertically(node: HTMLElement): boolean {
  const known = scrolls.get(node);
  if (known !== undefined) return known;

  const overflow = getComputedStyle(node).overflowY;
  const answer = overflow === "auto" || overflow === "scroll";
  scrolls.set(node, answer);
  return answer;
}

function scrollableUnder(target: EventTarget | null): HTMLElement | null {
  let node = target instanceof Element ? target : null;

  while (node) {
    if (node instanceof HTMLElement) {
      if (node.dataset.overscroll === "none") return null;
      if (scrollsVertically(node) && node.scrollHeight > node.clientHeight) return node;
    }
    node = node.parentElement;
  }

  return null;
}

function contentsOf(el: HTMLElement): HTMLElement[] {
  return [...el.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
}

function draw(el: HTMLElement, offset: number) {
  for (const child of contentsOf(el)) {
    child.style.transform = `translateY(${offset.toFixed(2)}px)`;
  }
}

/**
 * Gives every scroll container an overscroll bounce.
 *
 * One delegated listener rather than a per-container hook, so a container added
 * later is covered without opting in - including the ones inside portalled
 * popovers and menus. Spread [`NO_OVERSCROLL`] on a container to opt it out.
 *
 * The listener sits on the document rather than on a mounted node, because the
 * root renders a spinner before its layout and would otherwise never bind. It
 * has to be non-passive to swallow a wheel event, which costs every scroll in
 * the app a trip through the main thread - so it binds only while the setting
 * asks for a bounce, rather than binding always and returning early.
 */
export function useOverscrollSpring() {
  const scrollMode = useDisplayStore((state) => state.scrollMode);
  const reducedMotion = useReducedMotion();
  const enabled = scrollMode === "spring" && !reducedMotion;

  useEffect(() => {
    if (!enabled) return;

    const states = new WeakMap<HTMLElement, Overscroll>();
    /* The container is resolved once per run of wheel events. A free-spinning
       wheel fires far faster than the pointer can leave the container it started
       in, and the walk is the expensive part of the handler. */
    let gesture: { el: HTMLElement; until: number } | null = null;

    /* Wheel events are sparse and land in jumps, so the band chases the pull
       across frames instead of snapping to each one as it arrives. */
    function follow(el: HTMLElement, state: Overscroll) {
      const remaining = state.target - state.rendered;

      if (Math.abs(remaining) < 0.1) {
        state.rendered = state.target;
        state.frame = 0;
      } else {
        state.rendered += remaining * FOLLOW;
        state.frame = requestAnimationFrame(() => follow(el, state));
      }

      draw(el, state.rendered);
    }

    function rearm(state: Overscroll) {
      state.heldSince = 0;
      state.spent = false;
    }

    /* The spring runs through the Web Animations API rather than a CSS
       transition: setting a transition and the transform it should animate in
       the same tick is not reliably picked up, which shows as a snap. */
    function release(el: HTMLElement, state: Overscroll) {
      const from = state.rendered;
      state.raw = 0;
      state.target = 0;
      state.rendered = 0;
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      window.clearTimeout(state.releaseTimer);
      if (from === 0) return;

      const frames = springFrames(from);
      state.springs = contentsOf(el).map((child) => {
        child.style.transform = "";
        return child.animate(frames, { duration: SPRING_MS, easing: "linear" });
      });
    }

    function onWheel(event: WheelEvent) {
      if (event.ctrlKey) return;

      const held =
        gesture &&
        event.timeStamp < gesture.until &&
        event.target instanceof Node &&
        gesture.el.contains(event.target);

      const el = held ? gesture!.el : scrollableUnder(event.target);
      if (!el) {
        gesture = null;
        return;
      }

      gesture = { el, until: event.timeStamp + RELEASE_MS };

      const state = states.get(el);
      const atTop = el.scrollTop <= 0;
      const atBottom = Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
      const pushingPast = (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);

      // Anything not pushing past a boundary is left to scroll natively. Owning
      // the wheel to unwind an existing bounce instead would stall the container
      // for as long as a free-spinning wheel keeps firing.
      if (!pushingPast) {
        if (state) {
          release(el, state);
          rearm(state);
        }
        return;
      }

      const next: Overscroll = state ?? {
        raw: 0,
        target: 0,
        rendered: 0,
        frame: 0,
        heldSince: 0,
        spent: false,
        releaseTimer: 0,
        rearmTimer: 0,
        springs: [],
      };
      states.set(el, next);

      // The run only ends on a real pause. Re-arming on the release timer instead
      // would restart the cap between every notch of a wheel, so it never counts.
      window.clearTimeout(next.rearmTimer);
      next.rearmTimer = window.setTimeout(() => rearm(next), REARM_MS);

      if (!next.spent) {
        if (next.heldSince === 0) next.heldSince = event.timeStamp;
        else if (event.timeStamp - next.heldSince > MAX_HOLD_MS) {
          next.spent = true;
          release(el, next);
        }
      }

      // Spent, so the band stays home for the rest of this run. The wheel is
      // left alone: at the boundary a native scroll moves nothing anyway.
      if (next.spent) return;

      event.preventDefault();

      for (const spring of next.springs) spring.cancel();
      next.springs = [];

      next.raw -= event.deltaY * PULL;
      next.target = bandOffset(next.raw);
      if (next.frame === 0) next.frame = requestAnimationFrame(() => follow(el, next));

      window.clearTimeout(next.releaseTimer);
      next.releaseTimer = window.setTimeout(() => release(el, next), RELEASE_MS);
    }

    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [enabled]);
}
