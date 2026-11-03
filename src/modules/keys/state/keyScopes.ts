import { activeEntries, dispatchPress, indexChords, type ScopeEntry } from "../utils/dispatch";
import { COMMANDS } from "../utils/registry";
import type { ScopeId } from "../utils/scopes";

const INDEX = indexChords(COMMANDS);

/* Mounted scope instances. The page holds one listener while any instance is mounted, so a test
   that renders one hook needs no provider. */
const entries = new Set<ScopeEntry>();
let serial = 0;

function onKeyDown(event: KeyboardEvent): void {
  dispatchPress(event, entries, INDEX);
}

/** Returns the next mount serial, which orders two instances of one scope. */
export function nextSerial(): number {
  serial += 1;

  return serial;
}

/** Adds `entry` to the dispatcher, and returns the function that removes it again. */
export function mountScope(entry: ScopeEntry): () => void {
  if (entries.size === 0) document.addEventListener("keydown", onKeyDown);
  entries.add(entry);

  return () => {
    entries.delete(entry);
    if (entries.size === 0) document.removeEventListener("keydown", onKeyDown);
  };
}

/** Returns the scopes that a press on `target` reaches now, narrowest first. */
export function activeScopes(target: Node | null): ScopeId[] {
  return [...new Set(activeEntries(entries, target).map((entry) => entry.scope))];
}
