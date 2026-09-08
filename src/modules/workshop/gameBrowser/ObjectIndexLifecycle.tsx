import { useObjectIndexLifecycle } from "./useObjectIndex";

/** The object index lifecycle as a mount, so the root reaches it through a chunk of its own. */
export function ObjectIndexLifecycle() {
  useObjectIndexLifecycle();
  return null;
}
