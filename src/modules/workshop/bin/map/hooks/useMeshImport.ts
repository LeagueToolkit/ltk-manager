import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type ModelSummary, type ObjectCreation } from "@/lib/tauri";

import type { GroundProbeFn } from "../components/GroundProbe";
import { useMapScene } from "../state/mapScene";
import {
  importEdit,
  isModelPath,
  materialImports,
  MODEL_EXTENSIONS,
  type MeshImportOptions,
} from "../utils/meshImport";
import { meshId } from "../utils/meshSelection";

type Point = readonly [number, number, number];

/** A model file that the import dialog is open on. */
export interface MeshImportRequest {
  readonly path: string;
  readonly summary: ModelSummary;
  /** The ground under the viewport's center, and null if the view meets no ground. */
  readonly center: Point | null;
  /** The ground under the point the file was dropped at, and null for a picked file. */
  readonly drop: Point | null;
}

/** The mesh import of the map viewport. */
export interface MeshImport {
  /** The file the dialog is open on, and null while it is closed. */
  readonly request: MeshImportRequest | null;
  readonly busy: boolean;
  /** Opens a file picker and then the dialog. */
  readonly pick: () => Promise<void>;
  /** Imports the request's file with `options`, selects the new meshes and closes the dialog. */
  readonly run: (options: MeshImportOptions) => Promise<void>;
  readonly close: () => void;
}

/**
 * Opens the import dialog on a picked model file or on one dropped onto `target`, and imports
 * it. `probe` finds the ground under a point of the viewport. Per "Adding meshes" in
 * docs/ux/MAP_EDITOR.md.
 */
export function useMeshImport(
  target: RefObject<HTMLElement | null>,
  probe: RefObject<GroundProbeFn | null>,
): MeshImport {
  const { editable, geometryDocument, materials, chosen, importMeshes, select } = useMapScene();
  const toast = useToast();
  const [request, setRequest] = useState<MeshImportRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const inspect = useCallback(
    async (path: string, dropped: readonly [number, number] | null) => {
      const result = await api.bin.mapImportInspect(path);
      if (!result.ok) {
        toast.failure(m.workshop_bin_map_import_read_failed_title(), result.error);
        return;
      }
      setRequest({
        path,
        summary: result.value,
        center: probe.current?.(null) ?? null,
        drop: dropped === null ? null : (probe.current?.(dropped) ?? null),
      });
    },
    [toast, probe],
  );

  const pick = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [
        { name: m.workshop_bin_map_import_file_filter(), extensions: [...MODEL_EXTENSIONS] },
      ],
    });
    if (typeof picked === "string") await inspect(picked, null);
  }, [inspect]);

  /* A drop event crosses IPC, so the listener subscribes once and reads the latest state. */
  const imports = editable && geometryDocument !== null;
  const dropped = useRef({ imports, inspect });
  dropped.current = { imports, inspect };
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop" || !dropped.current.imports) return;

      const path = event.payload.paths.find(isModelPath);
      const box = target.current?.getBoundingClientRect();
      if (path === undefined || box === undefined) return;

      /* The event reports physical pixels of the window. */
      const x = event.payload.position.x / window.devicePixelRatio;
      const y = event.payload.position.y / window.devicePixelRatio;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
      void dropped.current.inspect(path, [x, y]);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [target]);

  const run = useCallback(
    async (options: MeshImportOptions) => {
      if (request === null || materials === null || chosen === null) return;

      setBusy(true);
      try {
        const created = materialImports(request.path, options.materials);
        let objects: ObjectCreation[] = [];
        if (created.length > 0) {
          const result = await api.bin.mapImportMaterials(materials, chosen.map, created);
          if (!result.ok) {
            toast.failure(m.workshop_bin_map_import_failed_title(), result.error);
            return;
          }
          objects = result.value;
        }

        const deltas = await importMeshes(objects, importEdit(request.path, options));
        if (deltas === null) return;

        select(
          deltas.flatMap((delta) => (delta.kind === "insert" ? [meshId(delta.mesh)] : [])),
          "replace",
        );
        setRequest(null);
      } finally {
        setBusy(false);
      }
    },
    [request, materials, chosen, importMeshes, select, toast],
  );

  const close = useCallback(() => setRequest(null), []);

  return { request, busy, pick, run, close };
}
