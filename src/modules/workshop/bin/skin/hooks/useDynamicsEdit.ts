import { use, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type AppError, type BinEdit, type ValueEdit } from "@/lib/tauri";

import { useDeclares } from "../../documents/hooks/useDeclared";
import { type LeafEdit, LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { declaredCalls, type DynamicsCall } from "../utils/dynamicsCalls";
import { meshPath } from "../utils/dynamicsEdits";
import { MESH_PROPERTIES } from "../utils/dynamicsFields";

/** Send staged edits of the skin's mesh properties as one change. */
export type Send = (edits: ValueEdit[]) => void;

/** The sends of a document an action goes through. */
export type DynamicsSends = Required<Pick<LeafEdit, "send" | "landed">>;

/** One call of a declared document's action, as the edit the document takes. */
function editOf(entry: string, call: DynamicsCall): BinEdit {
  if (call.kind === "property") {
    return {
      kind: "editProperty",
      entry,
      holder: meshPath(call.holder),
      field: call.field,
      edits: call.edits,
    };
  }
  if (call.kind === "remove") {
    return { kind: "removeItem", entry, path: meshPath(call.path) };
  }

  return { kind: "insertItem", entry, path: meshPath(call.list), item: call.item };
}

/**
 * Send the edits of one action, staged under `skinMeshProperties` of the skin `entry`,
 * answering the refusal, and null where every edit landed.
 *
 * A document that saves its own bytes takes them as one `editProperty` (ADR-0051), so one
 * action is one undo step however many rows it writes. A declared document writes the whole
 * value of the property a call edits, so there the action is sent as the narrowest calls
 * that say it, one after another, and stops at the first the document refuses.
 */
export async function sendDynamics(
  edit: DynamicsSends,
  entry: string,
  declares: boolean,
  edits: ValueEdit[],
): Promise<AppError | null> {
  if (edits.length === 0) return null;

  const calls = declares ? declaredCalls(edits) : null;
  const sent: BinEdit[] =
    calls === null
      ? [{ kind: "editProperty", entry, holder: "", field: MESH_PROPERTIES, edits }]
      : calls.map((call) => editOf(entry, call));

  return sendEach(edit, sent);
}

/**
 * Sends `edits` in order and queues the save of each that lands. Returns the refusal of the
 * first edit that the document refuses, and null if every edit landed.
 */
export async function sendEach(
  edit: DynamicsSends,
  edits: readonly BinEdit[],
): Promise<AppError | null> {
  for (const one of edits) {
    const { result, id } = await edit.send((id) => api.bin.edit(id, one));
    if (!result.ok) return result.error;

    edit.landed(id);
  }

  return null;
}

/**
 * The edit of the skin's pose modifiers and sockets, and null where the view is read-only.
 *
 * A refusal is stated in a toast, since an action of a pane leaves no field to mark.
 */
export function useDynamicsEdit(entry: string): Send | null {
  const edit = use(LeafEditContext);
  const send = edit?.send;
  const landed = edit?.landed;
  const declares = useDeclares();
  const toast = useToast();

  return useMemo(() => {
    if (send === undefined || landed === undefined) return null;

    const sends = { send, landed };
    return (edits: ValueEdit[]) => {
      void sendDynamics(sends, entry, declares, edits).then((refused) => {
        if (refused !== null) {
          toast.failure(m.workshop_bin_edit_refused_title(), refused);
        }
      });
    };
  }, [send, landed, declares, entry, toast]);
}
