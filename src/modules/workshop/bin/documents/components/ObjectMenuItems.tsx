import { ArrowCounterClockwiseIcon, CopySimpleIcon, MinusCircleIcon } from "@phosphor-icons/react";
import { use } from "react";

import { ContextMenu, useToast } from "@/components";
import { m } from "@/i18n";
import type { BinRow, ObjectEdit } from "@/lib/tauri";

import { BinEditContext } from "../../tree/hooks/useBinEdit";
import { NewObjectContext } from "../../tree/state/newObject";
import { useDeclaredObject } from "../hooks/useDeclared";

/**
 * An object row's own edits in a document that creates objects: Duplicate as new object and
 * Remove object, or Restore object on an object the chosen layer of a declared document
 * removes. ADR-0049, and "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function ObjectMenuItems({ row }: { row: BinRow }) {
  const drafts = use(NewObjectContext);
  const edit = use(BinEditContext);
  const change = useDeclaredObject(row.entry)?.change ?? null;
  const toast = useToast();

  if (row.node !== "object" || edit === null || drafts === null) return null;

  function send(objectEdit: ObjectEdit) {
    void edit?.object(objectEdit).then((result) => {
      if (!result.ok) {
        toast.failure(m.workshop_bin_object_edit_failed_title(), result.error);
      }
    });
  }

  if (change === "removed") {
    return (
      <>
        <ContextMenu.Item
          icon={<ArrowCounterClockwiseIcon />}
          onClick={() => send({ kind: "restore", entry: row.entry })}
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
      <ContextMenu.Item
        icon={<MinusCircleIcon />}
        onClick={() => send({ kind: "remove", entry: row.entry })}
      >
        {m.workshop_bin_remove_object_action()}
      </ContextMenu.Item>
      <ContextMenu.Separator />
    </>
  );
}
