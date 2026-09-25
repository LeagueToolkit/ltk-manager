import {
  ArrowsOutCardinalIcon,
  ArrowClockwiseIcon,
  FrameCornersIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, HexshadeIcon, IconButton, Tooltip } from "@/components";
import { errorSummary, m } from "@/i18n";
import {
  edgesOf,
  lastCameraPose,
  useCameraPreset,
  useFitCamera,
  useSeesBounds,
  Viewport,
} from "@/modules/viewport";
import {
  usePreviewAntiAliasing,
  usePreviewCamera,
  usePreviewGizmo,
  usePreviewGround,
  usePreviewMidlane,
  usePreviewShaders,
  usePreviewStats,
  usePreviewViewMode,
  usePreviewWireOverlay,
  useSetPreviewDisplay,
} from "@/stores";

import { nameHash } from "../../../shared/utils/binHash";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import type { SystemModel } from "../../engine/model/model";
import type { RigModel } from "../../engine/model/rig";
import { ForceGizmo } from "../../forces/ForceGizmo";
import { useForcePreview } from "../../forces/forcePreview";
import { useForces } from "../../forces/useForces";
import { vfxKeys } from "../../hooks/useVfxSystem";
import { useEmitters } from "../../inspector/state/emitterChoice";
import { RigControl } from "../../playback/components/RigControl";
import { RunTransport } from "../../playback/components/RunTransport";
import { useVfxRun } from "../../playback/state/run";
import { EmitterGizmo } from "../../rendering/components/EmitterGizmo";
import { Passes } from "../../rendering/components/Passes";
import { createStatsFeed, Stats, StatsProbe } from "../../rendering/components/Stats";
import { VfxSystem } from "../../rendering/components/VfxSystem";
import { useVfxMeshes } from "../../rendering/hooks/useVfxMeshes";
import { useVfxTextures } from "../../rendering/hooks/useVfxTextures";
import type { AssetLoad } from "../../rendering/utils/assetLoad";
import { type DrawnEmitter, drawnEmitters } from "../../rendering/utils/definitions";
import { distorts, drawsTheAttachment, isUndrawn } from "../../rendering/utils/drawKind";
import { fades } from "../../rendering/utils/softParticle";
import { definitionBounds, rigGround } from "../../rendering/utils/systemBounds";
import { chosenEmitter } from "../../timeline/utils/selection";
import { CameraMenu } from "./CameraMenu";
import { EmitterTransform, type TransformMode } from "./EmitterTransform";
import type { PreviewTransport } from "./PreviewPane";
import { ShowMenu } from "./ShowMenu";
import { useVfxHost, VfxHost, VfxHostControls } from "./VfxHost";
import { ViewModeMenu } from "./ViewModeMenu";
import { ViewToggle } from "./ViewToggle";

export interface VfxViewportProps {
  transport: PreviewTransport;
}

/** The camera memory every particle preview shares, so the next system opens in the last view. */
const VFX_CAMERA = "vfx";

/**
 * The shell's run drawn, which is what the `preview` pane holds (ADR-0037).
 *
 * The whole system draws, because a layered effect is only itself with every emitter in
 * it. Mute and solo narrow the draw and leave the run whole (decision 2.46).
 */
export default function VfxViewport({ transport }: VfxViewportProps) {
  const {
    system,
    error,
    pending,
    driver,
    rig,
    muted,
    soloed,
    fitRequest,
    requestFit,
    pinned,
    setPinned,
    setWarming,
    document,
  } = useVfxRun();
  const drawn = useMemo(() => (system === null ? [] : drawnEmitters(system)), [system]);
  const { reportTextures, reportMeshes } = useWarmUp(drawn, setWarming);
  const textures = useVfxTextures(drawn, reportTextures);
  const meshes = useVfxMeshes(drawn, reportMeshes);
  const host = useVfxHost();
  const queries = useQueryClient();

  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const gizmo = usePreviewGizmo();
  const stats = usePreviewStats();
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const viewMode = usePreviewViewMode();
  const wireOverlay = usePreviewWireOverlay();
  const shaders = usePreviewShaders();
  const setDisplay = useSetPreviewDisplay();

  const { root, child } = useEmitters();
  const edit = use(LeafEditContext);
  const forces = useForces();
  const forcePreview = useForcePreview();
  const selectedForce = forces.hosted
    ? forces.forces.find((force) => force.key === forcePreview.selected && force.supported)
    : undefined;
  const forceActive =
    selectedForce !== undefined &&
    !forcePreview.muted.has(selectedForce.key) &&
    (forcePreview.solo === null || forcePreview.solo === selectedForce.key);
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const translationRow = root?.fields(nameHash("translationOverride"));
  const rotationRow = root?.fields(nameHash("rotationOverride"));
  const transformRow = transformMode === "translate" ? translationRow : rotationRow;
  const selected = chosenEmitter(system, root);
  const feed = useMemo(createStatsFeed, []);

  const undrawn = useMemo(() => undrawnKinds(system), [system]);
  const customMaterials = drawn.filter(({ emitter }) => emitter.customMaterial !== null).length;
  const attached = useMemo(() => attachmentCount(system), [system]);
  const warps = useMemo(() => drawn.some((definition) => distorts(definition.emitter)), [drawn]);
  const softens = useMemo(() => drawn.some((definition) => fades(definition.emitter)), [drawn]);

  const hiddenOf = (definition: DrawnEmitter) =>
    muted.has(definition.root) || (soloed.size > 0 && !soloed.has(definition.root));

  /* The viewport stays mounted while a system reads, fails or draws nothing, so the camera,
     the ground and the renderer carry from one system to the next. */
  const shown = system !== null && system.emitters.length > 0 ? system : null;
  const opened = shown?.emitters.find((emitter) => emitter.index === selected) ?? null;

  return (
    <div data-ui="VfxViewport" className="flex min-h-0 flex-1 flex-col select-none">
      <div className="relative min-h-0 flex-1">
        <Viewport
          renderer="shared"
          cameraMemory={VFX_CAMERA}
          antiAliasing={antiAliasing}
          stage={ground}
          textured={midlane}
          camera={camera}
          viewMode={viewMode}
          wireOverlay={wireOverlay}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
        >
          <Passes warps={warps} softens={softens} />
          {shown !== null && (
            <>
              <VfxHost host={host}>
                <VfxSystem
                  drawn={drawn}
                  driver={driver}
                  textures={textures}
                  meshes={meshes}
                  hiddenOf={hiddenOf}
                  edges={edgesOf(viewMode, wireOverlay)}
                  document={document}
                />
              </VfxHost>
              <Fit token={fitRequest} system={shown} drawn={drawn} rig={rig.rig} />
              {gizmo && opened !== null && (
                <EmitterGizmo system={shown} driver={driver} emitter={opened} />
              )}
              {edit !== null &&
                selectedForce === undefined &&
                child === null &&
                opened !== null &&
                transformMode !== null &&
                transformRow?.value.type === "vector" && (
                  <EmitterTransform
                    key={`${root?.key}:${transformMode}`}
                    system={shown}
                    emitter={opened}
                    row={transformRow}
                    mode={transformMode}
                    edit={edit}
                  />
                )}
              {selectedForce !== undefined && opened !== null && (
                <ForceGizmo
                  key={`${root?.key}:${selectedForce.key}`}
                  system={shown}
                  emitter={opened}
                  force={selectedForce}
                  handle={forcePreview.handle}
                  edit={forceActive ? edit : null}
                />
              )}
              {stats && <StatsProbe driver={driver} drawn={drawn} feed={feed} />}
            </>
          )}
        </Viewport>

        {pending && <ViewportNotice text={m.workshop_bin_preview_loading_label()} />}
        {error !== null && (
          <ViewportNotice
            text={m.workshop_bin_preview_failed_empty()}
            detail={errorSummary(error)}
            onRetry={() => void queries.refetchQueries({ queryKey: vfxKeys.document(document) })}
          />
        )}
        {!pending && error === null && shown === null && (
          <ViewportNotice text={m.workshop_bin_preview_emitters_empty()} />
        )}

        <div
          data-ui="VfxViewport:controls"
          /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-surface-veil bg-scrim p-0.5 shadow-md backdrop-blur-sm [&_button]:text-meta"
        >
          <ShowMenu />
          <ViewToggle
            label={m.workshop_bin_preview_shaders_label()}
            active={shaders}
            icon={<HexshadeIcon className={shaders ? "h-4 w-4" : "h-4 w-4 grayscale"} />}
            onClick={() => setDisplay({ previewShaders: !shaders })}
          />
          <ViewModeMenu />
          <CameraMenu />
          {edit !== null && child === null && opened !== null && (
            <>
              <Tooltip
                content={
                  translationRow === undefined
                    ? m.workshop_bin_transform_missing_hint()
                    : m.workshop_bin_transform_move_action()
                }
              >
                <IconButton
                  variant="ghost"
                  size="xs"
                  compact
                  disabled={translationRow?.value.type !== "vector"}
                  aria-label={m.workshop_bin_transform_move_action()}
                  aria-pressed={transformMode === "translate"}
                  className="aria-pressed:bg-accent-500/15 aria-pressed:text-accent-300"
                  icon={<ArrowsOutCardinalIcon weight="bold" className="h-4 w-4" />}
                  onClick={() => {
                    forcePreview.select(null);
                    setTransformMode(transformMode === "translate" ? null : "translate");
                  }}
                />
              </Tooltip>
              <Tooltip
                content={
                  rotationRow === undefined
                    ? m.workshop_bin_transform_missing_hint()
                    : m.workshop_bin_transform_rotate_action()
                }
              >
                <IconButton
                  variant="ghost"
                  size="xs"
                  compact
                  disabled={rotationRow?.value.type !== "vector"}
                  aria-label={m.workshop_bin_transform_rotate_action()}
                  aria-pressed={transformMode === "rotate"}
                  className="aria-pressed:bg-accent-500/15 aria-pressed:text-accent-300"
                  icon={<ArrowClockwiseIcon weight="bold" className="h-4 w-4" />}
                  onClick={() => {
                    forcePreview.select(null);
                    setTransformMode(transformMode === "rotate" ? null : "rotate");
                  }}
                />
              </Tooltip>
            </>
          )}
          <Tooltip content={m.workshop_bin_preview_fit_action()}>
            <IconButton
              variant="ghost"
              size="xs"
              compact
              aria-label={m.workshop_bin_preview_fit_action()}
              icon={<FrameCornersIcon weight="bold" className="h-4 w-4" />}
              onClick={requestFit}
            />
          </Tooltip>
          <RigControl />
        </div>

        <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1 select-none">
          {pinned !== null && (
            <span
              data-ui="VfxViewport:pinned"
              /* DS-RADIUS, DS-VEIL */
              className="flex items-center gap-1 rounded-sm bg-surface-veil py-0.5 pr-0.5 pl-1.5 text-meta text-accent-300"
            >
              {m.workshop_bin_random_pinned_label({ chance: pinned.toFixed(2) })}
              <button
                type="button"
                aria-label={m.workshop_bin_random_unpin_action()}
                className="flex cursor-pointer items-center rounded-sm p-0.5 text-surface-400 hover:bg-surface-veil hover:text-surface-100"
                onClick={() => setPinned(null)}
              >
                <XIcon weight="bold" className="h-3 w-3" />
              </button>
            </span>
          )}
          {undrawn.count > 0 && (
            <span className="rounded-sm bg-surface-veil px-1.5 py-0.5 text-meta text-surface-400">
              {m.workshop_bin_preview_undrawn_hint({
                count: undrawn.count,
                kinds: undrawn.kinds,
              })}
            </span>
          )}
          {attached > 0 && !host.ready && (
            <span className="rounded-sm bg-surface-veil px-1.5 py-0.5 text-meta text-surface-400">
              {m.workshop_bin_preview_attachment_hint({ count: attached })}
            </span>
          )}
          {customMaterials > 0 && (
            <span className="rounded-sm bg-surface-veil px-1.5 py-0.5 text-meta text-warning-text">
              {m.workshop_bin_preview_custom_material_hint({ count: customMaterials })}
            </span>
          )}
        </div>

        {stats && <Stats feed={feed} />}
      </div>

      <VfxHostControls host={host} />
      {transport === "mini" && (
        <RunTransport variant="mini" className="border-t border-surface-700/50" />
      )}
    </div>
  );
}

interface FitProps {
  /** Bumped per fit asked for, by the key or the button. */
  readonly token: number;
  readonly system: SystemModel;
  readonly drawn: readonly DrawnEmitter[];
  readonly rig: RigModel;
}

/**
 * The camera framed on the system's definition at its rig: as it opens, at each ask, and
 * on a change of preset or rig.
 *
 * The box is the definition's rather than the run's, so the frame is the same whenever it
 * is asked for. A change of preset frames again through the fit's identity, which follows
 * the preset.
 *
 * The opening frame is instant. A camera restored from the last system keeps its pose
 * while the middle of the box is in view, per "The viewer" in docs/ux/BIN_EDITOR.md.
 */
function Fit({ token, system, drawn, rig }: FitProps) {
  const snap = useFitCamera(false);
  const glide = useFitCamera();
  const sees = useSeesBounds();
  const preset = useCameraPreset();
  const [restored] = useState(() => lastCameraPose(VFX_CAMERA, preset) !== null);
  const bounds = useMemo(() => definitionBounds(system, drawn, rig), [system, drawn, rig]);
  const ground = useMemo(() => rigGround(system, rig), [system, rig]);
  const framing = useRef({ bounds, ground });
  framing.current = { bounds, ground };
  const opened = useRef(false);

  useEffect(() => {
    const { bounds: box, ground: origin } = framing.current;
    if (opened.current) {
      glide(box, origin);
      return;
    }

    const seen = restored ? sees(box) : false;
    if (seen === null) return;
    opened.current = seen || snap(box, origin);
  }, [glide, snap, sees, restored, rig, system.entry, token]);

  return null;
}

/** The longest a first load pauses the run at its start, so an asset that never lands still plays. */
const WARM_UP_LIMIT_MS = 4000;

/**
 * The run paused at its start while the first textures and meshes land.
 *
 * Answers the reports the two asset hooks take. A load an edit brings in comes after the
 * warm-up and pauses nothing, which decision 2.5 of docs/plans/vfx-particle-renderer.md keeps.
 */
function useWarmUp(drawn: readonly DrawnEmitter[], setWarming: (warming: boolean) => void) {
  const load = useRef({ drawn, textures: false, meshes: false, over: false });
  load.current.drawn = drawn;

  const settle = useCallback(() => {
    const current = load.current;
    if (current.over || !current.textures || !current.meshes) return;

    current.over = true;
    setWarming(false);
  }, [setWarming]);

  const reportTextures = useCallback(
    ({ pending }: AssetLoad) => {
      if (pending > 0 || load.current.drawn.length === 0) return;

      load.current.textures = true;
      settle();
    },
    [settle],
  );

  const reportMeshes = useCallback(
    ({ pending }: AssetLoad) => {
      if (pending > 0 || load.current.drawn.length === 0) return;

      load.current.meshes = true;
      settle();
    },
    [settle],
  );

  const loaded = drawn.length > 0;
  useEffect(() => {
    if (!loaded || load.current.over) return;

    setWarming(true);
    const limit = window.setTimeout(() => {
      load.current.over = true;
      setWarming(false);
    }, WARM_UP_LIMIT_MS);

    return () => {
      window.clearTimeout(limit);
      setWarming(false);
    };
  }, [loaded, setWarming]);

  return { reportTextures, reportMeshes };
}

interface ViewportNoticeProps {
  readonly text: string;
  /** The reason under the line, such as a failed read's error. */
  readonly detail?: string;
  readonly onRetry?: () => void;
}

/** A line over the viewport in place of the system, with a reason and a retry where one applies. */
function ViewportNotice({ text, detail, onRetry }: ViewportNoticeProps) {
  return (
    <div
      data-ui="VfxViewport:notice"
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center select-none"
    >
      <span className="text-meta text-surface-300">{text}</span>
      {detail !== undefined && (
        <span className="max-w-md text-meta break-words text-surface-400 select-text">
          {detail}
        </span>
      )}
      {onRetry !== undefined && (
        <Button variant="outline" size="xs" className="pointer-events-auto mt-1" onClick={onRetry}>
          {m.common_retry_action()}
        </Button>
      )}
    </div>
  );
}

/** The emitters that draw the mesh of a character, which a preview has none of. */
function attachmentCount(system: SystemModel | null): number {
  return (system?.emitters ?? []).filter(
    (emitter) => !emitter.disabled && drawsTheAttachment(emitter),
  ).length;
}

/**
 * The emitters T0 draws nothing for, and the primitives they name.
 *
 * The kinds are listed rather than counted alone, so a reader whose whole system stays
 * blank can see which tier is what they are waiting on.
 */
function undrawnKinds(system: SystemModel | null): { count: number; kinds: string } {
  const named = new Set<string>();
  let count = 0;

  for (const emitter of system?.emitters ?? []) {
    if (emitter.disabled || !isUndrawn(emitter)) continue;
    count += 1;
    named.add(emitter.primitiveName ?? emitter.primitiveClass ?? "");
  }

  return { count, kinds: [...named].sort().join(", ") };
}
