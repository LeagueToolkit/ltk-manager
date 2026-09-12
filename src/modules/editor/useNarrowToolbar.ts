/* per "A narrow toolbar drops what a reader reaches another way" in docs/ux/BIN_EDITOR.md */
import { useToolbarWidth } from "./components";

/** The width below which a document drops what a reader can reach another way. */
const NARROW_TOOLBAR = 560;

/** Whether the tab's toolbar is too narrow for the whole row of facts and actions. */
export function useNarrowToolbar(): boolean {
  const width = useToolbarWidth();
  return width !== null && width < NARROW_TOOLBAR;
}
