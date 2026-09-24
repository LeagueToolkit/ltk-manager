import { ArrowCounterClockwiseIcon, CopySimpleIcon, MinusCircleIcon } from "@phosphor-icons/react";
import { use } from "react";

import { ContextMenu, useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type BinRow } from "@/lib/tauri";

import { BinEditContext, useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { NewObjectContext } from "../../tree/state/newObject";
import { RowDocumentContext } from "../../tree/state/rowFold";
import { useDeclaredObject } from "../hooks/useDeclared";
import { type Sent, useDocumentCall } from "../hooks/useDocumentCall";

/**
 * An object row's own edits in a declared document: Duplicate as new object and Remove
 * object, or Restore object on an object the chosen layer removes. ADR-0049, and "Declaring
 * from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function ObjectMenuItems({ row }: { row: BinRow }) {
  const document = use(RowDocumentContext);
  const drafts = use(NewObjectContext);
  const edit = use(BinEditContext);
  const call = useDocumentCall(document);
  const change = useDeclaredObject(row.entry)?.change ?? null;
  const invalidate = useInvalidateBinReads();
  const toast = useToast();

  if (row.node !== "object" || document === null || edit === null || drafts === null) return null;

  const remove = (entry: string) =>
    call((id) => api.bin.edit(id, { kind: "object", edit: { kind: "remove", entry } }));
  const restore = (entry: string) =>
    call((id) => api.bin.edit(id, { kind: "object", edit: { kind: "restore", entry } }));

  function send(sent: Promise<Sent<unknown>>) {
    void sent.then(({ result }) => {
      if (!result.ok) {
        toast.error(m.workshop_bin_object_edit_failed_title(), errorSummary(result.error));
        return;
      }
      invalidate();
    });
  }

  if (change === "removed") {
    return (
      <>
        <ContextMenu.Item
          icon={<ArrowCounterClockwiseIcon />}
          onClick={() => send(restore(row.entry))}
        >
          {m.workshop_bin_restore_object_action()}
        </ContextMenu.Item>
        <ContextMenu.Separator />
      </>
    );
  }

  return (
    <>
      <ContextMenu.Item
        icon={<CopySimpleIcon />}
        onClick={() => drafts.start({ kind: "clone", source: row })}
      >
        {m.workshop_bin_duplicate_object_action()}
      </ContextMenu.Item>
      <ContextMenu.Item icon={<MinusCircleIcon />} onClick={() => send(remove(row.entry))}>
        {m.workshop_bin_remove_object_action()}
      </ContextMenu.Item>
      <ContextMenu.Separator />
    </>
  );
}
