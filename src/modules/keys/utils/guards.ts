import { isOverlayOpen } from "@/utils";

import type { ScopeId } from "./scopes";

/** A fact about the press or the app that a binding can require or exclude. */
export type GuardName = "typing" | "overlay" | "keyedControl" | "project" | "dev";

/** A guard that must hold, or with `!` one that must not, for a binding to take a press. */
export type Guard = GuardName | `!${GuardName}`;

/** What a guard reads: the press and the scopes that are active for it. */
export interface GuardContext {
  readonly event: Pick<KeyboardEvent, "key" | "target">;
  readonly scopes: ReadonlySet<ScopeId>;
}

/** Fields that take typing. A slider is a keyed control instead. */
const EDITABLE = [
  "input:not([type='range'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='spinbutton']",
  "[role='combobox']",
].join(", ");

/** Controls whose keys are the arrows, Space and Enter. */
const KEYED_CONTROLS = [
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
].join(", ");

const SLIDER = "input[type='range'], [role='slider']";

/** The keys a slider moves by. It passes every other key on. */
const SLIDER_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Returns `true` if `target` takes typed text, which keeps every key that it receives. */
export function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;

  return target.closest(EDITABLE) !== null;
}

/** Returns `true` if the focused control uses `event`'s key itself: a tab, a menu item, a slider. */
export function keyedControl(event: Pick<KeyboardEvent, "key" | "target">): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(KEYED_CONTROLS) !== null) return true;

  return target.closest(SLIDER) !== null && SLIDER_KEYS.has(event.key);
}

/** Returns `true` if the palette's box has the caret. The palette is a combobox, not a dialog. */
function paletteHasCaret(): boolean {
  const focused = document.activeElement;

  return focused instanceof Element && focused.closest("[role='combobox']") !== null;
}

const FACTS: Readonly<Record<GuardName, (context: GuardContext) => boolean>> = {
  typing: ({ event }) => typesText(event.target),
  overlay: () => isOverlayOpen() || paletteHasCaret(),
  keyedControl: ({ event }) => keyedControl(event),
  project: ({ scopes }) => scopes.has("project"),
  dev: () => import.meta.env.DEV,
};

/** Returns the name of `guard` and whether the guard requires the fact to hold. */
export function guardFact(guard: Guard): { name: GuardName; holds: boolean } {
  if (guard.startsWith("!")) return { name: guard.slice(1) as GuardName, holds: false };

  return { name: guard as GuardName, holds: true };
}

/** Returns `true` if every guard of `guards` holds in `context`. */
export function guardsHold(guards: readonly Guard[], context: GuardContext): boolean {
  return guards.every((guard) => {
    const { name, holds } = guardFact(guard);

    return FACTS[name](context) === holds;
  });
}
