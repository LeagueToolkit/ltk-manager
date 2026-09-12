import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Camera } from "three";

import {
  DISTORTION_LAYER,
  grabDepth,
  grabFrame,
  PARTICLE_LAYER,
  releaseFrame,
  SCENE_LAYER,
} from "./frame";

/** The pass runs once every emitter has written the frame's buffers. */
const AFTER_THE_EMITTERS = 1;

export interface PassesProps {
  /** An emitter warps the frame, which a pass after the colour draws over it. */
  readonly warps: boolean;
  /** An emitter fades against the scene's depth, which a pass before the colour takes. */
  readonly softens: boolean;
}

/**
 * The passes a particle scene draws in, around the colour pass everything takes.
 *
 * Every particle drawing colour sits on a layer of its own, which the camera always sees.
 * The loop is owned here even for a scene needing neither extra pass, because a HUD over
 * the frame draws at a priority of its own and the fibre then draws nothing on its own.
 */
export function Passes({ warps, softens }: PassesProps) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.layers.enable(PARTICLE_LAYER);
  }, [camera]);
  /* The grabs hold viewport-sized textures for the module's life, so a closed viewport
     hands them back. */
  useEffect(() => releaseFrame, []);

  return <FramePasses warps={warps} softens={softens} />;
}

/** The colour pass's layers: the scene and every particle drawing colour. */
function seeColour(camera: Camera): void {
  camera.layers.set(SCENE_LAYER);
  camera.layers.enable(PARTICLE_LAYER);
}

/**
 * The frame drawn in up to three passes, which takes the render loop off ThreeJS.
 *
 * The depth of the scene alone goes first for a soft fade, and the distorting layer last
 * over a copy of the frame. Decisions 2.43 and 2.25 of docs/plans/vfx-particle-renderer.md.
 */
function FramePasses({ warps, softens }: PassesProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useFrame((state) => {
    const camera = state.camera;
    if (softens) grabDepth(gl, scene, camera);
    seeColour(camera);
    gl.render(scene, camera);
    if (!warps) return;

    grabFrame(gl);

    /* The warp draws over the frame rather than in place of it, so neither the colour
       nor the depth the first pass left is cleared, and the background is what would
       clear them. */
    const background = scene.background;
    scene.background = null;
    gl.autoClear = false;
    camera.layers.set(DISTORTION_LAYER);
    gl.render(scene, camera);
    gl.autoClear = true;
    scene.background = background;
    seeColour(camera);
  }, AFTER_THE_EMITTERS);

  return null;
}
