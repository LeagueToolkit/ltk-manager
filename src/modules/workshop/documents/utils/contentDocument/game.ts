import type { EditorDocumentBase } from "@/modules/editor";

interface GameDoc extends EditorDocumentBase {
  kind: "game";
}

/** The game has one root browser over one install, so its document needs nothing to key on. */
export const GAME_DOCUMENT_ID = "game";

export function gameDocument(): GameDoc {
  return { id: GAME_DOCUMENT_ID, kind: "game" };
}

interface GameWadsDoc extends EditorDocumentBase {
  kind: "game-wads";
}

/** The install has one set of archives, so its list needs nothing to key on. */
export const GAME_WADS_DOCUMENT_ID = "game-wads";

export function gameWadsDocument(): GameWadsDoc {
  return { id: GAME_WADS_DOCUMENT_ID, kind: "game-wads" };
}

interface GameWadDoc extends EditorDocumentBase {
  kind: "game-wad";
  wadName: string;
}

/* Keyed by archive name, so a second request for the same archive activates
   the tab that is already open. */
export function gameWadDocument(wadName: string): GameWadDoc {
  return { id: `game-wad:${wadName}`, kind: "game-wad", wadName };
}

interface ObjectsDoc extends EditorDocumentBase {
  kind: "objects";
}

/** The install has one tree of objects. Its browser needs nothing to key on. */
export const OBJECTS_DOCUMENT_ID = "objects";

export function objectsDocument(): ObjectsDoc {
  return { id: OBJECTS_DOCUMENT_ID, kind: "objects" };
}

interface ReferencesDoc extends EditorDocumentBase {
  kind: "references";
}

/** One project answers one query at a time, so its document needs nothing to key on. */
export const REFERENCES_DOCUMENT_ID = "references";

export function referencesDocument(): ReferencesDoc {
  return { id: REFERENCES_DOCUMENT_ID, kind: "references" };
}

/** A browser over the installed game's archives or objects. */
export type GameBrowserDoc = GameDoc | GameWadsDoc | GameWadDoc | ObjectsDoc | ReferencesDoc;
