import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { use } from "react";

import { ContextMenu } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId, BinRow, DeclaredMark } from "@/lib/tauri";

import { useCurveDock } from "../../curves/state/curveTarget";
import { useDeclaredMark, useDeclares, useModuleAction } from "../../documents/hooks/useDeclared";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { RowDocumentContext } from "../../tree/state/rowFold";
import { fieldHash, rowKey } from "../../tree/utils/binRows";
import { useClassSchema } from "../hooks/useClassSchema";
import { parentPath, propertyReset } from "../utils/propertyReset";

/**
 * Reset to default on a property row of a class view, which takes leaf edits.
 *
 * `owner` is the class the field is read on, whose schema default a declared document writes.
 * "Reset to default" in docs/ux/BIN_EDITOR.md.
 */
export function ResetMenuItem({
  row,
  owner,
  curve,
}: {
  row: BinRow;
  owner: string | null;
  curve: boolean;
}) {
  const edit = use(LeafEditContext);
  const declares = useDeclares();
  const { clear, target } = useCurveDock();
  const schema = useClassSchema(declares ? owner : null);
  const document = use(RowDocumentContext);
  const declared = useDeclaredMark(rowKey(row));

  if (edit === null || row.node !== "property") return null;
  if (declared !== null && document !== null) {
    return <DropDeclaration document={document} mark={declared.mark} layer={declared.layer} />;
  }

  const field = schema.data?.fields.find((each) => each.hash === fieldHash(row.path));
  const reset = propertyReset(row, field, declares, curve);
  const pending = declares && schema.isPending && owner !== null;

  async function run() {
    if (edit === null) return;

    let landed = false;
    if (reset.kind === "remove") landed = (await edit.removeProperty?.(row)) ?? false;
    if (reset.kind === "leaf")
      landed = (await edit.commit(row, { ok: true, leaf: reset.leaf })) ?? false;
    if (reset.kind === "value") {
      const parent = { ...row, path: parentPath(row.path) };
      landed = (await edit.editProperty?.(parent, fieldHash(row.path), reset.edits)) ?? false;
    }

    if (landed && target !== null && rowKey(target.row) === rowKey(row)) clear();
  }

  let hint: string;
  if (reset.kind === "remove") hint = m.workshop_bin_reset_default_remove_hint();
  else if (reset.kind === "refused") hint = m.workshop_bin_reset_default_refused_hint();
  else if (reset.kind === "unchanged") hint = m.workshop_bin_reset_default_unchanged_hint();
  else if (row.kind === "option") hint = m.workshop_bin_reset_default_empty_hint();
  else hint = m.workshop_bin_reset_default_write_hint();

  return (
    <ContextMenu.Item
      icon={<ArrowCounterClockwiseIcon />}
      disabled={reset.kind === "refused" || reset.kind === "unchanged" || pending}
      title={hint}
      onClick={() => void run()}
    >
      {m.workshop_bin_reset_default_action()}
    </ContextMenu.Item>
  );
}

/** Reset on a row a declaration of the chosen layer sets, which drops that declaration. */
function DropDeclaration({
  document,
  mark,
  layer,
}: {
  document: BinDocumentId;
  mark: DeclaredMark;
  layer: string;
}) {
  const act = useModuleAction(document);

  return (
    <ContextMenu.Item
      icon={<ArrowCounterClockwiseIcon />}
      title={m.workshop_bin_reset_default_drop_hint()}
      onClick={() =>
        void act(layer, {
          kind: "dropKeys",
          module: mark.module,
          entry: mark.entry,
          path: mark.property,
        })
      }
    >
      {m.workshop_bin_reset_default_action()}
    </ContextMenu.Item>
  );
}
