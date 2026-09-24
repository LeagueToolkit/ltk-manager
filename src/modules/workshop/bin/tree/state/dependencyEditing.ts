import { createContext } from "react";

/** The dependency row whose path is open for editing, which the row menu can start. */
export interface DependencyEditing {
  readonly index: number | null;
  readonly start: (index: number | null) => void;
}

/** The enclosing tree's dependency edit. Outside a tree, none opens. */
export const DependencyEditingContext = createContext<DependencyEditing>({
  index: null,
  start: () => {},
});
