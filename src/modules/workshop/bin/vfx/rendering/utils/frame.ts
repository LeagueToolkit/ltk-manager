import { useThree } from "@react-three/fiber";
import { type RefObject, useLayoutEffect } from "react";
import {
  type Camera,
  Color,
  DepthTexture,
  ExternalTexture,
  FramebufferTexture,
  HalfFloatType,
  LinearFilter,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  RGBFormat,
  type Scene,
  type Texture,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { GLOW_LAYER, glowing, useGlowing } from "@/modules/viewport";

import type { EmitterModel } from "../../engine/model/model";
import { drawBloom, releaseBloom } from "./bloom";
import { drawPhases } from "./drawKind";

/** The layer everything but a particle draws on: the stage, the grid and the character. */
export const SCENE_LAYER = 0;

/** The layer an emitter warping the frame between the two colour phases draws on. */
export const DISTORTION_LAYER = 1;

/**
 * The layer an emitter drawing colour after the late distortion sits on, the engine's
 * post-distortion phase, which the scene's depth pass leaves out.
 */
export const PARTICLE_LAYER = 2;

/* A character draws glow copies too, so the glow layer is the viewport module's. */
export { GLOW_LAYER, glowing, useGlowing };

/**
 * The layer an emitter drawing colour before the late distortion sits on, the engine's
 * default and ground-layer phases.
 */
export const UNDER_LAYER = 4;

/** The layer an emitter warping the frame ahead of every particle draws on. */
export const EARLY_DISTORTION_LAYER = 5;

/** Let `camera` see every particle drawing colour, in either colour phase. */
export function seeParticles(camera: Camera): void {
  camera.layers.enable(PARTICLE_LAYER);
  camera.layers.enable(UNDER_LAYER);
}

const OVER_LAYERS = [PARTICLE_LAYER] as const;
const UNDER_LAYERS = [UNDER_LAYER] as const;
const WARP_LAYERS = [
  [],
  [EARLY_DISTORTION_LAYER],
  [DISTORTION_LAYER],
  [EARLY_DISTORTION_LAYER, DISTORTION_LAYER],
] as const;

/** The layers the draws of `emitter` sit on, by the render phases it is in. */
export function drawLayersOf(emitter: EmitterModel): readonly number[] {
  const phases = drawPhases(emitter);
  if (phases.colour === "under") return UNDER_LAYERS;
  if (phases.colour === "over") return OVER_LAYERS;
  return WARP_LAYERS[Number(phases.warpsEarly) + 2 * Number(phases.warpsLate)];
}

/**
 * The frame as it was before anything warped it, which a distorting fragment samples.
 *
 * Every distortion material's uniform keeps this one object, and it points at the copy of
 * the renderer drawing at the moment. Each canvas keeps a copy of its size, so canvases of
 * different sizes reallocate nothing from frame to frame.
 */
export const FRAME = new ExternalTexture();

/** The drawing buffer's size in pixels, which turns a fragment's place into a coordinate. */
export const VIEWPORT = new Vector2(1, 1);

/**
 * The depth the scene leaves with no particle in it, which a soft fade measures its gap to.
 *
 * Points at the depth target of the renderer drawing at the moment, as `FRAME` does.
 */
export const SCENE_DEPTH = new ExternalTexture();

/** The camera's near and far planes, which turn a stored depth back into a distance. */
export const DEPTH_RANGE = new Vector2(1, 1);

/** The textures one renderer's passes write, sized to its drawing buffer. */
interface FrameTargets {
  readonly frame: FramebufferTexture;
  /**
   * Rendered rather than copied out of the canvas, because a target is what hands a depth
   * buffer back as a texture. Its colour holds the glow, drawn over the depth, and half
   * floats keep a glow brighter than white.
   */
  readonly depth: WebGLRenderTarget;
}

const TARGETS = new WeakMap<WebGLRenderer, FrameTargets>();

function targetsOf(gl: WebGLRenderer): FrameTargets {
  let targets = TARGETS.get(gl);
  if (targets === undefined) {
    const frame = new FramebufferTexture(1, 1);
    frame.minFilter = LinearFilter;
    frame.magFilter = LinearFilter;
    /* The drawing buffer `opaqueRenderer` asks for has no alpha channel, and a copy into a
       texture with one fails with INVALID_OPERATION on every frame. */
    frame.format = RGBFormat;
    frame.internalFormat = "RGB8";

    const depth = new WebGLRenderTarget(1, 1, {
      depthTexture: new DepthTexture(1, 1),
      type: HalfFloatType,
    });
    /* The depth pass writes no colour. ThreeJS picks the tone mapping and the output colour
       space of a program by its target, and these two make the depth pass pick the screen's,
       so a material keeps one program rather than switching it twice a frame. */
    Object.assign(depth, { isXRRenderTarget: true });
    depth.texture.colorSpace = gl.outputColorSpace;
    targets = { frame, depth };
    TARGETS.set(gl, targets);
  }

  return targets;
}

/**
 * The GL texture `gl` allocated for `texture`, and null before its first upload.
 *
 * three exposes no public handle to a target's depth texture, so the renderer's property
 * record is read.
 */
function glTextureOf(gl: WebGLRenderer, texture: Texture | null): WebGLTexture | null {
  if (texture === null || !gl.properties.has(texture)) return null;

  const record = gl.properties.get(texture) as { __webglTexture?: WebGLTexture };
  return record.__webglTexture ?? null;
}

/**
 * Point `FRAME` and `SCENE_DEPTH` at the textures `gl` last wrote, before `gl` draws.
 *
 * A texture of another canvas belongs to another GL context, which a draw cannot bind.
 */
export function bindFrameTargets(gl: WebGLRenderer): void {
  const targets = TARGETS.get(gl);
  FRAME.sourceTexture = targets === undefined ? null : glTextureOf(gl, targets.frame);
  SCENE_DEPTH.sourceTexture =
    targets === undefined ? null : glTextureOf(gl, targets.depth.depthTexture);
}

/** Free the frame and the depth target of `gl`, which its next grab allocates again. */
export function releaseFrame(gl: WebGLRenderer): void {
  const targets = TARGETS.get(gl);
  if (targets === undefined) return;

  TARGETS.delete(gl);
  targets.frame.dispose();
  targets.depth.dispose();
  releaseBloom(gl);
  FRAME.sourceTexture = null;
  SCENE_DEPTH.sourceTexture = null;
}

/** Take the frame as it is, which is what the distortion pass draws over. */
export function grabFrame(gl: WebGLRenderer): void {
  gl.getDrawingBufferSize(VIEWPORT);
  const width = Math.max(1, Math.round(VIEWPORT.x));
  const height = Math.max(1, Math.round(VIEWPORT.y));
  const { frame } = targetsOf(gl);

  if (frame.image.width !== width || frame.image.height !== height) {
    frame.image.width = width;
    frame.image.height = height;
    /* The storage is immutable once it is allocated, so a resize frees it and lets the
       next upload allocate again. */
    frame.dispose();
  }

  /* three copies into whichever unit is active, and skips the bind when its cache already
     has the texture on unit 0, so the copy can land in another material's sampler. */
  gl.state.activeTexture(gl.getContext().TEXTURE0);
  gl.copyFramebufferToTexture(frame);
  FRAME.sourceTexture = glTextureOf(gl, frame);
}

/**
 * Draw the scene's layer into `SCENE_DEPTH`, which is what a soft fade reads.
 *
 * The camera is left on the scene's layer alone, and the caller sets the layers it draws next.
 */
export function grabDepth(gl: WebGLRenderer, scene: Scene, camera: Camera): void {
  gl.getDrawingBufferSize(VIEWPORT);
  const width = Math.max(1, Math.round(VIEWPORT.x));
  const height = Math.max(1, Math.round(VIEWPORT.y));
  const { depth } = targetsOf(gl);
  if (depth.width !== width || depth.height !== height) {
    depth.setSize(width, height);
  }
  if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
    DEPTH_RANGE.set(camera.near, camera.far);
  }

  const background = scene.background;
  scene.background = null;
  camera.layers.set(SCENE_LAYER);
  /* Only the depth is read, so the pass writes no colour. The lock keeps every material's
     `colorWrite` from turning the writes back on. */
  const color = gl.state.buffers.color;
  color.setMask(false);
  color.setLocked(true);
  gl.setRenderTarget(depth);
  gl.render(scene, camera);
  gl.setRenderTarget(null);
  color.setLocked(false);
  color.setMask(true);
  scene.background = background;
  SCENE_DEPTH.sourceTexture = glTextureOf(gl, depth.depthTexture);
}

const CLEAR_COLOR = new Color();

/**
 * Draw the glow layer over the depth `grabDepth` left, and add it to the frame blurred.
 *
 * The camera is left on the glow layer, and the caller sets the layers it draws next.
 */
export function drawGlow(gl: WebGLRenderer, scene: Scene, camera: Camera): void {
  const { depth } = targetsOf(gl);
  const background = scene.background;
  scene.background = null;
  camera.layers.set(GLOW_LAYER);

  gl.getClearColor(CLEAR_COLOR);
  const clearAlpha = gl.getClearAlpha();
  const autoClear = gl.autoClear;
  gl.setRenderTarget(depth);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, false, false);
  gl.setClearColor(CLEAR_COLOR, clearAlpha);
  gl.autoClear = false;
  gl.render(scene, camera);
  gl.autoClear = autoClear;
  gl.setRenderTarget(null);
  scene.background = background;

  drawBloom(gl, depth.texture, VIEWPORT);
}

/** The objects of a scene on each distortion layer, which say which warp passes it needs. */
interface Warping {
  readonly early: Set<Object3D>;
  readonly late: Set<Object3D>;
}

const WARPING = new WeakMap<Scene, Warping>();

/** Put `object` on `layers`, and note for `scene` whether it warps the frame. */
export function placeOnLayers(scene: Scene, object: Object3D, layers: readonly number[]): void {
  object.layers.disableAll();
  for (const layer of layers) object.layers.enable(layer);

  let warping = WARPING.get(scene);
  if (warping === undefined) {
    warping = { early: new Set(), late: new Set() };
    WARPING.set(scene, warping);
  }
  if (layers.includes(EARLY_DISTORTION_LAYER)) warping.early.add(object);
  else warping.early.delete(object);
  if (layers.includes(DISTORTION_LAYER)) warping.late.add(object);
  else warping.late.delete(object);
}

/** Forget `object`, which no longer draws in `scene`. */
export function leaveLayers(scene: Scene, object: Object3D): void {
  const warping = WARPING.get(scene);
  warping?.early.delete(object);
  warping?.late.delete(object);
}

/** Which of the two warp passes `scene` holds an emitter for. */
export function warpsOf(scene: Scene): { readonly early: boolean; readonly late: boolean } {
  const warping = WARPING.get(scene);
  return { early: (warping?.early.size ?? 0) > 0, late: (warping?.late.size ?? 0) > 0 };
}

/**
 * Put `held` on the layers its emitter's phases draw in.
 *
 * A distorting emitter draws the geometry it always draws, on a layer that is left out
 * of the colour passes and drawn over the frame it warps.
 */
export function useDrawLayer(layers: readonly number[], held: RefObject<Object3D | null>): void {
  const scene = useThree((state) => state.scene);
  /* An object ThreeJS rebuilds on its own arguments is a new one on the default layer,
     so the layer is claimed on every render rather than once on the flag, and before the
     frame that would draw it into the scene's depth pass. */
  useLayoutEffect(() => {
    const object = held.current;
    if (object === null) return;

    placeOnLayers(scene, object, layers);
    return () => leaveLayers(scene, object);
  });
}
