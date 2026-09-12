import type { EmitterGroup } from "./emitterGroups";

/** Where one section of the inspector stands on screen, in client pixels. */
export interface SectionSpan {
  readonly group: EmitterGroup;
  readonly top: number;
  readonly bottom: number;
}

/** Where the inspector's scrolling box stands, and whether it is scrolled as far as it goes. */
export interface PaneSpan {
  readonly top: number;
  readonly bottom: number;
  readonly atEnd: boolean;
}

/**
 * How far past the pane's top a section reaches to count as the one in view, in pixels.
 *
 * One field row's height. A section showing only its last row's tail hands the name on.
 */
const PROBE = 24;

/**
 * The group the inspector has in view, which the crumb's group segment names.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md. A section near the end cannot reach the top. At
 * the end of the scroll the aimed section keeps the name while it shows. Null before any
 * section has a height.
 */
export function groupInView(
  sections: readonly SectionSpan[],
  pane: PaneSpan,
  aimed: EmitterGroup | null,
): EmitterGroup | null {
  if (!sections.some((each) => each.bottom > each.top)) return null;

  if (pane.atEnd) {
    const held = sections.find((each) => each.group === aimed);
    if (held !== undefined && held.bottom > pane.top && held.top < pane.bottom) return held.group;
  }

  const reached = sections.find((each) => each.bottom > pane.top + PROBE);
  return (reached ?? sections.at(-1))?.group ?? null;
}
