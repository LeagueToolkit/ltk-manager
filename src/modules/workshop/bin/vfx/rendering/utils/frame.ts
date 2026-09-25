import { type RefObject, useLayoutEffect } from "react";
import {
  type Camera,
  DepthTexture,
  ExternalTexture,
  FramebufferTexture,
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

/** The layer everything but a particle draws on: the stage, the grid and the character. */
export const SCENE_LAYER = 0;

/** The layer a distorting emitter draws on, which the colour pass leaves out. */
export const DISTORTION_LAYER = 1;

/** The layer an emitter drawing colour sits on, which the scene's depth pass leaves out. */
export const PARTICLE_LAYER = 2;

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
   * buffer back as a texture. Its colour is never read, so the colour space trap of
   * decision 2.25 in docs/plans/vfx-particle-renderer.md does not reach it.
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

    const depth = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) });
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

/**
 * Put `held` on the layer its emitter's pass draws in.
 *
 * A distorting emitter draws the geometry it always draws, on the layer that is left out
 * of the colour pass and drawn again over the frame it warps.
 */
export function useDrawLayer(distorting: boolean, held: RefObject<Object3D | null>): void {
  /* An object ThreeJS rebuilds on its own arguments is a new one on the default layer,
     so the layer is claimed on every render rather than once on the flag, and before the
     frame that would draw it into the scene's depth pass. */
  useLayoutEffect(() => {
    held.current?.layers.set(distorting ? DISTORTION_LAYER : PARTICLE_LAYER);
  });
}
