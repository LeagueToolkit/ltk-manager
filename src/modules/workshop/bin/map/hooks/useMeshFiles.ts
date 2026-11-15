import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";

import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import { api } from "@/lib/tauri";
import { basename } from "@/utils/path";

import { useMapScene } from "../state/mapScene";
import { MODEL_EXTENSIONS } from "../utils/meshImport";

/**
 * Returns a function that opens a save dialog and writes `meshes` of the open `.mapgeo` to the
 * chosen path as a binary glTF file. Writes every mesh if `meshes` is null. Per "Adding meshes"
 * in docs/ux/MAP_EDITOR.md.
 */
export function useMeshExport(): (meshes: readonly number[] | null) => Promise<void> {
  const { geometryDocument, materials, chosen } = useMapScene();
  const toast = useToast();

  return useCallback(
    async (meshes: readonly number[] | null) => {
      if (geometryDocument === null || chosen === null) return;

      const name = basename(chosen.map).toLowerCase();
      const destination = await save({
        title: m.workshop_bin_map_export_action(),
        defaultPath: `${name}.glb`,
        filters: [{ name: m.workshop_bin_map_export_file_filter(), extensions: ["glb"] }],
      });
      if (destination === null) return;

      const result = await api.bin.mapGeometryExport(
        geometryDocument.id,
        meshes === null ? null : [...meshes],
        materials,
        chosen.map,
        destination,
      );
      if (result.ok) {
        toast.success(m.workshop_bin_map_export_done_title(), destination);
      } else {
        toast.failure(m.workshop_bin_map_export_failed_title(), result.error);
      }
    },
    [geometryDocument, materials, chosen, toast],
  );
}

/** Returns a function that picks a model file and opens the reimport dialog for `mesh`. */
export function useMeshReimport(): (mesh: number) => Promise<void> {
  const { geometryDocument, chosen, setReimport } = useMapScene();
  const toast = useToast();

  return useCallback(
    async (mesh: number) => {
      if (geometryDocument === null || chosen === null) return;

      const path = await open({
        multiple: false,
        filters: [
          { name: m.workshop_bin_map_import_file_filter(), extensions: [...MODEL_EXTENSIONS] },
        ],
      });
      if (typeof path !== "string") return;

      const result = await api.bin.mapGeometryReimportInspect(
        geometryDocument.id,
        mesh,
        chosen.map,
        path,
      );
      if (!result.ok) {
        toast.failure(m.workshop_bin_map_import_read_failed_title(), result.error);
        return;
      }
      setReimport({ mesh, path, summary: result.value.summary, source: result.value.source });
    },
    [geometryDocument, chosen, setReimport, toast],
  );
}
