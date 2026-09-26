import { type SelectedModule, sameSelectedModule } from "../../bin/documents/state/editorFile";
import type { EditorSet } from "./editorRoot";
import { NO_COLLAPSED_DIRS } from "./projectEditor";
import { setProject } from "./projectUpdate";

/** What the layer panels read: the selected layer and module, the shut directories, a scroll. */
export interface LayerActions {
  selectLayer: (projectPath: string, layerName: string) => void;
  setUseDeclarations: (projectPath: string, on: boolean) => void;
  selectModule: (projectPath: string, selected: SelectedModule | null) => void;
  toggleCollapsed: (projectPath: string, layerName: string, path: string) => void;
  openDirs: (projectPath: string, layerName: string, paths: readonly string[]) => void;
  /** Collapse exactly `paths` in one layer's tree, which is how every directory collapses at once. */
  collapseDirs: (projectPath: string, layerName: string, paths: ReadonlySet<string>) => void;
  reveal: (projectPath: string, layerName: string, path: string) => void;
}

/** These actions, closed over the writer of the store that holds them. */
export function createLayerActions(set: EditorSet): LayerActions {
  return {
    selectLayer: (projectPath, layerName) =>
      setProject(set, projectPath, (editor) =>
        editor.selectedLayer === layerName ? null : { ...editor, selectedLayer: layerName },
      ),

    setUseDeclarations: (projectPath, on) =>
      setProject(set, projectPath, (editor) =>
        editor.useDeclarations === on ? null : { ...editor, useDeclarations: on },
      ),

    selectModule: (projectPath, selected) =>
      setProject(set, projectPath, (editor) =>
        sameSelectedModule(editor.selectedModule, selected)
          ? null
          : { ...editor, selectedModule: selected },
      ),

    toggleCollapsed: (projectPath, layerName, path) =>
      setProject(set, projectPath, (editor) => {
        const next = new Set(editor.collapsed[layerName] ?? NO_COLLAPSED_DIRS);
        if (next.has(path)) next.delete(path);
        else next.add(path);

        return { ...editor, collapsed: { ...editor.collapsed, [layerName]: next } };
      }),

    openDirs: (projectPath, layerName, paths) =>
      setProject(set, projectPath, (editor) => {
        const shut = editor.collapsed[layerName] ?? NO_COLLAPSED_DIRS;
        if (paths.every((path) => !shut.has(path))) return null;

        const next = new Set(shut);
        for (const path of paths) next.delete(path);
        return { ...editor, collapsed: { ...editor.collapsed, [layerName]: next } };
      }),

    collapseDirs: (projectPath, layerName, paths) =>
      setProject(set, projectPath, (editor) => ({
        ...editor,
        collapsed: { ...editor.collapsed, [layerName]: new Set(paths) },
      })),

    reveal: (projectPath, layerName, path) =>
      setProject(set, projectPath, (editor) => ({
        ...editor,
        reveal: { layerName, path, token: (editor.reveal?.token ?? 0) + 1 },
      })),
  };
}
