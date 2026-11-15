import {
  hashKey,
  queryOptions,
  skipToken,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type AssetRef, type BinDocumentId, type SkinModel } from "@/lib/tauri";
import {
  bindWorld,
  type ColliderFile,
  type Colliders,
  placeColliders,
  type Pose,
  viewportQueries,
} from "@/modules/viewport";

import { workshopKeys } from "../../../shared/api/keys";
import { skinQueries } from "../api/skinQueries";
import { colliderPathOf, shapesOf } from "../utils/colliders";
import { setLeafEdits } from "../utils/dynamicsEdits";
import { FIELD } from "../utils/dynamicsFields";
import type { WireChain } from "../utils/dynamicsModel";
import { useDynamicsEdit } from "./useDynamicsEdit";

const NO_FILES: ReadonlyMap<string, ColliderFile> = new Map();

/** The shapes a collider file shows while its saves are on their way. */
interface ColliderEdits {
  /** The shapes of the last commit. */
  readonly file: ColliderFile;
  /** The file the last save answered, and null while a save is on its way. */
  readonly saved: AssetRef | null;
}

/** The edits of the collider file at the game path `path`, which a commit writes and nothing fetches. */
function colliderEdits(path: string | null) {
  return queryOptions<ColliderEdits | null>({
    queryKey: ["collider-edits", path?.toLowerCase() ?? null],
    queryFn: skipToken,
    staleTime: Infinity,
  });
}

/** Whether the file `asset` holds what `edits` show, so a chain reading it needs them no more. */
function landedOn(edits: ColliderEdits, asset: AssetRef | null): boolean {
  return edits.saved !== null && asset !== null && hashKey([edits.saved]) === hashKey([asset]);
}

/** The game path the shapes of `chain` are saved at, and null for a skin with nowhere to save them. */
function filePathOf(
  skin: Pick<SkinModel, "skeleton">,
  entry: string,
  chain: WireChain,
): string | null {
  return chain.colliderFile?.path || colliderPathOf(skin, entry);
}

/**
 * The collision shapes of each dynamics chain that names a collider file this machine
 * holds, by the chain's hash path.
 *
 * A chain whose shapes are being saved answers the last commit, ahead of the file.
 */
export function useColliderFiles(
  skin: SkinModel | undefined,
  entry: string,
): ReadonlyMap<string, ColliderFile> {
  const client = useQueryClient();
  const modifiers = skin?.poseModifiers;
  const skeleton = skin?.skeleton ?? null;
  const chains = useMemo(() => {
    if (modifiers === undefined) return [];

    return modifiers.flatMap((modifier) =>
      modifier.kind === "dynamicsChain"
        ? [
            {
              chain: modifier.path,
              asset: modifier.colliderFile?.asset ?? null,
              file: filePathOf({ skeleton }, entry, modifier),
            },
          ]
        : [],
    );
  }, [modifiers, skeleton, entry]);

  const read = useQueries({
    queries: chains.map((chain) => viewportQueries.colliders(chain.asset)),
    combine: (results) => results.map((result) => result.data ?? null),
  });
  const edited = useQueries({
    queries: chains.map((chain) => colliderEdits(chain.file)),
    combine: (results) => results.map((result) => result.data ?? null),
  });

  useEffect(() => {
    chains.forEach((chain, at) => {
      const edits = edited[at];
      if (edits !== null && landedOn(edits, chain.asset)) {
        client.setQueryData(colliderEdits(chain.file).queryKey, null);
      }
    });
  }, [chains, edited, client]);

  return useMemo(() => {
    if (chains.length === 0) return NO_FILES;

    const files = new Map<string, ColliderFile>();
    chains.forEach((chain, at) => {
      const edits = edited[at];
      const shapes = edits !== null && !landedOn(edits, chain.asset) ? edits.file : read[at];
      if (shapes != null) files.set(chain.chain, shapes);
    });
    return files;
  }, [chains, read, edited]);
}

/** `files` placed on the skeleton of `pose`, each shape in the frame of the joint it rides. */
export function usePlacedColliders(
  files: ReadonlyMap<string, ColliderFile>,
  pose: Pose | null,
): ReadonlyMap<string, Colliders> {
  return useMemo(() => {
    const placed = new Map<string, Colliders>();
    if (pose === null || files.size === 0) return placed;

    const bind = bindWorld(pose.skeleton, pose.parents);
    for (const [path, shapes] of files) {
      placed.set(
        path,
        placeColliders(shapes, (name) => pose.jointNamed(name), bind),
      );
    }
    return placed;
  }, [files, pose]);
}

/** The saves of one collider file that have not all answered. */
interface Saves {
  /** The saves sent so far, which the next one waits for. */
  tail: Promise<void>;
  waiting: number;
  /** The chain names the file, or the edit that names it was sent. */
  named: boolean;
  /** The last save that landed, which a failed one falls back to. */
  landed: ColliderEdits | null;
}

/** The files being saved, by game path in lower case, which every pane of every view shares. */
const SAVES = new Map<string, Saves>();

/** The writes of a chain's collision shapes. */
export interface ColliderEdit {
  /** Save `file` as the chain's collider file, naming one on the chain that has none. */
  readonly commit: (chain: WireChain, file: ColliderFile) => void;
}

/**
 * The edit of the collision shapes of a skin's chains, and null where the view is read-only.
 *
 * The shapes live in a file of their own, which the chain names by path. A save writes
 * the file into the skin's layer, and the first save of a chain that names no file also
 * writes the path, as one edit of the document. The file is outside the document's undo.
 *
 * A commit shows at once and the saves of one file are sent one at a time, in the order of
 * their commits. A save that fails with none behind it returns the shapes to what the file
 * holds.
 */
export function useColliderEdit(
  document: BinDocumentId,
  entry: string,
  skin: SkinModel | undefined,
): ColliderEdit | null {
  const send = useDynamicsEdit(entry);
  const client = useQueryClient();
  const toast = useToast();

  return useMemo(() => {
    if (send === null || skin === undefined) return null;

    return {
      commit: (chain, file) => {
        const path = filePathOf(skin, entry, chain);
        if (path === null) {
          toast.error(m.workshop_bin_physics_colliders_failed_title());
          return;
        }

        const key = path.toLowerCase();
        const shown = colliderEdits(path).queryKey;
        const asset = chain.colliderFile?.asset ?? null;
        const saves: Saves = SAVES.get(key) ?? {
          tail: Promise.resolve(),
          waiting: 0,
          named: Boolean(chain.colliderFile?.path),
          landed: null,
        };
        SAVES.set(key, saves);
        saves.waiting += 1;
        client.setQueryData(shown, { file, saved: null });

        const save = async () => {
          const answer = await api.bin.saveSkinColliders(document, path, shapesOf(file));
          saves.waiting -= 1;
          const last = saves.waiting === 0;
          if (last) SAVES.delete(key);

          if (!answer.ok) {
            toast.failure(m.workshop_bin_physics_colliders_failed_title(), answer.error);
            if (last) client.setQueryData(shown, saves.landed);
            return;
          }

          saves.landed = { file, saved: answer.value };
          client.setQueryData(viewportQueries.colliders(answer.value).queryKey, file);
          if (last) client.setQueryData(shown, saves.landed);
          if (answer.value.kind === "layer") {
            /* A first save adds a file to the project's content. */
            void client.invalidateQueries({
              queryKey: workshopKeys.project(answer.value.project),
            });
          }

          if (!saves.named) {
            saves.named = true;
            send(
              setLeafEdits(chain.path, [FIELD.colliderFile], {
                type: "string",
                value: path,
              }),
            );
            return;
          }
          if (!landedOn(saves.landed, asset)) {
            /* The chain reads another file than the one saved, which the skin resolves next. */
            void client.invalidateQueries({
              queryKey: skinQueries.skin(document, entry).queryKey,
            });
          }
        };
        saves.tail = saves.tail.then(save);
      },
    };
  }, [send, skin, client, toast, document, entry]);
}
