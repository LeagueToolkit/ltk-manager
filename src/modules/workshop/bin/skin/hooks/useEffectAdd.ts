import { use, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import type { BinEdit, BinRow, ValueEdit } from "@/lib/tauri";

import { useDeclares } from "../../documents/hooks/useDeclared";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { declaredAdd, groupedAdd, type NewEffect } from "../utils/effectEdits";
import { sendEach } from "./useDynamicsEdit";

/** Returns the calls of one edit, given whether the document is a declared one. */
export type SkinCalls = (declares: boolean) => readonly BinEdit[];

/**
 * Returns a sender of the calls of one structural edit of the skin, and null if the view does
 * not edit.
 *
 * The calls are sent in order. A refusal is shown in a toast, because a structural edit leaves
 * no field to mark.
 */
export function useSkinCalls(): ((calls: SkinCalls) => void) | null {
  const edit = use(LeafEditContext);
  const send = edit?.send;
  const landed = edit?.landed;
  const declares = useDeclares();
  const toast = useToast();

  return useMemo(() => {
    if (send === undefined || landed === undefined) return null;

    return (calls: SkinCalls) => {
      void sendEach({ send, landed }, calls(declares)).then((refused) => {
        if (refused !== null) {
          toast.failure(m.workshop_bin_edit_refused_title(), refused);
        }
      });
    };
  }, [send, landed, declares, toast]);
}

/** The edits of a skin section's rows, which state a refusal in a toast as `useSkinCalls` does. */
export interface SkinRowEdits {
  readonly removeItem: (row: BinRow) => void;
  readonly editProperty: (holder: BinRow, field: string, edits: ValueEdit[]) => void;
}

/** Returns the edits of a skin section's rows, and null if the view does not edit. */
export function useSkinRowEdits(): SkinRowEdits | null {
  const sendCalls = useSkinCalls();

  return useMemo(() => {
    if (sendCalls === null) return null;

    return {
      removeItem: (row) =>
        sendCalls(() => [{ kind: "removeItem", entry: row.entry, path: row.path }]),
      editProperty: (holder, field, edits) =>
        sendCalls(() => [
          { kind: "editProperty", entry: holder.entry, holder: holder.path, field, edits },
        ]),
    };
  }, [sendCalls]);
}

/**
 * Returns the add of one effect, and null if the view does not edit.
 *
 * A document that saves its own bytes takes the add as one undo step. A declared document takes
 * it as the narrow calls of `declaredAdd`.
 */
export function useEffectAdd(): ((add: NewEffect) => void) | null {
  const sendCalls = useSkinCalls();

  return useMemo(() => {
    if (sendCalls === null) return null;
    return (add: NewEffect) =>
      sendCalls((declares) => (declares ? declaredAdd(add) : [groupedAdd(add)]));
  }, [sendCalls]);
}
