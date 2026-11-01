import type { RootState } from "@react-three/fiber";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MapVisibility } from "../../assets/utils/mapVisibility";
import type { GizmoCorner } from "../../camera/components/OrientationGizmo";
import { SceneCamera } from "../../camera/components/SceneCamera";
import { CameraPresetContext } from "../../camera/state/presetContext";
import { CAMERA, type CameraPreset } from "../../camera/utils/cameraPresets";
import { AXIS_SIGN } from "../../shared/utils/space";
import { useSceneColors } from "../hooks/sceneColors";
import { type BackdropSource, useMapBackdrop } from "../hooks/useMapBackdrop";
import { type CharacterLight, CharacterLightContext } from "../state/characterLightContext";
import { ViewModeContext } from "../state/viewModeContext";
import {
  type AmbientOcclusion,
  drawsAmbientOcclusion,
  NO_AMBIENT_OCCLUSION,
} from "../utils/ambientOcclusion";
import { type AntiAliasing, DEFAULT_ANTI_ALIASING } from "../utils/antiAliasing";
import { drawsPostEffects, NO_POST_EFFECTS, type PostEffects } from "../utils/postEffects";
import type { RendererUse } from "../utils/sharedRenderer";
import { DEFAULT_SUN, type SunOverride, withSunOverride } from "../utils/sunLight";
import { edgesOf, type ViewMode } from "../utils/viewMode";
import { OUTPUT_COLOR_SPACE, TONE_MAPPING } from "../utils/world";
import { AntiAliasingPass } from "./AntiAliasingPass";
import { Backdrop } from "./Backdrop";
import { type CaptureFrame, FrameCapture } from "./FrameCapture";
import { FrameOnCommit } from "./Frames";
import { HostCanvas, useCanvasHost } from "./HostCanvas";
import { PostEffectsPass } from "./PostEffectsPass";
import { Sky } from "./Sky";
import { Stage } from "./Stage";
import { Sun } from "./Sun";

export interface ViewportProps {
  /** Whether this surface spends frames, including while its canvas remains mounted. */
  readonly active?: boolean;
  /**
   * Which renderer the scene draws with, its own unless said otherwise.
   *
   * A shared one falls back to its own where another viewport drawing with it is on
   * screen at the same time, which remounts the scene once.
   */
  readonly renderer?: RendererUse;
  /** A fixed pixel ratio for small preview surfaces. */
  readonly dpr?: number;
  /**
   * When the scene draws a frame while it runs. `always` draws every frame. `demand` draws
   * a frame when one is requested: after a commit of this component, when the camera
   * moves, when the fibre changes a scene object, and when a frame callback calls
   * `invalidate`. Content that changes every frame has to request its own frames under
   * `demand`, as `KeepFrames` does.
   */
  readonly frameloop?: "always" | "demand";
  /** The orientation control is drawn over the scene. */
  readonly gizmo?: boolean;
  /** The corner the orientation control sits in, top left by default. */
  readonly gizmoCorner?: GizmoCorner;
  /** The ground and its grid are drawn. */
  readonly stage: boolean;
  /** The ground wears the midlane's texture rather than the flat token fill. */
  readonly textured: boolean;
  /**
   * The game's own map drawn behind the subject, and null for the flat stage.
   *
   * A backdrop replaces the stage rather than standing on it, so neither the ground plane
   * nor its grid is drawn while one is up.
   */
  readonly backdrop?: BackdropSource | null;
  /** The visibility that selects the backdrop's meshes. Defaults to the map's opening visibility. */
  readonly backdropVisibility?: MapVisibility;
  /** The sky cube map is drawn behind the backdrop, and the flat colour when off. */
  readonly backdropSky?: boolean;
  /** The sun control's fields over the backdrop's own sun, or `DEFAULT_SUN` without one. */
  readonly sun?: SunOverride | null;
  /** The scene's post effects, and the backdrop's own or none when absent. */
  readonly postEffects?: PostEffects | null;
  /** The scene's ambient occlusion, and the backdrop's own or none when absent. */
  readonly ambientOcclusion?: AmbientOcclusion | null;
  /** How the finished frame's edges are smoothed. */
  readonly antiAliasing?: AntiAliasing;
  /** Which camera the scene draws through, "The viewer" in docs/ux/BIN_EDITOR.md. */
  readonly camera: CameraPreset;
  /** The kind of viewport whose last camera pose this one opens at, and records, if any. */
  readonly cameraMemory?: string;
  /** The scene colour the canvas clears to: the pane's ground, or the raised card ground. */
  readonly clearColor?: "backdrop" | "ground";
  /** Six hex digits that replace `clearColor` and the sky, and null for neither. */
  readonly background?: string | null;
  /** The ref that receives the function that captures this viewport's frames. */
  readonly captureRef?: RefObject<CaptureFrame | null>;
  /** How the backdrop and every character draw their meshes. */
  readonly viewMode?: ViewMode;
  /** The triangle edges draw over a lit or untextured scene. */
  readonly wireOverlay?: boolean;
  /** The reader stood the camera on `preset`: Orbit by a drag, an axis view by the gizmo. */
  readonly onCameraStand?: (preset: CameraPreset) => void;
  /**
   * Where a subject stands on the backdrop before anyone moves it, in the scene's space.
   *
   * Reported rather than applied, because the viewport draws the map and the scene owns
   * what stands on it. Null while there is no backdrop.
   */
  readonly onBackdropOrigin?: (origin: readonly [number, number, number] | null) => void;
  /** What the preview draws in the scene, which must include the `Passes` owning the loop. */
  readonly children: ReactNode;
}

/**
 * A scene in the engine's frame: the camera and its orbit, the colour space and the stage.
 *
 * What a preview draws is its children, so a particle system, a character, or a character
 * wearing its effects stand on the same ground under the same camera (ADR-0035). The
 * gizmo draws as a HUD over the frame, so a child of the canvas has to own the render
 * loop, which `Passes` does.
 */
export function Viewport({
  active = true,
  renderer = "own",
  dpr,
  frameloop = "always",
  gizmo = true,
  gizmoCorner,
  stage,
  textured,
  backdrop = null,
  backdropVisibility,
  backdropSky = true,
  sun = null,
  postEffects = null,
  ambientOcclusion = null,
  antiAliasing = DEFAULT_ANTI_ALIASING,
  camera,
  cameraMemory,
  clearColor = "backdrop",
  background = null,
  captureRef,
  viewMode = "lit",
  wireOverlay = false,
  onCameraStand,
  onBackdropOrigin,
  children,
}: ViewportProps) {
  const colors = useSceneColors();
  const map = useMapBackdrop(backdrop);
  const light = useMemo(() => withSunOverride(map.sun ?? DEFAULT_SUN, sun), [map.sun, sun]);
  const grid = map.geometry === null ? null : map.lightGrid;
  const characterLight = useMemo<CharacterLight>(() => ({ grid, sun: light }), [grid, light]);
  const edges = edgesOf(viewMode, wireOverlay);
  const view = useMemo(
    () => ({ mode: viewMode, edges, edgeColour: colors.edge }),
    [viewMode, edges, colors],
  );
  const host = useCanvasHost(active, renderer === "shared");
  const { running } = host;
  const [started, setStarted] = useState(false);
  const root = useRef<RootState | null>(null);
  const loop: Loop = running ? frameloop : "never";
  const loopNow = useRef(loop);
  // Canvas skips configuration at zero size, so hidden panes stop the root directly.
  useLayoutEffect(() => {
    loopNow.current = loop;
    if (root.current !== null) setLoop(root.current, loop);
  }, [loop]);
  useEffect(() => {
    if (running) setStarted(true);
  }, [running]);

  const effects = postEffects ?? map.postEffects ?? NO_POST_EFFECTS;
  const occlusion = ambientOcclusion ?? map.ambientOcclusion ?? NO_AMBIENT_OCCLUSION;

  const origin = map.origin;
  useEffect(() => {
    /* Mirrored the way the backdrop's own group is, so the point lands where the map
       drew it rather than across the scene from it. */
    onBackdropOrigin?.(
      origin === null
        ? null
        : [origin[0] * AXIS_SIGN[0], origin[1] * AXIS_SIGN[1], origin[2] * AXIS_SIGN[2]],
    );
  }, [origin, onBackdropOrigin]);

  return (
    <div
      ref={host.hold}
      /* ThreeJS pins the canvas at the size last measured, a frame behind the box. */
      className="relative size-full [&_canvas]:size-full!"
    >
      {(started || running) && (
        <HostCanvas
          host={host}
          dpr={dpr}
          frameloop={loop}
          camera={{
            position: [...CAMERA.position],
            near: CAMERA.near,
            far: CAMERA.far,
            fov: CAMERA.fov,
          }}
          onCreated={(state) => {
            root.current = state;
            setLoop(state, loopNow.current);
            const { gl } = state;
            gl.outputColorSpace = OUTPUT_COLOR_SPACE;
            gl.toneMapping = TONE_MAPPING;
          }}
        >
          {/* The fibre applies changed `args` after a commit, over a `Sky` that the commit placed,
              so the key remounts the color. `Sky` is a sibling of the color because a removal under
              this parent runs first, and the removal otherwise restores the previous background
              over the new color. */}
          <color
            key={background ?? "theme"}
            attach="background"
            args={[background === null ? colors[clearColor] : `#${background}`]}
          />
          {map.geometry !== null && backdropSky && background === null && <Sky />}
          <FrameOnCommit />
          <SceneCamera
            preset={camera}
            colors={colors}
            onStand={onCameraStand}
            gizmo={gizmo}
            gizmoCorner={gizmoCorner}
            memory={cameraMemory}
          />
          <Sun light={light} />
          <Stage colors={colors} shown={stage && map.geometry === null} textured={textured} />
          {map.geometry !== null && (
            <Backdrop
              map={map.geometry}
              materials={map.materials}
              textures={map.textures}
              programs={map.programs}
              programTextures={map.programTextures}
              lightmaps={map.lightmaps}
              light={light}
              grassTint={map.grassTint}
              bounds={map.bounds}
              visibility={backdropVisibility ?? map.visibility}
              viewMode={viewMode}
              edges={edges}
              edgeColour={colors.edge}
            />
          )}
          <CharacterLightContext value={characterLight}>
            <CameraPresetContext value={camera}>
              <ViewModeContext value={view}>{children}</ViewModeContext>
            </CameraPresetContext>
          </CharacterLightContext>
          {(drawsPostEffects(effects) || drawsAmbientOcclusion(occlusion)) && (
            <PostEffectsPass effects={effects} occlusion={occlusion} />
          )}
          {antiAliasing !== "off" && <AntiAliasingPass mode={antiAliasing} />}
          {captureRef !== undefined && <FrameCapture handle={captureRef} />}
        </HostCanvas>
      )}
    </div>
  );
}

type Loop = "always" | "demand" | "never";

function setLoop(root: RootState, loop: Loop): void {
  const state = root.get();
  if (state.frameloop !== loop) state.setFrameloop(loop);
  // A queued automatic frame in manual mode treats the RAF timestamp as seconds.
  if (loop === "never") state.internal.frames = 0;
  else state.invalidate();
}
