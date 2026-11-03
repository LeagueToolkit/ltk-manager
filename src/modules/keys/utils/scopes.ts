/**
 * The scopes that a key binding belongs to, as one tree.
 *
 * A press goes to the narrowest active scope first, then to each wider one. Two bindings
 * conflict when their scopes lie on one path of the tree. Per "Scopes" in docs/ux/KEYS.md.
 */
export const SCOPE_PARENTS = {
  app: null,
  library: "app",
  workshop: "app",
  "focus:projects": "workshop",
  project: "workshop",
  editor: "project",
  "focus:tree": "editor",
  "focus:content": "focus:tree",
  "focus:outline": "focus:tree",
  "focus:explorer": "editor",
  "focus:objects": "editor",
  "focus:knob": "editor",
  "document:audio": "editor",
  "focus:audio.media": "document:audio",
  "focus:audio.events": "document:audio",
  "focus:audio.lines": "editor",
  "document:vfx": "editor",
  "focus:vfx.timeline": "document:vfx",
  "focus:vfx.graph": "document:vfx",
  "focus:vfx.curve": "editor",
  "document:skin": "editor",
  "document:map": "editor",
  "document:atlas": "editor",
  "focus:atlas.canvas": "document:atlas",
  "focus:atlas.layers": "document:atlas",
  "focus:atlas.sprites": "document:atlas",
} as const satisfies Readonly<Record<string, string | null>>;

/** The id of one scope of the tree. */
export type ScopeId = keyof typeof SCOPE_PARENTS;

/** The section of the shortcut sheet that lists a scope's bindings. */
export type SheetSection =
  | "app"
  | "library"
  | "workshop"
  | "editor"
  | "lists"
  | "explorer"
  | "audio"
  | "voiceLines"
  | "fields"
  | "vfx"
  | "curves"
  | "skin"
  | "map"
  | "atlas";

/** The section of each scope, so a document's scope and its widgets' scopes list together. */
export const SCOPE_SECTIONS: Readonly<Record<ScopeId, SheetSection>> = {
  app: "app",
  library: "library",
  workshop: "workshop",
  "focus:projects": "workshop",
  project: "workshop",
  editor: "editor",
  "focus:tree": "lists",
  "focus:content": "lists",
  "focus:outline": "lists",
  "focus:explorer": "explorer",
  "focus:objects": "lists",
  "focus:knob": "fields",
  "document:audio": "audio",
  "focus:audio.media": "audio",
  "focus:audio.events": "audio",
  "focus:audio.lines": "voiceLines",
  "document:vfx": "vfx",
  "focus:vfx.timeline": "vfx",
  "focus:vfx.graph": "vfx",
  "focus:vfx.curve": "curves",
  "document:skin": "skin",
  "document:map": "map",
  "document:atlas": "atlas",
  "focus:atlas.canvas": "atlas",
  "focus:atlas.layers": "atlas",
  "focus:atlas.sprites": "atlas",
};

/** Returns the scopes from `scope` up to the root, `scope` first. */
export function scopePath(scope: ScopeId): ScopeId[] {
  const path: ScopeId[] = [];
  let current: ScopeId | null = scope;
  while (current !== null) {
    path.push(current);
    current = SCOPE_PARENTS[current];
  }

  return path;
}

/** Returns the number of scopes above `scope`, which is 0 for `app`. */
export function scopeDepth(scope: ScopeId): number {
  return scopePath(scope).length - 1;
}

/** Returns `true` if `scope` is `ancestor` or lies under it. */
export function isWithin(scope: ScopeId, ancestor: ScopeId): boolean {
  return scopePath(scope).includes(ancestor);
}

/** Returns `true` if one of `a` and `b` is the other or lies under it, so both can be active at once. */
export function onOnePath(a: ScopeId, b: ScopeId): boolean {
  return isWithin(a, b) || isWithin(b, a);
}
