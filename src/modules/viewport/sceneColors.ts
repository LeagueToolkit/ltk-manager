import { useEffect, useState } from "react";
import { Color } from "three";

/** The tokens the stage draws with, each read off the root the theme is stamped on. */
const TOKENS = {
  /* The pane's own ground, which the canvas clears to rather than showing through. */
  backdrop: "--color-surface-950",
  ground: "--color-surface-900",
  grid: "--color-surface-700",
  gridMajor: "--color-surface-600",
  axisX: "--color-channel-1",
  axisY: "--color-channel-2",
  axisZ: "--color-channel-3",
  /* The selected emitter's wireframe, which is a reader's own mark on the scene. */
  gizmo: "--color-accent-400",
  /* A label written on the scene's own chrome, which is the view cube's faces. */
  ink: "--color-surface-100",
  /* The run's triangle edges in the wireframe modes, a step lighter than the gizmo. */
  wire: "--color-accent-300",
  /* A character's submesh no texture reaches. */
  untextured: "--color-surface-500",
  /* A character's submesh whose material link resolves to nothing. */
  errored: "--color-danger",
} as const;

/** What the grid, the ground, the gizmo and an untextured mesh are painted in. */
export type SceneColors = Record<keyof typeof TOKENS, Color>;

/** What a token that resolves to nothing draws as, so the stage still reads. */
const UNRESOLVED = 0x808080;

/**
 * The stage's colours, out of the design system's own tokens (DS-TOKEN).
 *
 * A canvas reads no stylesheet, so the tokens are resolved off the root element the
 * theme is stamped on and handed to the materials as values.
 *
 * They are resolved by painting rather than parsed: the tokens are `oklch()` around a
 * `calc()`, which `THREE.Color` reads as neither a colour nor an error and leaves white.
 * A 2D context takes whatever CSS the browser itself parses and answers sRGB bytes.
 */
export function sceneColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const paint = painter();
  const read = (token: string) => paint(style.getPropertyValue(token).trim());

  return {
    backdrop: read(TOKENS.backdrop),
    ground: read(TOKENS.ground),
    grid: read(TOKENS.grid),
    gridMajor: read(TOKENS.gridMajor),
    axisX: read(TOKENS.axisX),
    axisY: read(TOKENS.axisY),
    axisZ: read(TOKENS.axisZ),
    gizmo: read(TOKENS.gizmo),
    ink: read(TOKENS.ink),
    wire: read(TOKENS.wire),
    untextured: read(TOKENS.untextured),
    errored: read(TOKENS.errored),
  };
}

/**
 * A reader that turns one CSS colour into a `THREE.Color`.
 *
 * `fillStyle` keeps its last value where the assignment names no colour, so the
 * sentinel is what says a token resolved to nothing this build can paint.
 */
function painter(): (css: string) => Color {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (context === null) return () => new Color(UNRESOLVED);

  return (css) => {
    if (css === "") return new Color(UNRESOLVED);
    context.fillStyle = SENTINEL;
    context.fillStyle = css;
    if (context.fillStyle === SENTINEL) return new Color(UNRESOLVED);

    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return new Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
  };
}

/** A colour no token resolves to, which is how a refused assignment is told apart. */
const SENTINEL = "#010203";

/** What the root carries that moves a token: the theme, and the accent written on it. */
const THEMED = ["data-theme", "style", "class"];

/** The stage's colours, re-read whenever the theme or the accent moves under them. */
export function useSceneColors(): SceneColors {
  const [colors, setColors] = useState(sceneColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(sceneColors()));
    observer.observe(document.documentElement, { attributeFilter: THEMED });
    return () => observer.disconnect();
  }, []);

  return colors;
}
