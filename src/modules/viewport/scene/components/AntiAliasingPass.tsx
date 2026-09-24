import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  FramebufferTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBFormat,
  Scene,
  Vector2,
  WebGLRenderTarget,
} from "three";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

import type { AntiAliasing } from "../utils/antiAliasing";
import { fxaaMaterial, writeFxaa } from "../utils/fxaaMaterial";

/** After the post effects at 1.5 and under the HUD at 2, as the game's FXAA is its last scene pass. */
export const ANTI_ALIASING_PRIORITY = 1.75;

export interface AntiAliasingPassProps {
  readonly mode: Exclude<AntiAliasing, "off">;
}

/**
 * A finished frame's edges smoothed, from a copy of the frame drawn back over it.
 *
 * FXAA is one screen pass. SMAA is three's `SMAAPass`, whose edge, weight and blend passes
 * run through targets of its own and whose last one draws to the canvas.
 */
export function AntiAliasingPass({ mode }: AntiAliasingPassProps) {
  const pass = useMemo(() => {
    const frame = new FramebufferTexture(1, 1);
    frame.minFilter = LinearFilter;
    frame.magFilter = LinearFilter;
    /* The drawing buffer `opaqueRenderer` asks for has no alpha channel, and a copy into
       a texture with one fails with INVALID_OPERATION. */
    frame.format = RGBFormat;
    frame.internalFormat = "RGB8";
    const fxaa = fxaaMaterial(frame);
    const quad = new Mesh(new PlaneGeometry(2, 2), fxaa);
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    const smaa = new SMAAPass();
    smaa.renderToScreen = true;
    /* The pass reads only the texture of its read buffer, and draws to the canvas rather
       than to its write buffer, so this target is never allocated. */
    const read = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    read.texture = frame;
    return {
      read,
      frame,
      fxaa,
      quad,
      scene,
      smaa,
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
      size: new Vector2(1, 1),
      smaaSize: new Vector2(0, 0),
    };
  }, []);

  useEffect(
    () => () => {
      pass.frame.dispose();
      pass.fxaa.dispose();
      pass.quad.geometry.dispose();
      pass.smaa.dispose();
    },
    [pass],
  );

  useFrame(({ gl }) => {
    gl.getDrawingBufferSize(pass.size);
    const width = Math.max(1, Math.round(pass.size.x));
    const height = Math.max(1, Math.round(pass.size.y));
    if (pass.frame.image.width !== width || pass.frame.image.height !== height) {
      pass.frame.image.width = width;
      pass.frame.image.height = height;
      pass.frame.dispose();
    }

    /* The copy binds the texture to unit 0 but skips selecting that unit when the cache
       says it is bound there already. */
    gl.state.activeTexture(gl.getContext().TEXTURE0);
    gl.copyFramebufferToTexture(pass.frame);

    if (mode === "smaa") {
      if (pass.smaaSize.x !== width || pass.smaaSize.y !== height) {
        pass.smaa.setSize(width, height);
        pass.smaaSize.set(width, height);
      }
      pass.smaa.render(gl, pass.read, pass.read, 0, false);
      return;
    }

    writeFxaa(pass.fxaa, pass.size.set(width, height));
    gl.autoClear = false;
    gl.setRenderTarget(null);
    gl.render(pass.scene, pass.camera);
    gl.autoClear = true;
  }, ANTI_ALIASING_PRIORITY);

  return null;
}
