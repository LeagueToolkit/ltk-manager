import { Canvas, type RootState, useFrame } from "@react-three/fiber";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Vector2, type WebGLRendererParameters } from "three";

import { useContentVisible, useResizeObserver } from "@/hooks";

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
import {
  createOpaqueRenderer,
  holdsSharedRenderer,
  releaseSharedRenderer,
  type RendererLease,
  type RendererUse,
  sharedRenderer,
  takeSharedRenderer,
} from "../utils/sharedRenderer";
import { DEFAULT_SUN, type SunOverride, withSunOverride } from "../utils/sunLight";
import { edgesOf, type ViewMode } from "../utils/viewMode";
import { OUTPUT_COLOR_SPACE, TONE_MAPPING } from "../utils/world";
import { AntiAliasingPass } from "./AntiAliasingPass";
import { Backdrop } from "./Backdrop";
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
  /** The orientation control is drawn over the scene. */
  readonly gizmo?: boolean;
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
  /** The visibility flags the backdrop draws, as a mask, and the map's own opening ones absent. */
  readonly backdropFlags?: number;
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
  /** The scene colour the canvas clears to: the pane's ground, or the raised card ground. */
  readonly clearColor?: "backdrop" | "ground";
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
 * How the fibre measures the canvas: on every change, and never on a scroll.
 *
 * The default waits 50ms for a resize to settle, which leaves a dragged seam drawing a
 * frame sized for the old box. Pointer events read offsets, so nothing reads where the
 * canvas stands on the page.
 */
const MEASURE: ComponentProps<typeof Canvas>["resize"] = { scroll: false, debounce: 0 };

/** What `opaqueRenderer` reads of the defaults the fibre hands a renderer factory. */
interface CanvasDefaults {
  /** The mounted canvas, which the fibre types against DOM typings of its own. */
  readonly canvas: unknown;
  readonly powerPreference?: WebGLRendererParameters["powerPreference"];
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
  gizmo = true,
  stage,
  textured,
  backdrop = null,
  backdropFlags,
  backdropSky = true,
  sun = null,
  postEffects = null,
  ambientOcclusion = null,
  antiAliasing = DEFAULT_ANTI_ALIASING,
  camera,
  clearColor = "backdrop",
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
    () => ({ mode: viewMode, edges, edgeColour: colors.wire }),
    [viewMode, edges, colors],
  );
  const visible = useContentVisible();
  const [sized, setSized] = useState(false);
  const [started, setStarted] = useState(false);
  const measure = useResizeObserver<HTMLDivElement>((element) => {
    setSized(element.clientWidth > 0 && element.clientHeight > 0);
  });
  const box = useRef<HTMLDivElement | null>(null);
  const hold = useCallback(
    (element: HTMLDivElement) => {
      box.current = element;
      return measure(element);
    },
    [measure],
  );
  const running = active && visible && sized;
  const root = useRef<RootState | null>(null);
  const [lease] = useState<RendererLease>(() => ({ running: false }));
  const [fellBack, setFellBack] = useState(false);
  const shares = renderer === "shared" && !fellBack;
  const runningNow = useRef(running);
  // Canvas skips configuration at zero size, so hidden panes stop the root directly.
  useLayoutEffect(() => {
    runningNow.current = running;
    lease.running = running;
    if (root.current !== null) setRunning(root.current, running);
  }, [lease, running]);
  /* A layout cleanup, so a tab replacing this one in the same commit finds it let go. */
  useLayoutEffect(
    () => () => {
      lease.running = false;
      releaseSharedRenderer(lease);
    },
    [lease],
  );
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
      ref={hold}
      /* ThreeJS pins the canvas at the size last measured, a frame behind the box. */
      className="relative size-full [&_canvas]:size-full!"
    >
      {(started || running) && (
        <Canvas
          key={shares ? "shared" : "own"}
          dpr={dpr}
          resize={MEASURE}
          frameloop={running ? "always" : "never"}
          camera={{
            position: [...CAMERA.position],
            near: CAMERA.near,
            far: CAMERA.far,
            fov: CAMERA.fov,
          }}
          eventSource={shares ? (box as RefObject<HTMLDivElement>) : undefined}
          gl={({ canvas, powerPreference }: CanvasDefaults) =>
            shares
              ? sharedRenderer(powerPreference)
              : createOpaqueRenderer(canvas as HTMLCanvasElement, powerPreference)
          }
          onCreated={(state) => {
            root.current = state;
            setRunning(state, runningNow.current);
            const { gl } = state;
            gl.outputColorSpace = OUTPUT_COLOR_SPACE;
            gl.toneMapping = TONE_MAPPING;
          }}
        >
          <color attach="background" args={[colors[clearColor]]} />
          {shares && (
            <SharedRendererClaim
              lease={lease}
              box={box}
              onTaken={() => {
                releaseSharedRenderer(lease);
                setFellBack(true);
              }}
            />
          )}
          <SceneCamera preset={camera} colors={colors} onStand={onCameraStand} gizmo={gizmo} />
          <Sun light={light} />
          <Stage colors={colors} shown={stage && map.geometry === null} textured={textured} />
          {map.geometry !== null && (
            <>
              {backdropSky && <Sky />}
              <Backdrop
                map={map.geometry}
                materials={map.materials}
                textures={map.textures}
                programs={map.programs}
                programTextures={map.programTextures}
                lightmaps={map.lightmaps}
                light={light}
                flags={backdropFlags ?? map.opening}
                viewMode={viewMode}
                edges={edges}
                edgeColour={colors.wire}
              />
            </>
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
        </Canvas>
      )}
    </div>
  );
}

interface SharedRendererClaimProps {
  readonly lease: RendererLease;
  readonly box: RefObject<HTMLDivElement | null>;
  /** Another viewport on screen draws with the shared renderer, so this one needs its own. */
  readonly onTaken: () => void;
}

/**
 * Take the shared renderer before a frame draws, where another viewport had it.
 *
 * Run in the frame rather than in an effect, because a tab switch hides one viewport and
 * shows another in one commit, and only by the frame has the hidden one stopped running.
 * A viewport on screen that still holds it keeps it, and this one falls back.
 */
function SharedRendererClaim({ lease, box, onTaken }: SharedRendererClaimProps) {
  useFrame(({ gl, size, viewport, setFrameloop }) => {
    if (!holdsSharedRenderer(lease) && takeSharedRenderer(lease) === null) {
      setFrameloop("never");
      onTaken();
      return;
    }

    const canvas = gl.domElement;
    if (box.current !== null && canvas.parentNode !== box.current) box.current.append(canvas);

    /* The fibre sizes the renderer only when its own box changes, and another viewport
       may have drawn with it at another size since. */
    if (gl.getPixelRatio() !== viewport.dpr) gl.setPixelRatio(viewport.dpr);
    gl.getSize(DRAWN_SIZE);
    if (DRAWN_SIZE.x !== size.width || DRAWN_SIZE.y !== size.height) {
      gl.setSize(size.width, size.height);
    }
  }, CLAIM_PRIORITY);
  return null;
}

/** Ahead of every other frame callback, so the claim lands before anything draws. */
const CLAIM_PRIORITY = -1000;

const DRAWN_SIZE = new Vector2();

function setRunning(root: RootState, running: boolean): void {
  const state = root.get();
  const mode = running ? "always" : "never";
  if (state.frameloop !== mode) state.setFrameloop(mode);
  // A queued automatic frame in manual mode treats the RAF timestamp as seconds.
  if (!running) state.internal.frames = 0;
}
