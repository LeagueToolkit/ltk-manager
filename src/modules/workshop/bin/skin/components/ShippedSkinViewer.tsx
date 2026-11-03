import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { m } from "@/i18n";
import {
  api,
  type BinDocumentId,
  type GraphClip,
  type ShippedSkin,
  type SkinModel,
} from "@/lib/tauri";
import {
  Character,
  createPose,
  createSceneClock,
  FitCamera,
  meshBounds,
  sequencePose,
  type SubmeshOutline,
  useAssetTextures,
  useSceneColors,
  Viewport,
  viewportQueries,
} from "@/modules/viewport";

import { projectSandbox } from "../../../sandbox/utils/sandboxRef";
import { Notice } from "../../shared/preview/Notice";
import { Passes } from "../../vfx/rendering/components/Passes";
import { skinQueries } from "../api/skinQueries";
import { useSkinOutlines } from "../hooks/useSkinOutlines";
import { useSkinPrograms } from "../hooks/useSkinPrograms";
import { clipFrameSeconds } from "../utils/clipEvents";
import {
  bindingOf,
  openingClip,
  playableClips,
  playlistOf,
  DATA_TEXTURES,
  dataTextureAssets,
  textureAssets,
} from "../utils/skinScene";
import { Clock } from "./Clock";

const NO_CLIPS: readonly GraphClip[] = [];

const FEET = [0, 0, 0] as const;

export interface ShippedSkinViewerProps {
  readonly skin: ShippedSkin;
  /** Rewrites each submesh's outline before it draws, for a value the bins do not hold yet. */
  readonly adjustOutline?: (outline: SubmeshOutline) => SubmeshOutline;
}

/**
 * One skin of a project on its idle clip, drawn with the game's shaders under an orbit camera
 * that frames it. The viewer takes no edits.
 */
export function ShippedSkinViewer({ skin, adjustOutline }: ShippedSkinViewerProps) {
  const document = useSkinDocument(skin);

  return (
    <div
      data-ui="ShippedSkinViewer"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden select-none"
      role="group"
      aria-label={m.workshop_bin_mesh_preview_label()}
    >
      {document === "failed" && <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />}
      {document === null && <Notice text={m.workshop_bin_mesh_preview_loading_label()} />}
      {typeof document === "number" && (
        <SkinRead document={document} entry={skin.entry} adjustOutline={adjustOutline} />
      )}
    </div>
  );
}

/**
 * Holds the bin of `skin` open in its project's sandbox while the caller is mounted. Returns
 * null while it opens and `"failed"` if the open fails.
 *
 * Opens without `useBinDocument`, which reads the project's content tree to decide whether a
 * declared document takes edits, and this document takes none.
 */
function useSkinDocument(skin: ShippedSkin): BinDocumentId | "failed" | null {
  const [document, setDocument] = useState<BinDocumentId | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    let opened: BinDocumentId | null = null;
    setDocument(null);

    void api.bin.open(projectSandbox(skin.project), skin.asset, skin.entry).then((result) => {
      if (!result.ok) {
        if (live) setDocument("failed");
        return;
      }

      opened = result.value.document;
      if (live) setDocument(opened);
      else void api.bin.close(opened);
    });

    return () => {
      live = false;
      if (opened !== null) void api.bin.close(opened);
    };
  }, [skin]);

  return document;
}

interface SkinReadProps {
  document: BinDocumentId;
  entry: string;
  adjustOutline?: (outline: SubmeshOutline) => SubmeshOutline;
}

function SkinRead({ document, entry, adjustOutline }: SkinReadProps) {
  const read = useQuery(skinQueries.skin(document, entry));

  if (read.error !== null) return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  if (read.data === undefined) return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;

  return <SkinStage document={document} skin={read.data} adjustOutline={adjustOutline} />;
}

interface SkinStageProps {
  document: BinDocumentId;
  skin: SkinModel;
  adjustOutline?: (outline: SubmeshOutline) => SubmeshOutline;
}

function SkinStage({ document, skin, adjustOutline }: SkinStageProps) {
  const clock = useMemo(createSceneClock, []);
  const mesh = useQuery(viewportQueries.mesh(skin.mesh?.asset ?? null));
  const skeleton = useQuery(viewportQueries.skeleton(skin.skeleton?.asset ?? null));
  const graph = useQuery(skinQueries.graph(document, skin.animationGraph));

  const playlist = useMemo(() => {
    if (graph.data === undefined) return NO_CLIPS;

    const idle = openingClip(playableClips(graph.data.clips));
    return idle === null ? NO_CLIPS : playlistOf(idle, graph.data.clips);
  }, [graph.data]);
  const clipModels = useQueries({
    queries: playlist.map((step) => viewportQueries.clip(step.animation?.asset ?? null)),
    combine: (results) => results.map((result) => result.data ?? null),
  });
  const pose = useMemo(() => {
    const bones = skeleton.data;
    if (bones === undefined) return null;

    const steps = clipModels.map((model, at) =>
      createPose(bones, model, clipFrameSeconds(playlist[at], model?.fps ?? null)),
    );
    return sequencePose(bones, steps);
  }, [skeleton.data, clipModels, playlist]);

  const scale = skin.scale ?? 1;
  const assets = useMemo(() => textureAssets(skin), [skin]);
  const textures = useAssetTextures(assets);
  const dataAssets = useMemo(() => dataTextureAssets(skin), [skin]);
  const maps = useAssetTextures(dataAssets, DATA_TEXTURES);
  const bindingFor = useCallback(
    (submesh: string) => bindingOf(skin, textures, submesh, maps),
    [skin, textures, maps],
  );
  const programsFor = useSkinPrograms(document, skin, true, Boolean(mesh.data?.tangents));
  const listedOutlines = useSkinOutlines(document, skin, true);
  const outlineFor = useMemo(() => {
    if (adjustOutline === undefined) return listedOutlines;
    return (submesh: string) => {
      const outline = listedOutlines(submesh);
      return outline === null ? null : adjustOutline(outline);
    };
  }, [listedOutlines, adjustOutline]);
  const colors = useSceneColors();
  const bounds = useMemo(
    () => (mesh.data === undefined ? null : meshBounds(mesh.data, skin.hidden, scale)),
    [mesh.data, skin.hidden, scale],
  );

  if (!skin.mesh?.asset || !skin.skeleton?.asset) {
    return <Notice text={m.workshop_bin_mesh_preview_missing_empty()} />;
  }
  if (mesh.error !== null || skeleton.error !== null) {
    return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  }
  if (mesh.data === undefined || pose === null) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }

  return (
    <Viewport renderer="shared" stage textured={false} camera="orbit">
      <Clock clock={clock} playing speed={1} />
      <FitCamera bounds={bounds} ground={FEET} token={0} />
      <Passes warps={false} softens={false} />
      <Character
        mesh={mesh.data}
        pose={pose}
        clock={clock}
        bindingOf={bindingFor}
        programsOf={programsFor}
        outlineOf={outlineFor}
        colors={colors}
        hidden={skin.hidden}
        scale={scale}
        selfIllumination={skin.selfIllumination ?? 0}
      />
    </Viewport>
  );
}
