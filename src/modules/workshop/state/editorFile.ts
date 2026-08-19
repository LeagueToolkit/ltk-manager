/* The layout sub-barrel rather than the module barrel, for the same reason
   `@/stores/workshopEditor` does: the full barrel pulls the editor's
   components, whose imports circle back into workshop state. */
import { findLeaf, type LayoutNode, leaves, singleLeaf } from "@/modules/editor/layout";

import type { ContentDocument } from "../documents";

/** The slice of one project's editor that survives a restart. */
export interface PersistedProjectEditor {
  documents: Record<string, ContentDocument>;
  layout: LayoutNode;
  activeLeafId: string;
  selectedLayer: string | null;
}

/** What `parseEditorFile` made of a `.ltk/editor.json`'s content. */
export type EditorFileParseResult =
  | { kind: "ok"; state: PersistedProjectEditor }
  | { kind: "newer"; version: number }
  | { kind: "invalid" };

/* Bump when the file's shape changes, and give the outgoing shape a case in
   `parseEditorFile`'s migration switch. Versioned apart from the old browser
   storage store, whose numbering the file does not inherit. */
const EDITOR_FILE_VERSION = 1;

/**
 * One project's editor state as the content of its `.ltk/editor.json`.
 *
 * The single place the version constant is written, so every file this build
 * produces parses back through the same switch that reads it.
 */
export function serializeEditorFile(state: PersistedProjectEditor): string {
  return JSON.stringify(
    {
      version: EDITOR_FILE_VERSION,
      documents: state.documents,
      layout: state.layout,
      activeLeafId: state.activeLeafId,
      selectedLayer: state.selectedLayer,
    },
    null,
    2,
  );
}

/**
 * Read a `.ltk/editor.json` into the persisted slice this build can mount.
 *
 * `newer` is a file written by a build ahead of this one - it loads as a fresh
 * editor and its file must never be overwritten. `invalid` is unparseable or
 * mis-shaped content, which callers treat as no file at all.
 */
export function parseEditorFile(raw: string): EditorFileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "invalid" };

  const { version } = parsed as { version?: unknown };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { kind: "invalid" };
  }
  if (version > EDITOR_FILE_VERSION) return { kind: "newer", version };

  /* Forward migrations run in sequence: each older version's case reshapes one
     step and falls through, so supporting a version 2 adds one case here. */
  switch (version) {
    case 1:
      break;
    default:
      return { kind: "invalid" };
  }

  const state = sanitizeEditorState(parsed);
  if (state === null) return { kind: "invalid" };
  return { kind: "ok", state };
}

/**
 * Shape an untrusted persisted entry into something the editor can mount.
 *
 * Returns null for a value that is not an entry at all. Anything less broken
 * comes back repaired rather than crashing the first render: mis-shaped
 * documents drop and tabs follow them, a layout that is not a tree falls back
 * to a single leaf, and focus lands on a leaf the tree actually holds.
 */
export function sanitizeEditorState(value: unknown): PersistedProjectEditor | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<PersistedProjectEditor>;

  const documents: Record<string, ContentDocument> = {};
  if (typeof entry.documents === "object" && entry.documents !== null) {
    for (const [id, document] of Object.entries(entry.documents)) {
      if (isContentDocument(document) && document.id === id) documents[id] = document;
    }
  }

  const layout = isLayoutNode(entry.layout)
    ? dropUnknownTabs(entry.layout, documents)
    : singleLeaf();
  const activeLeafId =
    typeof entry.activeLeafId === "string" && findLeaf(layout, entry.activeLeafId)
      ? entry.activeLeafId
      : leaves(layout)[0].id;

  return {
    documents,
    layout,
    activeLeafId,
    selectedLayer: typeof entry.selectedLayer === "string" ? entry.selectedLayer : null,
  };
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as { kind?: unknown; id?: unknown; tabs?: unknown; children?: unknown };
  if (typeof node.id !== "string") return false;
  if (node.kind === "leaf") return Array.isArray(node.tabs);
  if (node.kind === "split") {
    const dir = (value as { dir?: unknown }).dir;
    return (
      (dir === "row" || dir === "col") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(isLayoutNode)
    );
  }
  return false;
}

function isContentDocument(value: unknown): value is ContentDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as { id?: unknown; kind?: unknown; layerName?: unknown; locale?: unknown };
  if (typeof doc.id !== "string") return false;
  if (doc.kind === "details") return true;
  if (doc.kind === "files") return typeof doc.layerName === "string";
  if (doc.kind === "strings") {
    return typeof doc.layerName === "string" && typeof doc.locale === "string";
  }
  return false;
}

/** Filter every strip to documents the entry holds, keeping untouched nodes' identity. */
function dropUnknownTabs(node: LayoutNode, documents: Record<string, ContentDocument>): LayoutNode {
  if (node.kind === "leaf") {
    const tabs = node.tabs.filter((id): id is string => typeof id === "string" && id in documents);
    const activeTab =
      typeof node.activeTab === "string" && tabs.includes(node.activeTab)
        ? node.activeTab
        : (tabs[0] ?? null);
    if (tabs.length === node.tabs.length && activeTab === node.activeTab) return node;
    return { ...node, tabs, activeTab };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const next = dropUnknownTabs(child, documents);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}
