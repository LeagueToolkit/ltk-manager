import { FrameCornersIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useFitCamera, Viewport } from "@/modules/viewport";
import {
  usePreviewCamera,
  usePreviewGizmo,
  usePreviewGround,
  usePreviewMidlane,
  usePreviewStats,
  usePreviewWireframe,
  useSetPreviewDisplay,
} from "@/stores";

import { useEmitters } from "../emitterChoice";
import { CameraMenu } from "./CameraMenu";
import { type DrawnEmitter, drawnEmitters } from "./definitions";
import { distorts, drawsTheAttachment, isUndrawn } from "./drawKind";
import { EmitterGizmo } from "./EmitterGizmo";
import type { SystemModel } from "./model";
import { Notice } from "./Notice";
import { Passes } from "./Passes";
import type { PreviewTransport } from "./PreviewPane";
import type { RigModel } from "./rig";
import { RigControl } from "./RigControl";
import { useVfxRun } from "./run";
import { RunTransport } from "./RunTransport";
import { chosenEmitter } from "./selection";
import { ShowMenu } from "./ShowMenu";
import { fades } from "./softParticle";
import { createStatsFeed, Stats, StatsProbe } from "./Stats";
import { definitionBounds, rigGround } from "./systemBounds";
import { useVfxMeshes } from "./useVfxMeshes";
import { useVfxTextures } from "./useVfxTextures";
import { VfxSystem } from "./VfxSystem";
import { WireframeMenu } from "./WireframeMenu";

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
  const textures = useVfxTextures(drawn);
  const meshes = useVfxMeshes(drawn);

  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const gizmo = usePreviewGizmo();
  const stats = usePreviewStats();
  const camera = usePreviewCamera();
  const wireframe = usePreviewWireframe();
  const setDisplay = useSetPreviewDisplay();

  const { root } = useEmitters();
  const selected = chosenEmitter(system, root);
  const feed = useMemo(createStatsFeed, []);

  const undrawn = useMemo(() => undrawnKinds(system), [system]);
  const attached = useMemo(() => attachmentCount(system), [system]);
  const warps = useMemo(() => (system?.emitters ?? []).some(distorts), [system]);
  const softens = useMemo(() => drawn.some((definition) => fades(definition.emitter)), [drawn]);

  const hiddenOf = (definition: DrawnEmitter) =>
    muted.has(definition.root) || (soloed.size > 0 && !soloed.has(definition.root));

  /* A texture lands some frames after the run starts, and a one-shot effect can be over
     by then, so the run starts again as each lands while it is still inside its first
     pass. Past that the reader has seen it play, and a restart would take that away. A
     run resumed where a tab left it is one the reader has already watched.

     The span is read through a ref rather than a dependency: it moves with the rig, and
     a rig the reader is dragging would otherwise start the effect over on every frame of
     the drag, which is what `driver.steer` exists to avoid. */
  const reach = useRef(span);
  reach.current = span;
  useEffect(() => {
    if (!resumed && driver.time <= reach.current) restart();
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
          stage={ground}
          textured={midlane}
          camera={camera}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
        >
          <Passes warps={warps} softens={softens} />
          <VfxSystem
            drawn={drawn}
            driver={driver}
            textures={textures}
            meshes={meshes}
            hiddenOf={hiddenOf}
            wireframe={wireframe}
          />
          <Fit token={fitRequest} system={system} drawn={drawn} rig={rig.rig} />
          {gizmo && opened !== null && (
            <EmitterGizmo system={system} driver={driver} emitter={opened} />
          )}
          {stats && <StatsProbe driver={driver} drawn={drawn} feed={feed} />}
        </Viewport>

        <div
          data-ui="VfxViewport:controls"
          /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-surface-veil bg-scrim p-0.5 shadow-md backdrop-blur-sm [&_button]:text-meta"
        >
          <ShowMenu />
          <WireframeMenu />
          <CameraMenu />
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
          {attached > 0 && (
            <span className="rounded-sm bg-surface-veil px-1.5 py-0.5 text-meta text-surface-400">
              {m.workshop_bin_preview_attachment_hint({ count: attached })}
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
 * is asked for. A change of preset frames again through the fit's own identity, which
 * follows the preset.
 */
function Fit({ token, system, drawn, rig }: FitProps) {
  const fit = useFitCamera();
  const bounds = useMemo(() => definitionBounds(system, drawn, rig), [system, drawn, rig]);
  const ground = useMemo(() => rigGround(system, rig), [system, rig]);

  useEffect(() => {
    fit(bounds, ground);
  }, [bounds, fit, ground, token]);

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
