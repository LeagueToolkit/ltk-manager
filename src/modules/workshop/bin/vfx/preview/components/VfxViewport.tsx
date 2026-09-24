import {
  ArrowsOutCardinalIcon,
  ArrowClockwiseIcon,
  FrameCornersIcon,
  XIcon,
} from "@phosphor-icons/react";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import { edgesOf, useFitCamera, Viewport } from "@/modules/viewport";
import {
  usePreviewAntiAliasing,
  usePreviewCamera,
  usePreviewGizmo,
  usePreviewGround,
  usePreviewMidlane,
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
import { Notice } from "./Notice";
import type { PreviewTransport } from "./PreviewPane";
import { ShowMenu } from "./ShowMenu";
import { useVfxHost, VfxHost, VfxHostControls } from "./VfxHost";
import { ViewModeMenu } from "./ViewModeMenu";

export interface VfxViewportProps {
  transport: PreviewTransport;
}

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
    span,
    resumed,
    restart,
    fitRequest,
    requestFit,
    pinned,
    setPinned,
  } = useVfxRun();
  const drawn = useMemo(() => (system === null ? [] : drawnEmitters(system)), [system]);
  const firstLoad = useRef({ drawn, landed: false, over: false });
  firstLoad.current.drawn = drawn;
  const reportTextures = useCallback((load: AssetLoad) => {
    const first = firstLoad.current;
    if (load.pending === 0 && first.drawn.length > 0) first.landed = true;
  }, []);
  const textures = useVfxTextures(drawn, reportTextures);
  const meshes = useVfxMeshes(drawn);
  const host = useVfxHost();

  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const gizmo = usePreviewGizmo();
  const stats = usePreviewStats();
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const viewMode = usePreviewViewMode();
  const wireOverlay = usePreviewWireOverlay();
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

  /* A texture lands some frames after the run starts, and a one-shot effect can be over
     by then, so the run starts again as each lands while it is still inside its first
     pass. Past that the reader has seen it play, and a restart would take that away. A
     run resumed where a tab left it is one the reader has already watched. Only the first
     load restarts: a texture an edit brings in lands on a run the reader is editing, which
     decision 2.5 keeps.

     The span is read through a ref rather than a dependency: it moves with the rig, and
     a rig the reader is dragging would otherwise start the effect over on every frame of
     the drag, which is what `driver.steer` exists to avoid. */
  const reach = useRef(span);
  reach.current = span;
  useEffect(() => {
    const first = firstLoad.current;
    if (first.over) return;

    if (!resumed && driver.time <= reach.current) restart();
    if (first.landed) first.over = true;
  }, [driver, resumed, restart, textures]);

  if (pending) return <Notice text={m.workshop_bin_preview_loading_label()} />;
  if (error !== null) return <Notice text={m.workshop_bin_preview_failed_empty()} />;
  if (system === null || system.emitters.length === 0) {
    return <Notice text={m.workshop_bin_preview_emitters_empty()} />;
  }

  const opened = system.emitters.find((emitter) => emitter.index === selected) ?? null;

  return (
    <div data-ui="VfxViewport" className="flex min-h-0 flex-1 flex-col select-none">
      <div className="relative min-h-0 flex-1">
        <Viewport
          antiAliasing={antiAliasing}
          stage={ground}
          textured={midlane}
          camera={camera}
          viewMode={viewMode}
          wireOverlay={wireOverlay}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
        >
          <Passes warps={warps} softens={softens} />
          <VfxHost host={host}>
            <VfxSystem
              drawn={drawn}
              driver={driver}
              textures={textures}
              meshes={meshes}
              hiddenOf={hiddenOf}
              edges={edgesOf(viewMode, wireOverlay)}
            />
          </VfxHost>
          <Fit token={fitRequest} system={system} drawn={drawn} rig={rig.rig} />
          {gizmo && opened !== null && (
            <EmitterGizmo system={system} driver={driver} emitter={opened} />
          )}
          {edit !== null &&
            selectedForce === undefined &&
            child === null &&
            opened !== null &&
            transformMode !== null &&
            transformRow?.value.type === "vector" && (
              <EmitterTransform
                key={`${root?.key}:${transformMode}`}
                system={system}
                emitter={opened}
                row={transformRow}
                mode={transformMode}
                edit={edit}
              />
            )}
          {selectedForce !== undefined && opened !== null && (
            <ForceGizmo
              key={`${root?.key}:${selectedForce.key}`}
              system={system}
              emitter={opened}
              force={selectedForce}
              handle={forcePreview.handle}
              edit={forceActive ? edit : null}
            />
          )}
          {stats && <StatsProbe driver={driver} drawn={drawn} feed={feed} />}
        </Viewport>

        <div
          data-ui="VfxViewport:controls"
          /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-surface-veil bg-scrim p-0.5 shadow-md backdrop-blur-sm [&_button]:text-meta"
        >
          <ShowMenu />
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
 * is asked for. A change of preset frames again through the fit's own identity, which
 * follows the preset.
 */
function Fit({ token, system, drawn, rig }: FitProps) {
  const fit = useFitCamera();
  const bounds = useMemo(() => definitionBounds(system, drawn, rig), [system, drawn, rig]);
  const ground = useMemo(() => rigGround(system, rig), [system, rig]);
  const framing = useRef({ bounds, ground });
  framing.current = { bounds, ground };

  useEffect(() => {
    fit(framing.current.bounds, framing.current.ground);
  }, [fit, rig, system.entry, token]);

  return null;
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
