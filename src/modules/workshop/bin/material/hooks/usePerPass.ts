import { use } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type BinRow, type PropertyEdit, type SchemaParam } from "@/lib/tauri";

import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { childCount } from "../../tree/utils/binRows";
import { itemStep, setField } from "../utils/entryEdits";
import { PARAM_FIELD, PARAM_VALUES } from "../utils/passPaths";
import type { PassList } from "./usePassParams";

const PARAM_CLASS = "StaticMaterialShaderParamDef";

/**
 * Move the material's entry of a parameter into the passes, as one undo step: the material's
 * entry goes, and each pass whose shader declares the parameter and holds no entry of its own
 * takes one holding the material's value. Every pass then draws as before, and each takes an
 * edit of its own. Null where the view does not edit or the passes are unread.
 *
 * "Pass values" in docs/ux/BIN_EDITOR.md.
 */
export function usePerPass({
  entry,
  material,
  passes,
  declared,
}: {
  /** The material object. */
  entry: string;
  /** The material's own entries, by name, each with the value it holds. */
  material: ReadonlyMap<string, { readonly element: BinRow; readonly values: readonly number[] }>;
  passes: readonly PassList[] | null;
  /** The parameter `name` as the shader of the pass at `pass` declares it. */
  declared: (pass: number, name: string) => SchemaParam | undefined;
}): ((name: string) => void) | null {
  const edit = use(LeafEditContext);
  const toast = useToast();
  const send = edit?.send;
  const landed = edit?.landed;
  if (send === undefined || landed === undefined || passes === null) return null;

  return (name) => {
    const own = material.get(name);
    const at = own === undefined ? null : itemStep(own.element);
    if (own === undefined || at === null) return;

    const edits: PropertyEdit[] = [
      { entry, holder: "", field: PARAM_VALUES, edits: [{ type: "removeItem", path: at }] },
    ];
    for (const pass of passes) {
      if (declared(pass.index, name) === undefined || pass.entries.has(name)) continue;

      const index = `[${pass.list === null ? 0 : childCount(pass.list)}]`;
      edits.push({
        entry,
        holder: pass.holder,
        field: PARAM_VALUES,
        edits: [
          { type: "insertItem", path: "", item: { index: null, key: null, class: PARAM_CLASS } },
          ...setField(index, PARAM_FIELD.name, { type: "string", value: name }),
          ...setField(index, PARAM_FIELD.value, { type: "vector", values: [...own.values] }),
        ],
      });
    }

    void (async () => {
      const { result, id } = await send((document) =>
        api.bin.edit(document, { kind: "editProperties", edits }),
      );
      if (!result.ok) {
        toast.error(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
        return;
      }
      landed(id);
    })();
  };
}
