import { m } from "@/i18n";
import type {
  DeclaredModuleSummary,
  DeclaredModuleChoice,
  DeclaredState,
  ModuleAction,
} from "@/lib/tauri";

import type { SelectedModule } from "../state/editorFile";

const AUTO: DeclaredModuleChoice = { kind: "auto" };

/** Whether two choices a document takes are the same choice. */
export function sameChoice(a: DeclaredModuleChoice, b: DeclaredModuleChoice): boolean {
  if (a.kind === "index" && b.kind === "index") return a.index === b.index;
  if (a.kind === "new" && b.kind === "new") return a.name === b.name;
  return a.kind === b.kind;
}

/** The choice a document writing to `layer` takes from the stored one. */
export function choiceFor(selected: SelectedModule | null, layer: string): DeclaredModuleChoice {
  if (selected === null || selected.layer !== layer) return AUTO;
  if (selected.kind === "index") return { kind: "index", index: selected.index };
  return { kind: "new", name: selected.name };
}

/** What keeps a document and the stored choice in step. */
export type ModuleSync =
  | { readonly kind: "none" }
  /** Tell the document the stored choice. */
  | { readonly kind: "send"; readonly choice: DeclaredModuleChoice }
  /** Store what the document holds: the module a first edit made, or none for a gone one. */
  | { readonly kind: "store"; readonly selected: SelectedModule | null };

/**
 * The step that brings the document's module and the stored one together, for a document
 * already on the stored layer.
 *
 * The document is right where it made the new module the store still calls new, and where
 * the stored index names no `entries` module of the layer any more.
 */
export function moduleSync(
  declared: Pick<DeclaredState, "layer" | "module" | "modules">,
  selected: SelectedModule | null,
): ModuleSync {
  const wanted = choiceFor(selected, declared.layer);
  const held = declared.module;
  if (sameChoice(wanted, held)) return { kind: "none" };

  if (wanted.kind === "new" && held.kind === "index") {
    return { kind: "store", selected: { layer: declared.layer, kind: "index", index: held.index } };
  }
  if (
    wanted.kind === "index" &&
    !declared.modules.some((module) => module.index === wanted.index && module.takesKeys)
  ) {
    return { kind: "store", selected: null };
  }
  return { kind: "send", choice: wanted };
}

/** A module as the chip and the menus name it: its name, else its place in the list. */
export function moduleLabel(module: Pick<DeclaredModuleSummary, "index" | "name">): string {
  return module.name ?? m.workshop_bin_module_numbered_label({ number: module.index + 1 });
}

/** The chip's label for the document's current choice. */
export function choiceLabel(
  choice: DeclaredModuleChoice,
  modules: readonly DeclaredModuleSummary[],
): string {
  switch (choice.kind) {
    case "auto":
      return m.workshop_bin_module_auto_label();
    case "index": {
      const module = modules.find((held) => held.index === choice.index);
      return module ? moduleLabel(module) : moduleLabel({ index: choice.index, name: null });
    }
    case "new":
      return choice.name ?? m.workshop_bin_module_new_label();
  }
}

/**
 * The stored choice after `action`, so it names the same module. `removedSource` says a move
 * of keys left its unnamed source module empty, which takes it away.
 */
export function followModuleAction(
  selected: SelectedModule | null,
  action: ModuleAction,
  removedSource: boolean,
): SelectedModule | null {
  if (selected === null || selected.kind !== "index") return selected;
  const at = (index: number | null) => (index === null ? null : { ...selected, index });
  const index = selected.index;

  switch (action.kind) {
    case "create":
    case "rename":
      return selected;
    case "remove":
      return at(shiftAfterRemoval(index, action.module));
    case "moveKeys":
      return removedSource ? at(shiftAfterRemoval(index, action.module)) : selected;
    case "move": {
      if (index === action.module) return at(action.to);
      if (action.module < index && action.to >= index) return at(index - 1);
      if (action.module > index && action.to <= index) return at(index + 1);
      return selected;
    }
  }
}

function shiftAfterRemoval(index: number, removed: number): number | null {
  if (index === removed) return null;
  return index > removed ? index - 1 : index;
}
