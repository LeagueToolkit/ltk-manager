import { WebGLRenderer, type WebGLRendererParameters } from "three";

/**
 * Which renderer a viewport draws with.
 *
 * `shared` is one renderer handed between viewports, so whatever one of them uploaded,
 * such as a map backdrop, is already on the GPU when another opens. `own` is a context of
 * the viewport's own, torn down with it.
 */
export type RendererUse = "own" | "shared";

/** One viewport's claim on the shared renderer, and whether that viewport is drawing now. */
export interface RendererLease {
  running: boolean;
}

let shared: WebGLRenderer | null = null;
let holder: RendererLease | null = null;

/**
 * A renderer on a drawing buffer with no alpha channel and no multisampling.
 *
 * ThreeJS asks the canvas for an alpha channel whatever its own `alpha` says, and a
 * compositor then shows the pane through wherever a blend left the alpha short of one.
 * The game draws its frame with one sample and smooths it afterwards, which
 * `AntiAliasingPass` does here.
 */
export function createOpaqueRenderer(
  canvas: HTMLCanvasElement,
  powerPreference?: WebGLRendererParameters["powerPreference"],
): WebGLRenderer {
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    stencil: false,
    powerPreference,
  });
  return new WebGLRenderer({ canvas, context: context ?? undefined });
}

/**
 * The shared renderer, taken for `lease`, and null while another running viewport draws with it.
 *
 * A viewport that stopped running keeps its scene but gives the renderer up to the next
 * viewport that asks.
 */
export function takeSharedRenderer(lease: RendererLease): WebGLRenderer | null {
  if (holder !== null && holder !== lease && holder.running) return null;

  holder = lease;
  return sharedRenderer();
}

/** Whether `lease` is the one the shared renderer draws for now. */
export function holdsSharedRenderer(lease: RendererLease): boolean {
  return holder === lease;
}

/** Give the shared renderer up, where `lease` holds it. */
export function releaseSharedRenderer(lease: RendererLease): void {
  if (holder === lease) holder = null;
}

/** The renderer every sharing viewport draws with, created on the first ask. */
export function sharedRenderer(
  powerPreference?: WebGLRendererParameters["powerPreference"],
): WebGLRenderer {
  if (shared !== null) return shared;

  const canvas = document.createElement("canvas");
  canvas.dataset.ui = "SharedRenderer";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";

  shared = createOpaqueRenderer(canvas, powerPreference);
  /* The fibre ends the context of every root it unmounts, and this one outlives them. */
  shared.forceContextLoss = () => {};
  return shared;
}
