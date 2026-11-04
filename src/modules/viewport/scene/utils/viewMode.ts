import { type Color, LineBasicMaterial, type Material } from "three";

/**
 * How a viewport draws its meshes: lit, unlit, lit without textures, as edges alone, or by
 * the ground height against a navigation grid.
 */
export type ViewMode = "lit" | "unshaded" | "untextured" | "wireframe" | "conformance";

/** The modes in the order a menu lists them, for a viewport without a navigation grid. */
export const VIEW_MODES: readonly ViewMode[] = ["lit", "unshaded", "untextured", "wireframe"];

/** The modes in the order a menu lists them, for a viewport with a navigation grid. */
const NAV_GRID_VIEW_MODES: readonly ViewMode[] = [...VIEW_MODES, "conformance"];

/** Returns the modes that a viewport offers. `conformance` is offered only with a navigation grid. */
export function viewModesOf(navGrid: boolean): readonly ViewMode[] {
  return navGrid ? NAV_GRID_VIEW_MODES : VIEW_MODES;
}

/** Returns `mode` if a viewport offers it, and `lit` if it does not. */
export function offeredViewMode(mode: ViewMode, navGrid: boolean): ViewMode {
  return viewModesOf(navGrid).includes(mode) ? mode : "lit";
}

/** Which triangle edges a viewport draws: none, alone in place of the surfaces, or over them. */
export type Edges = "none" | "alone" | "over";

/**
 * What a mesh's surfaces draw with: its own materials, its textures without light, a flat
 * neutral under light, or a color by the height difference to a navigation grid under light.
 */
export type Surface = "material" | "unlit" | "untextured" | "conformance";

/** How much of the shading an edge drawn over it covers, which leaves the surface readable. */
export const EDGE_OVERLAY_OPACITY = 0.6;

/** Whether `mode` draws the solid surfaces at all. */
export function drawsSolids(mode: ViewMode): boolean {
  return mode !== "wireframe";
}

/**
 * Whether the navgrid projection draws over `mode`. `wireframe` draws no surface to tint, and
 * `conformance` already colors the surfaces by the navgrid.
 */
export function drawsNavProjection(mode: ViewMode): boolean {
  return mode !== "wireframe" && mode !== "conformance";
}

/** Whether the wireframe overlay draws over `mode`. */
export function takesWireOverlay(mode: ViewMode): boolean {
  return mode === "lit" || mode === "untextured";
}

/** The edges `mode` draws, with the wireframe overlay on or off. */
export function edgesOf(mode: ViewMode, overlay: boolean): Edges {
  if (mode === "wireframe") return "alone";
  return overlay && takesWireOverlay(mode) ? "over" : "none";
}

/** What `mode` draws a surface with. Every surface but `material` bypasses the game's shaders. */
export function surfaceOf(mode: ViewMode): Surface {
  if (mode === "unshaded") return "unlit";
  if (mode === "untextured") return "untextured";
  if (mode === "conformance") return "conformance";
  return "material";
}

/** The key every overlay edge material shares. All of them draw with one program. */
const OVERLAY_PROGRAM_KEY = "edge-overlay-1";

/* An edge lies exactly on its surface, and the two rasterize to different depths along it, which
   stipples the line. The overlay reads its depth a little nearer the eye, by a share of the
   distance so the pull holds at any zoom, and x and y stay put under either camera. A mesh's mean
   edge fades the overlay once its edges crowd together on screen, which would tint the surface
   solid. 1080 is a reference height rather than the canvas's, which only moves where the fade
   begins. */
const OVERLAY_VERTEX_DECLARATIONS = /* glsl */ `
uniform float edgeSpacing;
varying float vEdgeFade;
`;

const PULL_VERTEX = /* glsl */ `
vec4 edgePulled = projectionMatrix * vec4( mvPosition.xyz * 0.999, 1.0 );
gl_Position.z = edgePulled.z / edgePulled.w * gl_Position.w;
`;

const OVERLAY_VERTEX = /* glsl */ `${PULL_VERTEX}
float edgeDistance = isOrthographic ? 1.0 : max( -mvPosition.z, 0.001 );
float edgePixels = edgeSpacing * projectionMatrix[ 1 ][ 1 ] * 540.0 / edgeDistance;
vEdgeFade = mix( 0.2, 1.0, smoothstep( 2.0, 10.0, edgePixels ) );
`;

const OVERLAY_FRAGMENT = /* glsl */ `
diffuseColor.a *= vEdgeFade;
`;

/** The program cache key of every material that `pullDepthToEye` changes. */
const PULLED_PROGRAM_KEY = "edge-pulled-1";

/**
 * Makes `material` read its depth a little nearer the eye, so lines drawn on their own surface
 * pass the depth test without stippling and stay hidden behind other surfaces. Returns
 * `material`.
 */
export function pullDepthToEye<M extends Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>${PULL_VERTEX}`,
    );
  };
  material.customProgramCacheKey = () => PULLED_PROGRAM_KEY;
  return material;
}

/**
 * Returns the flat material that a mesh's `edges` draw in, where `spacing` is the mesh's mean
 * edge length.
 *
 * Part transparent over the shading, and without depth writes there so the surface under
 * an edge keeps its own depth. The colour stays the token's, outside the tone map.
 */
export function createEdgeMaterial(
  colour: Color,
  edges: Exclude<Edges, "none">,
  spacing: number,
): LineBasicMaterial {
  const overlay = edges === "over";
  const material = new LineBasicMaterial({
    color: colour,
    transparent: overlay,
    opacity: overlay ? EDGE_OVERLAY_OPACITY : 1,
    depthWrite: !overlay,
    toneMapped: false,
  });
  if (!overlay) return material;

  const edgeSpacing = { value: spacing };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.edgeSpacing = edgeSpacing;
    shader.vertexShader = `${OVERLAY_VERTEX_DECLARATIONS}${shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>${OVERLAY_VERTEX}`,
    )}`;
    shader.fragmentShader = `varying float vEdgeFade;\n${shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `${OVERLAY_FRAGMENT}#include <opaque_fragment>`,
    )}`;
  };
  material.customProgramCacheKey = () => OVERLAY_PROGRAM_KEY;
  return material;
}
