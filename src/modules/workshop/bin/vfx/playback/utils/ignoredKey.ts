import { keyedControl, typesText } from "@/modules/keys";

/**
 * Returns `true` if the focused control uses `event`'s key itself: a field, or a keyed control.
 *
 * The same test as the `typing` and `keyedControl` guards of the key registry, for a widget that
 * answers its keys in its own `onKeyDown`.
 */
export function ignoredKey(event: KeyboardEvent): boolean {
  return typesText(event.target) || keyedControl(event);
}
