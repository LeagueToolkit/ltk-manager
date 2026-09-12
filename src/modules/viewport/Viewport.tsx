import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";
import { WebGLRenderer, type WebGLRendererParameters } from "three";

import { CAMERA, type CameraPreset } from "./cameraPresets";
import { CameraPresetContext } from "./presetContext";
import { SceneCamera } from "./SceneCamera";
import { useSceneColors } from "./sceneColors";
import { Stage } from "./Stage";
import { OUTPUT_COLOR_SPACE, TONE_MAPPING } from "./world";

export interface ViewportProps {
  /** The ground and its grid are drawn. */
  readonly stage: boolean;
  /** The ground wears the midlane's texture rather than the flat token fill. */
  readonly textured: boolean;
  /** Which camera the scene draws through, "The viewer" in docs/ux/BIN_EDITOR.md. */
  readonly camera: CameraPreset;
  /** The reader stood the camera on `preset`: Orbit by a drag, an axis view by the gizmo. */
  readonly onCameraStand?: (preset: CameraPreset) => void;
  /** What the preview draws in the scene, which must include the `Passes` owning the loop. */
  readonly children: ReactNode;
}

/** What `opaqueRenderer` reads of the defaults the fibre hands a renderer factory. */
interface CanvasDefaults {
  /** The mounted canvas, which the fibre types against DOM typings of its own. */
  readonly canvas: unknown;
  readonly powerPreference?: WebGLRendererParameters["powerPreference"];
}

/**
 * A renderer on a drawing buffer with no alpha channel.
 *
 * ThreeJS asks the canvas for an alpha channel whatever its own `alpha` says, and a
 * compositor then shows the pane through wherever a blend left the alpha short of one.
 */
function opaqueRenderer({ canvas, powerPreference }: CanvasDefaults): WebGLRenderer {
  const surface = canvas as HTMLCanvasElement;
  const context = surface.getContext("webgl2", {
    alpha: false,
    antialias: true,
    stencil: false,
    powerPreference,
  });
  return new WebGLRenderer({ canvas: surface, context: context ?? undefined });
}

/**
 * A scene in the engine's frame: the camera and its orbit, the colour space and the stage.
 *
 * What a preview draws is its children, so a particle system, a character, or a character
 * wearing its effects stand on the same ground under the same camera (ADR-0035). The
 * gizmo draws as a HUD over the frame, so a child of the canvas has to own the render
 * loop, which `Passes` does.
 */
export function Viewport({ stage, textured, camera, onCameraStand, children }: ViewportProps) {
  const colors = useSceneColors();

  return (
    <Canvas
      camera={{
        position: [...CAMERA.position],
        near: CAMERA.near,
        far: CAMERA.far,
        fov: CAMERA.fov,
      }}
      gl={opaqueRenderer}
      onCreated={({ gl }) => {
        gl.outputColorSpace = OUTPUT_COLOR_SPACE;
        gl.toneMapping = TONE_MAPPING;
      }}
    >
      <color attach="background" args={[colors.backdrop]} />
      <SceneCamera preset={camera} colors={colors} onStand={onCameraStand} />
      <Stage colors={colors} shown={stage} textured={textured} />
      <CameraPresetContext value={camera}>{children}</CameraPresetContext>
    </Canvas>
  );
}
