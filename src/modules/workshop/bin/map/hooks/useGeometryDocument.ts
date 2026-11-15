import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import {
  api,
  type AssetRef,
  type BinDocumentId,
  type MapGeometryChange,
  type MapGeometryEdit,
  type MapGeometryState,
  type MeshDelta,
} from "@/lib/tauri";
import { useDocumentSave } from "@/modules/editor";
import { fetchEditedMap, type MapGeometry, viewportQueries } from "@/modules/viewport";

import { assetKey } from "../../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { useWorkshopEditorStore } from "../../../state";
import { useBeforeTest } from "../../../testing/state/beforeTest";
import { applyMeshDeltas, insertedMeshes } from "../utils/geometryDeltas";

/** Where a save of the `.mapgeo` lands: the layer the map's bin writes to, at `path`. */
export interface GeometryTarget {
  /** The open `.materials.bin`, whose layer a game file is written into. */
  readonly materials: BinDocumentId | null;
  /** The `.mapgeo`'s chunk path, `data/<map>.mapgeo`. */
  readonly path: string | null;
}

/** A `.mapgeo` held open for edits, and what the map editor does to it. */
export interface GeometryDocument {
  /** The open document's id, revision and unsaved state, and null while none is open. */
  readonly state: MapGeometryState | null;
  /** The document is being opened. It is false once it is open or the open failed. */
  readonly opening: boolean;
  /**
   * Applies `edit` as one undo step and resolves with what it did to the meshes, or null,
   * after a toast, if it was refused.
   */
  readonly edit: (edit: MapGeometryEdit) => Promise<readonly MeshDelta[] | null>;
  /** Steps the history back or forward. Resolves null if it took no step. */
  readonly step: (undo: boolean) => Promise<readonly MeshDelta[] | null>;
  /** Writes the file if it holds unsaved changes. Resolves false, after a toast, if it failed. */
  readonly save: () => Promise<boolean>;
}

/**
 * Holds `asset` open as a `.mapgeo` that takes edits while `enabled`, and closes it after.
 *
 * Each change is applied to the map buffer the viewport draws from the deltas it answers, so
 * an edit reads back only the meshes it adds. The file saves on request, before a Test, on a
 * quit that asks to save, and when the scene closes. Per "Saving geometry" in
 * docs/ux/MAP_EDITOR.md.
 */
export function useGeometryDocument(
  asset: AssetRef | null,
  enabled: boolean,
  target: GeometryTarget,
): GeometryDocument {
  const [state, setState] = useState<MapGeometryState | null>(null);
  /* The key whose open failed, so a failure ends the wait without a retry loop. */
  const [failed, setFailed] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const latest = useRef(state);
  latest.current = state;
  const aim = useRef(target);
  aim.current = target;

  /* Keyed by its text, so a fresh object for the same file keeps the document open. */
  const key = asset === null ? null : assetKey(asset);
  const held = useRef(asset);
  held.current = asset;

  /* A second request during a write joins it, because each write bakes the whole map. */
  const writing = useRef<Promise<boolean> | null>(null);
  const write = useCallback(() => {
    if (writing.current !== null) return writing.current;

    const open = latest.current;
    const { materials, path } = aim.current;
    if (open === null || !open.dirty) return Promise.resolve(true);
    if (materials === null || path === null) return Promise.resolve(false);

    const started = api.bin
      .mapGeometrySave(open.id, materials, path)
      .then((result) => {
        if (!result.ok) {
          toast.failure(m.workshop_bin_map_geometry_save_failed_title(), result.error);
          return false;
        }

        if (latest.current?.id === open.id) setState({ ...latest.current, dirty: false });
        return true;
      })
      .finally(() => {
        writing.current = null;
      });
    writing.current = started;

    return started;
  }, [toast]);

  useEffect(() => {
    const opening = held.current;
    if (!enabled || key === null || opening === null) return;

    let id: number | null = null;
    let closed = false;
    void api.bin.mapGeometryOpen(opening).then((opened) => {
      if (!opened.ok) {
        toast.failure(m.workshop_bin_map_geometry_open_failed_title(), opened.error);
        setFailed(key);
        return;
      }
      if (closed) {
        void api.bin.mapGeometryClose(opened.value.id);
        return;
      }
      id = opened.value.id;
      setState(opened.value);
    });

    return () => {
      closed = true;
      const open = latest.current;
      setState(null);
      if (id === null) return;

      const closing = id;
      const saving = open !== null && open.dirty ? write() : Promise.resolve(true);
      void saving.finally(() => void api.bin.mapGeometryClose(closing));
    };
  }, [key, enabled, toast, write]);

  /* One change at a time, so each reads the buffer the one before it left. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const land = useCallback(
    (change: MapGeometryChange) => {
      setState(change.state);
      if (held.current === null) return Promise.resolve();

      const owner = held.current;
      const { id } = change.state;
      const entry = viewportQueries.editedMap(owner, { document: id }).queryKey;
      const next = queue.current.then(async () => {
        const inserts = insertedMeshes(change.deltas);
        const inserted = inserts.length === 0 ? null : await fetchEditedMap(owner, id, inserts);
        queryClient.setQueryData<MapGeometry>(entry, (current) =>
          current === undefined ? current : applyMeshDeltas(current, change.deltas, inserted),
        );
      });
      queue.current = next.catch(() => {
        /* A failed read leaves the drawn map behind the document, so read it whole again. */
        void queryClient.invalidateQueries({ queryKey: entry });
      });
      return queue.current;
    },
    [queryClient],
  );

  const edit = useCallback(
    async (change: MapGeometryEdit) => {
      const open = latest.current;
      if (open === null) return null;

      const result = await api.bin.mapGeometryEdit(open.id, change);
      if (!result.ok) {
        toast.failure(m.workshop_bin_edit_refused_title(), result.error);
        return null;
      }
      await land(result.value);
      return result.value.deltas;
    },
    [toast, land],
  );

  const step = useCallback(
    async (undo: boolean) => {
      const open = latest.current;
      if (open === null) return null;

      const result = await api.bin.mapGeometryStep(open.id, undo);
      if (!result.ok) {
        const title = undo
          ? m.workshop_bin_undo_failed_title()
          : m.workshop_bin_redo_failed_title();
        toast.failure(title, result.error);
        return null;
      }
      if (result.value === null) return null;

      await land(result.value);
      return result.value.deltas;
    },
    [toast, land],
  );

  /* The quit question and a Test both reach the save under the file's own id. */
  const documentId = `map-geometry:${key ?? ""}`;
  const dirty = state?.dirty === true;
  const project = useOptionalProjectContext()?.path ?? null;
  const setDocumentDirty = useWorkshopEditorStore((store) => store.setDocumentDirty);
  useEffect(() => {
    if (project === null) return;

    setDocumentDirty(project, documentId, dirty);
    return () => setDocumentDirty(project, documentId, false);
  }, [project, documentId, dirty, setDocumentDirty]);
  const throwing = useCallback(async () => {
    if (!(await write())) throw new Error(m.workshop_bin_map_geometry_save_failed_title());
  }, [write]);
  useDocumentSave(documentId, throwing);
  useBeforeTest(documentId, dirty ? throwing : null);

  const opening = enabled && key !== null && state === null && failed !== key;
  return { state, opening, edit, step, save: write };
}
