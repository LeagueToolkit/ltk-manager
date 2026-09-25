import { useEffect, useState } from "react";

import { useOptionalProjectContext } from "../../projects/state/ProjectContext";

/** The token a preview canvas clears to. A still contains this colour. */
const GROUND_TOKEN = "--color-surface-900";

/** Root attributes whose changes can change the token: the theme and the accent. */
const THEMED = ["data-theme", "style", "class"];

function readGround(): string {
  return getComputedStyle(document.documentElement).getPropertyValue(GROUND_TOKEN).trim();
}

/**
 * The part of a still key that is not the object: the project and the ground colour.
 *
 * A game chunk renders with the project's declarations, and the canvas clears to the
 * theme's ground colour. A still from another project or theme is not reused.
 */
export function usePreviewScope(): string {
  const project = useOptionalProjectContext()?.path ?? "";
  const [ground, setGround] = useState(readGround);

  useEffect(() => {
    const observer = new MutationObserver(() => setGround(readGround()));
    observer.observe(document.documentElement, { attributeFilter: THEMED });
    return () => observer.disconnect();
  }, []);

  return `${project}|${ground}`;
}
