import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useConfirm } from "@/components";
import { m } from "@/i18n";
import type { DeclarationsLayer, DeclaredEntry, DeclaredModule } from "@/lib/tauri";

import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  useSelectedLayerName,
  useSelectedModule,
  useSelectLayer,
  useSelectModule,
} from "../../state";
import { declarationQueries } from "../api/queries";
import { moduleTally, moduleTitle } from "../utils/outlineTree";
import { useManifestModuleAction } from "./useManifestModuleAction";

/** Where a module an action made or moved stands, in the layer the action left. */
export interface ModuleLanding {
  index: number;
  /** The layer's outline as read after the action, which a tree draws before it lands. */
  layer: DeclarationsLayer;
}

/** The module actions an outline offers, over the manifest of one layer. ADR-0048, ADR-0054. */
export interface OutlineActions {
  /** Add an unnamed module with no entry at the end. */
  create: (layer: string) => Promise<ModuleLanding | null>;
  rename: (layer: string, module: DeclaredModule, name: string | null) => void;
  /** Move the module to `to`, counted in the list as it stands. */
  move: (layer: string, module: DeclaredModule, to: number) => Promise<ModuleLanding | null>;
  /** Ask, then remove the module and the comment lines above it. */
  remove: (layer: string, module: DeclaredModule) => void;
  /** Move an entry's body, or every signed key of `path`, to the `entries` module `to`. */
  moveKeys: (
    layer: string,
    module: DeclaredModule,
    entry: DeclaredEntry,
    path: string | null,
    to: number,
  ) => Promise<boolean>;
  /** Move the keys into a module made for them at the end. */
  moveToNewModule: (
    layer: string,
    module: DeclaredModule,
    entry: DeclaredEntry,
    path: string | null,
  ) => Promise<ModuleLanding | null>;
  /** Make the module the one a declared document's new keys join, or stop it being that. */
  toggleWriteHere: (layer: string, module: DeclaredModule) => void;
  /** Whether the module is the one a declared document's new keys join. */
  writesHere: (layer: string, module: DeclaredModule) => boolean;
}

/** The actions the declarations outline and the rail view run on a project's manifests. */
export function useOutlineActions(): OutlineActions {
  const project = useProjectContext();
  const act = useManifestModuleAction(project.path);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const selectedLayer = useSelectedLayerName();
  const selected = useSelectedModule();
  const selectLayer = useSelectLayer();
  const selectModule = useSelectModule();

  const writesHere = useCallback(
    (layer: string, module: DeclaredModule) =>
      selectedLayer === layer &&
      selected?.kind === "index" &&
      selected.layer === layer &&
      selected.index === module.index,
    [selected, selectedLayer],
  );

  const toggleWriteHere = useCallback(
    (layer: string, module: DeclaredModule) => {
      if (writesHere(layer, module)) {
        selectModule(null);
        return;
      }

      selectLayer(layer);
      selectModule({ layer, kind: "index", index: module.index });
    },
    [selectLayer, selectModule, writesHere],
  );

  const remove = useCallback(
    (layer: string, module: DeclaredModule) => {
      void (async () => {
        const title = moduleTitle(module);
        const keys = moduleTally(module).keys;
        const agreed = await confirm({
          title: m.workshop_declarations_remove_module_title(),
          heading: m.workshop_declarations_remove_module_heading({ module: title }),
          description: m.workshop_declarations_remove_module_description({ count: keys }),
          confirmLabel: m.workshop_declarations_remove_module_action(),
          tone: "danger",
        });
        if (agreed) await act(layer, { kind: "remove", module: module.index });
      })();
    },
    [act, confirm],
  );

  /* The action awaits the outline read again, so the cache holds what it left. */
  const landing = useCallback(
    (layer: string, index: "last" | number): ModuleLanding | null => {
      const outline = queryClient.getQueryData(declarationQueries.outline(project.path).queryKey);
      const held = outline?.find((each) => each.layer === layer);
      if (held === undefined || held.modules.length === 0) return null;

      return { index: index === "last" ? held.modules.length - 1 : index, layer: held };
    },
    [project.path, queryClient],
  );

  const create = useCallback(
    async (layer: string) => {
      if (!(await act(layer, { kind: "create", name: null }))) return null;
      return landing(layer, "last");
    },
    [act, landing],
  );

  const move = useCallback(
    async (layer: string, module: DeclaredModule, to: number) => {
      if (to === module.index) return null;
      if (!(await act(layer, { kind: "move", module: module.index, to }))) return null;
      return landing(layer, to);
    },
    [act, landing],
  );

  const moveKeys = useCallback(
    (
      layer: string,
      module: DeclaredModule,
      entry: DeclaredEntry,
      path: string | null,
      to: number,
    ) => act(layer, { kind: "moveKeys", module: module.index, entry: entry.name, path, to }),
    [act],
  );

  const moveToNewModule = useCallback(
    async (layer: string, module: DeclaredModule, entry: DeclaredEntry, path: string | null) => {
      const made = await create(layer);
      if (made === null) return null;
      if (!(await moveKeys(layer, module, entry, path, made.index))) return null;
      return landing(layer, "last");
    },
    [create, landing, moveKeys],
  );

  return useMemo(
    () => ({
      create,
      rename: (layer, module, name) => {
        if (name === module.name) return;
        void act(layer, { kind: "rename", module: module.index, name });
      },
      move,
      remove,
      moveKeys,
      moveToNewModule,
      toggleWriteHere,
      writesHere,
    }),
    [act, create, move, moveKeys, moveToNewModule, remove, toggleWriteHere, writesHere],
  );
}
