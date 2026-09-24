import { createContext, useMemo, useState } from "react";

import type { BinRow } from "@/lib/tauri";

/** A new object a file tab is naming: a copy of `source`, or an object of a class. */
export type ObjectDraft =
  | { readonly kind: "clone"; readonly source: BinRow }
  | { readonly kind: "class" };

/** The new object a file tab is naming, and the way to start and end one. */
export interface NewObjectDraft {
  readonly draft: ObjectDraft | null;
  readonly start: (draft: ObjectDraft) => void;
  readonly close: () => void;
}

/**
 * The new object of the enclosing file tab. Null in an object tab and a read-only
 * document, which create no object. ADR-0049.
 */
export const NewObjectContext = createContext<NewObjectDraft | null>(null);

/** One file tab's new-object draft, which its toolbar and its tree share. */
export function useNewObjectDraft(): NewObjectDraft {
  const [draft, setDraft] = useState<ObjectDraft | null>(null);
  return useMemo(() => ({ draft, start: setDraft, close: () => setDraft(null) }), [draft]);
}
