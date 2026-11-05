import { createContext } from "react";

/** What the cells of one pass's parameter table read about the pass and the material over it. */
export interface PassScope {
  /** The pass's place in the technique, which a held value is drawn on alone. */
  readonly pass: number;
  /**
   * The values of the material's own entries, by name. The material's value of a name wins over
   * every pass's, so a row it sets reads the material's value and takes no edit of the pass.
   */
  readonly material: ReadonlyMap<string, readonly number[]>;
  /** Move the material's value of a name into every pass, or null where the view does not edit. */
  readonly perPass: ((name: string) => void) | null;
}

export const PassScopeContext = createContext<PassScope | null>(null);
