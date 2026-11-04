/**
 * Builds the navgrid projection of the backdrop, which tints the map's own surfaces from above by
 * the color of the navigation grid cell under each fragment. Per section 3.6 of
 * docs/plans/navgrid-guides.md.
 */

import {
  Color,
  DataTexture,
  DoubleSide,
  type IUniform,
  KeepStencilOp,
  LessEqualDepth,
  MeshBasicMaterial,
  NearestFilter,
  NotEqualStencilFunc,
  RedFormat,
  ReplaceStencilOp,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector2,
} from "three";

import type { MaterialPreview } from "@/lib/tauri";

import type { NavGrid } from "../../assets/parsing/navGridBuffer";
import type { NavGridColorConfig, NavGridColorMode } from "../../assets/parsing/navGridColors";

/** What the backdrop projects onto the map: a grid's cells, their colors and the cutoff. */
export interface NavProjection {
  /** The grid with the overlays that are on, whose cells color the map. */
  readonly grid: NavGrid;
  readonly config: NavGridColorConfig;
  readonly mode: NavGridColorMode;
  /**
   * The largest height above the navgrid at which a surface takes the tint, in world units, and
   * null for no limit.
   */
  readonly cutoff: number | null;
  /** The selected cells, by `x`, `y`, which draw an outline. */
  readonly selected: readonly (readonly [number, number])[];
  /** The color of a selected cell's outline. */
  readonly highlight: Color;
}

/** The uniforms of one backdrop's projection material. */
export interface NavProjectionUniforms {
  /** One RGBA8 texel per cell, texel `x`, `y` for cell `x`, `y`. */
  readonly navCells: IUniform<DataTexture | null>;
  /** One R8 texel per cell, 255 for a selected cell. */
  readonly navSelected: IUniform<DataTexture | null>;
  /** The world `x` and `z` of the first cell's corner. */
  readonly navCellOrigin: IUniform<Vector2>;
  /** The world units that the cells cover along `x` and `z`. */
  readonly navCellSpan: IUniform<Vector2>;
  readonly navCellCount: IUniform<Vector2>;
  readonly navHighlight: IUniform<Color>;
  /** The cutoff in world units, and -1 for no cutoff. */
  readonly navCutoff: IUniform<number>;
  /** The `R32F` height samples, null while the cutoff is off. */
  readonly navHeights: IUniform<DataTexture | null>;
  /** The world `x` and `z` of the first height sample. */
  readonly navHeightOrigin: IUniform<Vector2>;
  /** The world units between two samples along `x` and `z`. */
  readonly navHeightSpacing: IUniform<Vector2>;
  /** The index of the last sample along `x` and `z`. */
  readonly navHeightLast: IUniform<Vector2>;
}

/** The alpha byte of every cell texel, which draws the tint at 50% opacity. */
export const NAV_PROJECTION_ALPHA = 128;

/** The key that every projection material shares. All of them draw with one program. */
const PROGRAM_KEY = "nav-projection-1";

/** The cutoff uniform's value while no cutoff applies. */
const NO_CUTOFF = -1;

/**
 * The stencil bit of a pixel that took the tint in this frame. Particle masks use the six low
 * bits (`STENCIL_BITS` of the VFX stencil state), and the renderer clears the stencil per frame.
 */
const TINTED = 0x80;

/** The material of a group that the projection leaves out, which the renderer never draws. */
export const SKIPPED_PROJECTION = new MeshBasicMaterial({ visible: false });

/* A face fades out between a normal `y` of `NAV_WALL` and `NAV_GROUND`, so walls and cliffs do
   not smear one cell's color down their height. A selected cell's outline is
   `NAV_OUTLINE_PIXELS` wide on screen at any zoom. */
const SHADER_DECLARATIONS = /* glsl */ `
const float NAV_WALL = 0.2;
const float NAV_GROUND = 0.5;
const float NAV_OUTLINE_PIXELS = 2.0;
uniform sampler2D navCells;
uniform sampler2D navSelected;
uniform vec2 navCellOrigin;
uniform vec2 navCellSpan;
uniform vec2 navCellCount;
uniform vec3 navHighlight;
uniform float navCutoff;
uniform highp sampler2D navHeights;
uniform vec2 navHeightOrigin;
uniform vec2 navHeightSpacing;
uniform vec2 navHeightLast;
uniform float navAlphaTest;
`;

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vNavPosition;
varying float vNavUp;
`;

/* The mesh draws in the engine's space inside the mirrored group, so its own position and
   normal are the engine's and no mirror has to be undone. The normal is the stored one, not the
   one facing the camera, so a face that points down never takes the tint from either side. */
const VERTEX = /* glsl */ `
vNavPosition = transformed;
vNavUp = normal.y;
`;

/* The derivative is taken before any branch, where every fragment of the quad still runs it.
   WebGL2 does not filter a 32-bit float texture without an extension, so the height reads the
   four samples around it and interpolates them as `sampledHeightAt` does. */
const FRAGMENT_FUNCTIONS = /* glsl */ `
float navHeight( ivec2 at ) {
  return texelFetch( navHeights, at, 0 ).r;
}

bool navAboveCutoff() {
  if ( navCutoff < 0.0 ) {
    return false;
  }

  vec2 position = ( vNavPosition.xz - navHeightOrigin ) / navHeightSpacing;
  if ( any( lessThan( position, vec2( 0.0 ) ) ) || any( greaterThan( position, navHeightLast ) ) ) {
    return false;
  }

  ivec2 last = ivec2( navHeightLast );
  ivec2 first = min( ivec2( floor( position ) ), last );
  ivec2 second = min( first + 1, last );
  vec2 weight = position - vec2( first );
  float nearRow = mix( navHeight( first ), navHeight( ivec2( second.x, first.y ) ), weight.x );
  float farRow = mix( navHeight( ivec2( first.x, second.y ) ), navHeight( second ), weight.x );
  return vNavPosition.y - mix( nearRow, farRow, weight.y ) > navCutoff;
}

vec4 navProjectionColor() {
  vec2 uv = ( vNavPosition.xz - navCellOrigin ) / navCellSpan;
  vec2 cell = uv * navCellCount;
  vec2 cellPixels = max( fwidth( cell ), vec2( 1e-6 ) );

  if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThanEqual( uv, vec2( 1.0 ) ) ) ) {
    discard;
  }

  float facing = smoothstep( NAV_WALL, NAV_GROUND, vNavUp );
  if ( facing <= 0.0 || navAboveCutoff() ) {
    discard;
  }

  ivec2 at = min( ivec2( cell ), ivec2( navCellCount ) - 1 );
  vec4 tint = texelFetch( navCells, at, 0 );
  if ( texelFetch( navSelected, at, 0 ).r > 0.5 ) {
    vec2 inside = fract( cell );
    vec2 edge = min( inside, 1.0 - inside ) / cellPixels;
    if ( min( edge.x, edge.y ) < NAV_OUTLINE_PIXELS ) {
      tint = vec4( navHighlight, 1.0 );
    }
  }

  return vec4( tint.rgb, tint.a * facing );
}
`;

/* `diffuseColor.a` is the base texel's alpha of a masked material and 1 otherwise. */
const FRAGMENT = /* glsl */ `
float navSurfaceAlpha = diffuseColor.a;
diffuseColor = navProjectionColor();
if ( navSurfaceAlpha < navAlphaTest ) {
  discard;
}
`;

/** Returns the uniforms of one backdrop's projection material, with no grid set. */
export function createNavProjectionUniforms(): NavProjectionUniforms {
  return {
    navCells: { value: null },
    navSelected: { value: null },
    navCellOrigin: { value: new Vector2() },
    navCellSpan: { value: new Vector2(1, 1) },
    navCellCount: { value: new Vector2(1, 1) },
    navHighlight: { value: new Color() },
    navCutoff: { value: NO_CUTOFF },
    navHeights: { value: null },
    navHeightOrigin: { value: new Vector2() },
    navHeightSpacing: { value: new Vector2(1, 1) },
    navHeightLast: { value: new Vector2() },
  };
}

/** The textures that the projection reads, apart from the projection's own fields. */
export interface NavProjectionTextures {
  readonly cells: DataTexture;
  readonly selected: DataTexture;
  /** The `R32F` height samples of the grid, and null without them. */
  readonly heights: DataTexture | null;
}

/**
 * Writes `projection` and its `textures` into `uniforms`.
 *
 * The heights bind only while the cutoff is on, so a backdrop without a cutoff never uploads them.
 * Without heights, no cutoff applies.
 */
export function writeNavProjectionUniforms(
  uniforms: NavProjectionUniforms,
  projection: NavProjection,
  textures: NavProjectionTextures,
): void {
  const { grid, cutoff } = projection;
  const cutting = cutoff !== null && textures.heights !== null;

  uniforms.navCells.value = textures.cells;
  uniforms.navSelected.value = textures.selected;
  uniforms.navCellOrigin.value.set(grid.min[0], grid.min[2]);
  uniforms.navCellSpan.value.set(grid.xCells * grid.cellSize, grid.yCells * grid.cellSize);
  uniforms.navCellCount.value.set(grid.xCells, grid.yCells);
  uniforms.navHighlight.value.copy(projection.highlight);

  uniforms.navCutoff.value = cutting ? Math.max(0, cutoff) : NO_CUTOFF;
  uniforms.navHeights.value = cutting ? textures.heights : null;
  uniforms.navHeightOrigin.value.set(grid.min[0], grid.min[2]);
  uniforms.navHeightSpacing.value.set(grid.xSpacing, grid.ySpacing);
  uniforms.navHeightLast.value.set(grid.xSamples - 1, grid.ySamples - 1);
}

/**
 * Returns the texture of the cell colors of a grid of `xCells` by `yCells`, one RGBA8 texel per
 * cell, all zero.
 */
export function createCellColorTexture(xCells: number, yCells: number): DataTexture {
  const texture = new DataTexture(
    new Uint8Array(xCells * yCells * 4),
    xCells,
    yCells,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  /* The bin's tag colors are sRGB bytes. */
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Returns the texture of the selected cells of a grid of `xCells` by `yCells`, none selected. */
export function createCellSelectionTexture(xCells: number, yCells: number): DataTexture {
  const texture = new DataTexture(
    new Uint8Array(xCells * yCells),
    xCells,
    yCells,
    RedFormat,
    UnsignedByteType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Writes the cells of `selected` into `into`, one byte per cell of a grid `xCells` wide, 255 for a
 * selected cell and 0 for every other cell. A cell outside the grid is skipped.
 */
export function writeCellSelection(
  selected: readonly (readonly [number, number])[],
  xCells: number,
  into: Uint8Array,
): void {
  into.fill(0);

  const yCells = xCells === 0 ? 0 : into.length / xCells;
  for (const [x, y] of selected) {
    if (x < 0 || y < 0 || x >= xCells || y >= yCells) continue;

    into[x + y * xCells] = 255;
  }
}

/**
 * Returns the texture coordinate of world `x`, `z` over the cells of `grid`, or null outside the
 * cells. Cell `x`, `y` covers `x / xCells` to `(x + 1) / xCells` along `u`, and the same along
 * `v`, as the projection shader reads it.
 */
export function cellUvOf(grid: NavGrid, x: number, z: number): [number, number] | null {
  const u = (x - grid.min[0]) / (grid.xCells * grid.cellSize);
  const v = (z - grid.min[2]) / (grid.yCells * grid.cellSize);
  const inside = u >= 0 && u < 1 && v >= 0 && v < 1;
  return inside ? [u, v] : null;
}

/**
 * Returns whether a surface at `height` takes the tint over navgrid height `ground`, under
 * `cutoff`.
 *
 * Returns true if `cutoff` is null or `ground` is null, which is a position outside the height
 * samples. Otherwise, returns false if the surface is more than `cutoff` units above `ground`.
 */
export function withinCutoff(
  height: number,
  ground: number | null,
  cutoff: number | null,
): boolean {
  if (cutoff === null || ground === null) return true;

  return height - ground <= Math.max(0, cutoff);
}

/** One entry of the backdrop's material array, as the projection reads it. */
export interface ProjectedSurface {
  readonly slots: MaterialPreview | null;
  /** The material's entry path, which the backdrop's base textures are keyed by. */
  readonly path: string;
}

/** Which fragments of one backdrop surface the projection tints. */
export type ProjectionCover =
  | { readonly kind: "whole" }
  /** The fragments whose base texel alpha is at least `alphaTest`, which the surface keeps. */
  | { readonly kind: "masked"; readonly alphaTest: number }
  /** None. The surface writes no depth, so the surfaces behind it take the tint. */
  | { readonly kind: "none" };

const WHOLE: ProjectionCover = { kind: "whole" };
const NONE: ProjectionCover = { kind: "none" };

/**
 * Returns which fragments of a surface that the backdrop draws with `slots` take the projection.
 *
 * A surface that writes no depth takes none. A surface that discards below an alpha test takes
 * the fragments whose base texel passes that test, and none if it names no base texture. Every
 * other surface takes all of its fragments. A surface drawn without slots, as in `untextured`,
 * draws opaque.
 */
export function projectionCoverOf(slots: MaterialPreview | null): ProjectionCover {
  if (slots === null || slots.missing) return WHOLE;
  if (!slots.renderState.depthWrite) return NONE;

  const alphaTest = slots.alphaTest ?? 0;
  if (alphaTest <= 0) return WHOLE;

  return slots.base === null ? NONE : { kind: "masked", alphaTest };
}

/**
 * Returns the projection's material array, one entry per entry of `covers`: `whole` for a
 * `whole` cover, the entry of `masked` at the same index for a `masked` cover, and `skipped`
 * elsewhere.
 *
 * A mesh with a material array draws each geometry group with the entry at its `materialIndex`,
 * so the projection draws the groups that the backdrop wrote, and a `skipped` entry that is not
 * `visible` leaves its groups out.
 */
export function projectionMaterialsOf<T>(
  covers: readonly ProjectionCover[],
  whole: T,
  masked: ReadonlyMap<number, T>,
  skipped: T,
): T[] {
  return covers.map((cover, at) => {
    if (cover.kind === "whole") return whole;
    if (cover.kind === "masked") return masked.get(at) ?? skipped;

    return skipped;
  });
}

/** The projection materials of the `masked` covers of one backdrop, by the index of the cover. */
export interface MaskedProjections {
  readonly materials: ReadonlyMap<number, MeshBasicMaterial>;
  readonly dispose: () => void;
}

/**
 * Returns one projection material per `masked` entry of `covers`, each with the cover's alpha
 * test and no base texture, so each draws nothing until [`bindProjectionMask`] binds one.
 */
export function createMaskedProjections(
  covers: readonly ProjectionCover[],
  uniforms: NavProjectionUniforms,
): MaskedProjections {
  const materials = new Map<number, MeshBasicMaterial>();
  for (const [at, cover] of covers.entries()) {
    if (cover.kind !== "masked") continue;

    const material = createNavProjectionMaterial(uniforms, cover.alphaTest);
    material.visible = false;
    materials.set(at, material);
  }

  return {
    materials,
    dispose: () => materials.forEach((material) => material.dispose()),
  };
}

/**
 * Binds `texture` as the base texture whose alpha the masked projection `material` tests.
 *
 * The material is hidden while `texture` is null, so a surface whose texture has not loaded takes
 * no tint. The material compiles again if it gains or loses its texture.
 */
export function bindProjectionMask(material: MeshBasicMaterial, texture: Texture | null): void {
  if (material.map === texture) return;

  if ((material.map === null) !== (texture === null)) material.needsUpdate = true;
  material.map = texture;
  material.visible = texture !== null;
}

/**
 * Returns the unlit, blended material that tints a surface by the cell color in `uniforms`.
 *
 * The material writes no depth and tests `LessEqual` with a polygon offset toward the camera, so
 * it draws over the surface that the backdrop drew at the same depth. It draws both faces, and a
 * face whose stored normal points down discards itself, so a culled back face takes no tint. The
 * stencil bit `TINTED` lets each pixel take the tint once where coplanar surfaces overlap. A
 * fragment whose base texel alpha is below `alphaTest` discards, which needs a `map`.
 */
export function createNavProjectionMaterial(
  uniforms: NavProjectionUniforms,
  alphaTest = 0,
): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    depthFunc: LessEqualDepth,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    stencilWrite: true,
    stencilFunc: NotEqualStencilFunc,
    stencilRef: TINTED,
    stencilFuncMask: TINTED,
    stencilWriteMask: TINTED,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: ReplaceStencilOp,
  });

  const own = { navAlphaTest: { value: alphaTest } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    shader.vertexShader = `${VERTEX_DECLARATIONS}${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>${VERTEX}`,
    )}`;
    shader.fragmentShader = `${SHADER_DECLARATIONS}${VERTEX_DECLARATIONS}${FRAGMENT_FUNCTIONS}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>${FRAGMENT}`,
    )}`;
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}
