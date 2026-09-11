import { type RefObject, useLayoutEffect } from "react";
import {
  type Camera,
  DepthTexture,
  FramebufferTexture,
  LinearFilter,
  type Object3D,
  PerspectiveCamera,
  type Scene,
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
 * The frame as it stood before anything warped it, which a distorting fragment samples.
 *
 * One texture for the whole viewport, held by every distortion material's uniform, so a
 * resize keeps the object and reallocates what is behind it.
 */
export const FRAME = new FramebufferTexture(1, 1);
FRAME.minFilter = LinearFilter;
FRAME.magFilter = LinearFilter;

/** The drawing buffer's size in pixels, which turns a fragment's place into a coordinate. */
export const VIEWPORT = new Vector2(1, 1);

/**
 * The depth the scene leaves with no particle in it, which a soft fade measures its gap to.
 *
 * Rendered rather than copied out of the canvas, because a target is what hands a depth
 * buffer back as a texture. Its colour is never read, so the colour space trap of decision
 * 2.25 in docs/plans/vfx-particle-renderer.md does not reach it.
 */
const SCENE_TARGET = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) });

/** The depth `grabDepth` leaves, which every soft fading material holds. */
export const SCENE_DEPTH = SCENE_TARGET.depthTexture;

/** The camera's near and far planes, which turn a stored depth back into a distance. */
export const DEPTH_RANGE = new Vector2(1, 1);

/** Free the frame and the depth target, which the next grab allocates again. */
export function releaseFrame(): void {
  FRAME.dispose();
  SCENE_TARGET.dispose();
}

/** Take the frame as it stands, which is what the distortion pass draws over. */
export function grabFrame(gl: WebGLRenderer): void {
  gl.getDrawingBufferSize(VIEWPORT);
  const width = Math.max(1, Math.round(VIEWPORT.x));
  const height = Math.max(1, Math.round(VIEWPORT.y));

  if (FRAME.image.width !== width || FRAME.image.height !== height) {
    FRAME.image.width = width;
    FRAME.image.height = height;
    /* The storage is immutable once it is allocated, so a resize frees it and lets the
       next upload allocate again, which keeps the object every material points at. */
    FRAME.dispose();
  }

  gl.copyFramebufferToTexture(FRAME);
}

/**
 * Draw the scene's own layer into `SCENE_DEPTH`, which is what a soft fade reads.
 *
 * The camera leaves on the scene's layer alone, and the caller sets the layers it draws next.
 */
export function grabDepth(gl: WebGLRenderer, scene: Scene, camera: Camera): void {
  gl.getDrawingBufferSize(VIEWPORT);
  const width = Math.max(1, Math.round(VIEWPORT.x));
  const height = Math.max(1, Math.round(VIEWPORT.y));
  if (SCENE_TARGET.width !== width || SCENE_TARGET.height !== height) {
    SCENE_TARGET.setSize(width, height);
  }
  if (camera instanceof PerspectiveCamera) DEPTH_RANGE.set(camera.near, camera.far);

  const background = scene.background;
  scene.background = null;
  camera.layers.set(SCENE_LAYER);
  gl.setRenderTarget(SCENE_TARGET);
  gl.render(scene, camera);
  gl.setRenderTarget(null);
  scene.background = background;
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
