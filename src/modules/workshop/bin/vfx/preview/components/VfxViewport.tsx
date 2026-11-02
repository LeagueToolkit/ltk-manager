import { XIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";
import {
  edgesOf,
  lastCameraPose,
  useCameraPreset,
  useFitCamera,
  useSeesBounds,
} from "@/modules/viewport";
import {
  usePreviewGizmo,
  usePreviewTargetHandle,
  usePreviewGround,
  usePreviewMasks,
  usePreviewMidlane,
  usePreviewStats,
  usePreviewViewMode,
  usePreviewWireOverlay,
} from "@/stores";

import type { PaneCommand } from "../../../menus/state/paneCommands";
import { CameraMenu } from "../../../shared/preview/CameraMenu";
import { ShadersToggle } from "../../../shared/preview/PreviewToggle";
import { PreviewViewport } from "../../../shared/preview/PreviewViewport";
import { SoundToggle } from "../../../shared/preview/SoundToggle";
import { ViewModeMenu } from "../../../shared/preview/ViewModeMenu";
import {
  ControlDivider,
  FitButton,
  RailSpacer,
  ViewportRail,
} from "../../../shared/preview/ViewportControls";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import type { EmitterModel, SystemModel } from "../../engine/model/model";
import { type Motion, retargetable, type RigModel } from "../../engine/model/rig";
import { ForceGizmo } from "../../forces/ForceGizmo";
import { useForcePreview } from "../../forces/forcePreview";
import { useForces } from "../../forces/useForces";
import { useReadOnlyReason, useShownPaneCommands } from "../../hooks/usePaneOffers";
import { vfxKeys } from "../../hooks/useVfxSystem";
import { useEmitters } from "../../inspector/state/emitterChoice";
import { RigControl } from "../../playback/components/RigControl";
import { RunTransport } from "../../playback/components/RunTransport";
import { useVfxRun } from "../../playback/state/run";
import { Passes } from "../../rendering/components/Passes";
import { ShimmerMeshes } from "../../rendering/components/ShimmerMeshes";
import { createStatsFeed, Stats, StatsProbe } from "../../rendering/components/Stats";
import { VfxSystem } from "../../rendering/components/VfxSystem";
import { useVfxMeshes } from "../../rendering/hooks/useVfxMeshes";
import { useVfxTextures } from "../../rendering/hooks/useVfxTextures";
import { createPickRegistry } from "../../rendering/state/pick";
import { type DrawnEmitter, drawnEmitters, hiddenIn } from "../../rendering/utils/definitions";
import { distorts, drawsTheAttachment, isUndrawn } from "../../rendering/utils/drawKind";
import { fades } from "../../rendering/utils/softParticle";
import { definitionBounds, rigGround } from "../../rendering/utils/systemBounds";
import { chosenEmitter } from "../../timeline/utils/selection";
import { handleAddsCommand, handleCommand, VFX_PANE } from "../../utils/vfxCommands";
import { useWarmUp } from "../hooks/useWarmUp";
import { createGrabLatch } from "../utils/grabLatch";
import {
  HANDLE_KINDS,
  handleBlock,
  type HandleKind,
  isOverride,
  OVERRIDE_FIELD,
  overrideEdit,
} from "../utils/spatialHandles";
import { EmitterMarks } from "./EmitterMarks";
import { EmitterTransform, type TransformMode } from "./EmitterTransform";
import { HandleMenu } from "./HandleMenu";
import type { PreviewTransport } from "./PreviewPane";
import { RigTarget } from "./RigTarget";
import { ShowMenu } from "./ShowMenu";
import { SpatialHandle } from "./SpatialHandle";
import { useVfxHost, VfxHost } from "./VfxHost";
import { ViewportPick } from "./ViewportPick";

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
    mutedChildren,
    soloedChildren,
    fitRequest,
    requestFit,
    pinned,
    setPinned,
    setWarming,
    document,
    unresolvedSounds,
  } = useVfxRun();
  const host = useVfxHost();
  const posed = host.joints !== null || rig.rig.joints != null;
  const drawn = useMemo(
    () => (system === null ? [] : drawnEmitters(system, posed)),
    [system, posed],
  );
  const framed = useFramedRig(rig.rig);
  const { reportTextures, reportMeshes } = useWarmUp(drawn, setWarming);
  const textures = useVfxTextures(drawn, reportTextures);
  const meshes = useVfxMeshes(drawn, reportMeshes);
  useEffect(() => driver.setHostJoints(host.joints), [driver, host.joints]);
  const unit = useMemo(
    () => (host.pose === null ? null : { pose: host.pose, offset: host.offset }),
    [host.pose, host.offset],
  );
  const queries = useQueryClient();
  const picks = useMemo(createPickRegistry, []);
  const latch = useMemo(createGrabLatch, []);

  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const gizmo = usePreviewGizmo();
  const targetHandle = usePreviewTargetHandle();
  const masks = usePreviewMasks();
  const stats = usePreviewStats();
  const viewMode = usePreviewViewMode();
  const wireOverlay = usePreviewWireOverlay();

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
  const [handle, setHandle] = useState<HandleKind | null>(null);
  const transformMode: TransformMode | null =
    handle === "offset" ? "translate" : handle === "turn" ? "rotate" : null;
  const spatial = handle === null || handle === "offset" || handle === "turn" ? null : handle;
  const translationRow = root?.fields(OVERRIDE_FIELD.offset);
  const rotationRow = root?.fields(OVERRIDE_FIELD.turn);
  /* A handle whose override the file does not hold writes it as it is chosen, so its item in
     the menu is the way to start authoring it. */
  const adds = (kind: HandleKind) =>
    isOverride(kind) &&
    (kind === "offset" ? translationRow : rotationRow) === undefined &&
    root !== undefined &&
    edit?.editProperty !== undefined;
  const choose = async (kind: HandleKind | null) => {
    forcePreview.select(null);
    setHandle(kind);
    if (kind === null || !isOverride(kind) || !adds(kind)) return;

    const { field, edits } = overrideEdit(kind);
    const written = await edit?.editProperty?.(root!.row, field, edits);
    if (written !== true) setHandle((held) => (held === kind ? null : held));
  };
  const transformRow = transformMode === "translate" ? translationRow : rotationRow;
  const selected = chosenEmitter(system, root);
  const feed = useMemo(createStatsFeed, []);

  const undrawn = useMemo(() => undrawnKinds(system), [system]);
  const customMaterials = drawn.filter(({ emitter }) => emitter.customMaterial !== null).length;
  const attached = useMemo(() => attachmentCount(system), [system]);
  const warps = useMemo(() => drawn.some((definition) => distorts(definition.emitter)), [drawn]);
  const softens = useMemo(() => drawn.some((definition) => fades(definition.emitter)), [drawn]);

  const hiddenOf = (definition: DrawnEmitter) =>
    hiddenIn(definition, { muted, soloed, mutedChildren, soloedChildren });

  /* The viewport stays mounted while a system reads, fails or draws nothing, so the camera,
     the ground and the renderer carry from one system to the next. */
  const shown = system !== null && system.emitters.length > 0 ? system : null;
  const opened = shown?.emitters.find((emitter) => emitter.index === selected) ?? null;
  const handleable = edit !== null && child === null && opened !== null;
  const readOnly = useReadOnlyReason();

  useShownPaneCommands(VFX_PANE.viewport, {
    [handleCommand("none")]: {
      run: handleable ? () => void choose(null) : null,
      checked: handle === null,
      reason: readOnly ?? m.workshop_bin_menu_vfx_emitter_reason(),
    },
    ...Object.fromEntries(
      HANDLE_KINDS.flatMap((kind): [string, PaneCommand][] => {
        const hint = opened === null ? null : handleHint(kind, opened, translationRow, rotationRow);

        return [
          [
            handleCommand(kind),
            {
              run: handleable && hint === null ? () => void choose(kind) : null,
              checked: handle === kind,
              reason: hint ?? readOnly ?? m.workshop_bin_menu_vfx_emitter_reason(),
            },
          ],
          [handleAddsCommand(kind), { run: null, checked: adds(kind) }],
        ];
      }),
    ),
  });

  return (
    <div data-ui="VfxViewport" className="flex min-h-0 flex-1 flex-col select-none">
      <ViewportRail side="top" data-ui="VfxViewport:controls">
        {handleable && (
          <>
            <HandleMenu
              value={handle}
              blocked={(kind) => handleHint(kind, opened, translationRow, rotationRow)}
              adds={adds}
              onChange={(kind) => void choose(kind)}
            />
            <ControlDivider />
          </>
        )}
        <RigControl />
        <RailSpacer />
        <div className="flex shrink-0 items-center gap-0.5">
          <ShowMenu />
          <ShadersToggle />
          <SoundToggle unresolved={unresolvedSounds} />
          <ViewModeMenu />
        </div>
        <ControlDivider />
        <div className="flex shrink-0 items-center gap-0.5">
          <CameraMenu />
          <FitButton label={m.workshop_bin_preview_fit_action()} onFit={requestFit} />
        </div>
      </ViewportRail>
      <div className="relative min-h-0 flex-1">
        <PreviewViewport
          renderer="shared"
          cameraMemory={VFX_CAMERA}
          stage={ground}
          textured={midlane}
        >
          <Passes warps={warps} softens={softens} />
          {system?.entry != null && <ShimmerMeshes document={document} entry={system.entry} />}
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
                  picks={picks}
                  unit={unit}
                  masks={masks}
                />
              </VfxHost>
              <ViewportPick picks={picks} system={shown} latch={latch} />
              <Fit token={fitRequest} system={shown} drawn={drawn} rig={framed} />
              <EmitterMarks
                system={shown}
                driver={driver}
                opened={child === null ? opened : null}
                gizmo={gizmo}
                handle={edit !== null && selectedForce === undefined ? spatial : null}
              />
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
                    onGrab={latch.grab}
                  />
                )}
              {edit !== null &&
                selectedForce === undefined &&
                child === null &&
                opened !== null &&
                root !== undefined &&
                spatial !== null &&
                handleBlock(spatial, opened) === null && (
                  <SpatialHandle
                    key={`${root.key}:${spatial}`}
                    system={shown}
                    emitter={opened}
                    holder={root.row}
                    kind={spatial}
                    edit={edit}
                    onGrab={latch.grab}
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
                  onGrab={latch.grab}
                />
              )}
              {targetHandle &&
                retargetable(rig.rig.motion) &&
                handle === null &&
                selectedForce === undefined && <RigTarget onGrab={latch.grab} />}
              {stats && <StatsProbe driver={driver} drawn={drawn} feed={feed} />}
            </>
          )}
        </PreviewViewport>

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
                <XIcon weight="bold" className="size-3" />
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

/**
 * Returns the rig the camera frames, which keeps its identity while only the still rig's
 * beam target changes, so a target drag does not reframe the camera.
 */
function useFramedRig(rig: RigModel): RigModel {
  const [framed, setFramed] = useState(rig);
  if (framed !== rig && !onlyTargetMoved(framed, rig)) setFramed(rig);

  return framed;
}

/** Returns whether `next` differs from `held` only in the target that `RigTarget` moves. */
function onlyTargetMoved(held: RigModel, next: RigModel): boolean {
  return (
    sameButTarget(held.motion, next.motion) &&
    held.life === next.life &&
    held.height === next.height &&
    held.stopAt === next.stopAt &&
    held.joints === next.joints
  );
}

/** Returns whether two motions are the same still rig or missile, apart from the target. */
function sameButTarget(held: Motion, next: Motion): boolean {
  if (held.kind === "still" && next.kind === "still") return true;
  if (held.kind !== "missile" || next.kind !== "missile") return false;

  return held.from === next.from && held.flight === next.flight;
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
        <Button variant="outline" size="sm" className="pointer-events-auto mt-1" onClick={onRetry}>
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

/** Why the handle picker lists `kind` disabled for `emitter`, and null where it can edit it. */
function handleHint(
  kind: HandleKind,
  emitter: EmitterModel,
  translationRow: BinRow | undefined,
  rotationRow: BinRow | undefined,
): string | null {
  if (isOverride(kind)) {
    const row = kind === "offset" ? translationRow : rotationRow;
    if (row === undefined || row.value.type === "vector") return null;
    return m.workshop_bin_transform_missing_hint();
  }

  const block = handleBlock(kind, emitter);
  if (block === "animated") return m.workshop_bin_handle_animated_hint();
  if (block === "noShape") return m.workshop_bin_handle_no_shape_hint();
  if (block === "noMesh") return m.workshop_bin_handle_no_mesh_hint();
  return null;
}
