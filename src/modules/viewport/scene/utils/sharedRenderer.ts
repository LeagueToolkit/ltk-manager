import { type RenderItem, WebGLRenderer, type WebGLRendererParameters } from "three";

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
 * The `userData` key of an object whose geometry groups are listed nearest first: its
 * opaque groups are drawn in that order and its blended groups by tier, then in the reverse,
 * which [`opaqueOrder`] and [`transparentOrder`] read.
 */
export const KEEPS_GROUP_ORDER = "keepsGroupOrder";

/** A geometry group of an object under [`KEEPS_GROUP_ORDER`], with its place in the list. */
export interface OrderedGroup {
  start: number;
  count: number;
  materialIndex?: number;
  /** The index of the group in the geometry's list, which the owner writes. */
  order?: number;
  /** The blend tier of the group's material, lower drawn first. Read for a blended group only. */
  tier?: number;
}

/** The id ThreeJS gives every material, which its typings leave out. */
function materialId({ material }: RenderItem): number {
  return (material as RenderItem["material"] & { readonly id: number }).id;
}

function keepsGroupOrder({ object }: RenderItem): boolean {
  return object.userData[KEEPS_GROUP_ORDER] === true;
}

/**
 * The order of two opaque draws: ThreeJS's own order, except for an object under
 * [`KEEPS_GROUP_ORDER`].
 *
 * ThreeJS orders opaque draws by material before depth, and every group of one object has
 * the object's depth, so the groups of a map backdrop would be drawn in material order.
 * The groups of a flagged object compare equal, and the sort is stable, so they keep the
 * order of the geometry, which the backdrop writes nearest first. A flagged object is
 * ordered ahead of the unflagged objects of its render order, so that the comparison stays
 * a total order.
 */
export function opaqueOrder(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;

  const keptA = keepsGroupOrder(a);
  const keptB = keepsGroupOrder(b);
  if (keptA !== keptB) return keptA ? -1 : 1;
  if (keptA) return a.object.id - b.object.id;

  if (materialId(a) !== materialId(b)) return materialId(a) - materialId(b);
  if (a.materialVariant !== b.materialVariant) return a.materialVariant - b.materialVariant;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

/**
 * The order of two blended draws: ThreeJS's own order, except that the groups of one
 * object under [`KEEPS_GROUP_ORDER`] are drawn by `tier`, lowest first, and within a tier
 * last listed first.
 *
 * A blended surface has to be drawn over what is behind it, so the groups that the owner
 * lists nearest first are drawn farthest first. ThreeJS's own order leaves the groups of
 * one object equal, so the tiers and the reversal move no other draw.
 */
export function transparentOrder(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  if (a.id !== b.id) return a.id - b.id;
  if (!keepsGroupOrder(a)) return 0;

  const groupA = a.group as OrderedGroup | null;
  const groupB = b.group as OrderedGroup | null;
  const tierA = groupA?.tier ?? 0;
  const tierB = groupB?.tier ?? 0;
  if (tierA !== tierB) return tierA - tierB;

  return (groupB?.order ?? 0) - (groupA?.order ?? 0);
}

/**
 * A renderer on a multisampled drawing buffer with a stencil buffer and no alpha channel.
 *
 * ThreeJS asks the canvas for an alpha channel whatever its own `alpha` says, and a
 * compositor then shows the pane through wherever a blend left the alpha short of one.
 * A character outline's shell is under a pixel wide, which breaks up at one sample and which no
 * pass over the finished frame can repair. A particle emitter's `stencilMode` tests and writes
 * the stencil buffer. Its draws are ordered by [`opaqueOrder`] and [`transparentOrder`].
 */
export function createOpaqueRenderer(
  canvas: HTMLCanvasElement,
  powerPreference?: WebGLRendererParameters["powerPreference"],
): WebGLRenderer {
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    stencil: true,
    powerPreference,
  });
  const renderer = new WebGLRenderer({ canvas, context: context ?? undefined });
  renderer.setOpaqueSort(opaqueOrder);
  renderer.setTransparentSort(transparentOrder);
  return renderer;
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
