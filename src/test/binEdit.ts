import type { BinDocumentId, BinEdit, EditOutcome } from "@/lib/tauri";

/** The edit a mocked invoke carries when it is a `bin_edit` of `kind`, or null. */
export function sentEdit<K extends BinEdit["kind"]>(
  command: string,
  args: Record<string, unknown> | undefined,
  kind: K,
): Extract<BinEdit, { kind: K }> | null {
  if (command !== "bin_edit") return null;

  const edit = args?.edit as BinEdit | undefined;
  return edit?.kind === kind ? (edit as Extract<BinEdit, { kind: K }>) : null;
}

/** Whether a mocked invoke is a `bin_edit` of `kind`. */
export function isEdit(
  command: string,
  args: Record<string, unknown> | undefined,
  kind: BinEdit["kind"],
): boolean {
  return sentEdit(command, args, kind) !== null;
}

/** The invoke `api.bin.edit(document, edit)` makes, spread into `toHaveBeenCalledWith`. */
export function editCall(
  document: BinDocumentId,
  edit: BinEdit,
): [string, Record<string, unknown>] {
  return ["bin_edit", { document, edit }];
}

/** A landed edit's envelope, as the mocked backend answers it. */
export function landed(outcome: EditOutcome = { kind: "done" }) {
  return Promise.resolve({ ok: true, value: outcome });
}
