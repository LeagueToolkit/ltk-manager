import { use } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type BinEdit, type LeafValue, type ValueEdit } from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { holderRow } from "../../vfx/drivers/utils/holderRow";
import { setField } from "../utils/entryEdits";
import { passPath } from "../utils/passPaths";

const TECHNIQUES = nameHash("techniques");
const PASSES = nameHash("passes");
const NAME = nameHash("name");

const PASS_CLASS = "StaticMaterialPassDef";
const TECHNIQUE_CLASS = "StaticMaterialTechniqueDef";

/** The technique the engine draws a material with, by name. */
const NORMAL_TECHNIQUE = "normal";

/** The edits of the passes of one technique, each one undo step. */
export interface PassEdits {
  /** Write fields of the pass at `pass`, adding each one the pass leaves unwritten. */
  readonly setFields: (pass: number, fields: readonly (readonly [string, LeafValue])[]) => void;
  /** Add a copy of the pass at `pass` right after it. */
  readonly duplicate: (pass: number) => void;
  /** Add a pass of the class defaults at the end, which links no shader yet. */
  readonly append: () => void;
  readonly remove: (pass: number) => void;
  /** Move the pass at `pass` to `to`, which then draws in that place. */
  readonly move: (pass: number, to: number) => void;
}

/**
 * The edits of the passes of the technique at `technique` of the material `entry`. Where the
 * material has no technique, `append` adds a `normal` technique holding one pass, which is the
 * technique the engine draws. Null where the view does not edit.
 *
 * "Passes" in docs/ux/BIN_EDITOR.md.
 */
export function usePassEdits(
  entry: string,
  technique: number | null,
  /** How many techniques the material holds, which is where a new one lands. */
  techniques: number,
): PassEdits | null {
  const edit = use(LeafEditContext);
  const toast = useToast();
  const editProperty = edit?.editProperty;
  const send = edit?.send;
  const landed = edit?.landed;
  if (editProperty === undefined || send === undefined || landed === undefined) return null;

  const run = (call: BinEdit) => {
    void (async () => {
      const { result, id } = await send((document) => api.bin.edit(document, call));
      if (!result.ok) {
        toast.error(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
        return;
      }
      landed(id);
    })();
  };
  const onPasses = (edits: ValueEdit[]) => {
    if (technique === null) return;
    void editProperty(holderRow(entry, `${TECHNIQUES.slice(2)}[${technique}]`), PASSES, edits);
  };

  return {
    setFields: (pass, fields) => {
      if (technique === null || fields.length === 0) return;
      run({
        kind: "editProperties",
        edits: fields.map(([field, value]) => ({
          entry,
          holder: passPath(technique, pass),
          field,
          edits: [{ type: "setLeaf", path: "", value }],
        })),
      });
    },
    duplicate: (pass) =>
      onPasses([{ type: "copyItem", from: `[${pass}]`, path: "", index: pass + 1, unique: null }]),
    append: () => {
      if (technique !== null) {
        onPasses([{ type: "insertItem", path: "", item: newItem(PASS_CLASS) }]);
        return;
      }
      const at = `[${techniques}]`;
      void editProperty(holderRow(entry, ""), TECHNIQUES, [
        { type: "insertItem", path: "", item: newItem(TECHNIQUE_CLASS) },
        ...setField(at, NAME, { type: "string", value: NORMAL_TECHNIQUE }),
        { type: "ensureProperty", path: at, field: PASSES },
        { type: "insertItem", path: `${at}.${PASSES.slice(2)}`, item: newItem(PASS_CLASS) },
      ]);
    },
    remove: (pass) => onPasses([{ type: "removeItem", path: `[${pass}]` }]),
    move: (pass, to) => {
      if (technique === null) return;
      run({ kind: "moveItem", entry, path: passPath(technique, pass), to });
    },
  };
}

function newItem(className: string) {
  return { index: null, key: null, class: className };
}
