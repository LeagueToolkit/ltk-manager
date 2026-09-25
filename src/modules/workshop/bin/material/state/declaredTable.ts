import { createContext } from "react";

import type { LayoutPages, ViewContext } from "../../classes/components/ClassCells";

/** One of the lists a shader declares the rows of: where it lives and what an entry is. */
export interface ListKind {
  readonly list: string;
  readonly className: string;
  /** The field an entry is matched to its declaration by. */
  readonly nameField: string;
}

/** What every cell of a declared table reads about the list it draws. */
export interface TableState {
  readonly pages: LayoutPages;
  readonly view: ViewContext;
  readonly kind: ListKind;
  /** How many entries the list holds, which is the index a new one lands at. */
  readonly count: number;
  /** The shader answered, so an entry it does not name is marked. */
  readonly known: boolean;
  /** What the program read warns about a row, by the row's name. */
  readonly warnings: ReadonlyMap<string, string>;
}

export const TableContext = createContext<TableState | null>(null);

/** What one row knows of its own edits, which its cells and its actions read. */
export interface RowState {
  /** The row differs from the state it held before the session first edited it. */
  readonly changed: boolean;
  /** Return the row to that state, or null where it has none to return to. */
  readonly revert: (() => void) | null;
  /** What the revert returns to, as a person reads it. */
  readonly revertLabel: string;
  /** Take the material's entry out so the shader default draws, or null where it has none. */
  readonly toDefault: (() => void) | null;
  /** Why the row's last edit was refused. */
  readonly refusal: string | null;
  /** How many edits of the row have landed, which restarts the landing pulse. */
  readonly pulse: number;
}

export const RowStateContext = createContext<RowState | null>(null);
