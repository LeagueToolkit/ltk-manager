/* The full barrels, unlike the modules under test: a test file is outside the
   cycle the sub-barrel import exists to break, and entering through the
   layout sub-barrel first evaluates its components mid-barrel, which reaches
   `@/stores` before `tree` has bound its exports. */
import { findLeaf, leaves, singleLeaf } from "@/modules/editor";
import { detailsDocument, filesDocument } from "@/modules/workshop";

import {
  parseEditorFile,
  type PersistedProjectEditor,
  sanitizeEditorState,
  serializeEditorFile,
} from "../editorFile";

function twoDocumentState(): PersistedProjectEditor {
  const layout = singleLeaf(["details", "files:base"], "files:base");
  return {
    documents: { details: detailsDocument(), "files:base": filesDocument("base") },
    layout,
    activeLeafId: layout.id,
    selectedLayer: "base",
  };
}

describe("editorFile", () => {
  describe("round trip", () => {
    it("parses back what serializeEditorFile wrote", () => {
      const state = twoDocumentState();

      const parsed = parseEditorFile(serializeEditorFile(state));

      expect(parsed).toEqual({ kind: "ok", state });
    });
  });

  describe("parseEditorFile", () => {
    /* The literal spells out today's on-disk shape byte for byte, so a change
       to the migration switch that silently orphans every existing file fails
       here rather than in a user's project. */
    it("reads a version-1 file as this build writes it", () => {
      const raw = [
        "{",
        '  "version": 1,',
        '  "documents": {',
        '    "details": {',
        '      "id": "details",',
        '      "kind": "details"',
        "    }",
        "  },",
        '  "layout": {',
        '    "kind": "leaf",',
        '    "id": "leaf-1",',
        '    "tabs": [',
        '      "details"',
        "    ],",
        '    "activeTab": "details"',
        "  },",
        '  "activeLeafId": "leaf-1",',
        '  "selectedLayer": null',
        "}",
      ].join("\n");

      const parsed = parseEditorFile(raw);

      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(findLeaf(parsed.state.layout, parsed.state.activeLeafId)?.tabs).toEqual(["details"]);
      expect(parsed.state.documents.details?.id).toBe("details");
    });

    it("reports a version above this build as newer", () => {
      const raw = JSON.stringify({ version: 2, documents: {}, layout: singleLeaf() });

      expect(parseEditorFile(raw)).toEqual({ kind: "newer", version: 2 });
    });

    it("reports unparseable content as invalid", () => {
      expect(parseEditorFile("not json").kind).toBe("invalid");
      expect(parseEditorFile('"a string"').kind).toBe("invalid");
      expect(parseEditorFile("null").kind).toBe("invalid");
    });

    it("reports a missing or malformed version as invalid", () => {
      expect(parseEditorFile(JSON.stringify({ documents: {} })).kind).toBe("invalid");
      expect(parseEditorFile(JSON.stringify({ version: "1" })).kind).toBe("invalid");
      expect(parseEditorFile(JSON.stringify({ version: 0 })).kind).toBe("invalid");
      expect(parseEditorFile(JSON.stringify({ version: 1.5 })).kind).toBe("invalid");
    });

    it("sanitises a file whose tabs reference documents it does not hold", () => {
      const state = twoDocumentState();
      const raw = serializeEditorFile({
        ...state,
        documents: { details: detailsDocument() },
      });

      const parsed = parseEditorFile(raw);

      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      const leaf = findLeaf(parsed.state.layout, parsed.state.activeLeafId);
      expect(leaf?.tabs).toEqual(["details"]);
      expect(leaf?.activeTab).toBe("details");
    });
  });

  describe("sanitizeEditorState", () => {
    it("returns null for a value that is not an entry", () => {
      expect(sanitizeEditorState(null)).toBeNull();
      expect(sanitizeEditorState("details")).toBeNull();
    });

    it("falls back to a single leaf when the layout is not a tree", () => {
      const state = sanitizeEditorState({
        documents: { details: detailsDocument() },
        layout: { kind: "grid" },
        activeLeafId: "leaf-9",
        selectedLayer: null,
      });

      expect(state?.layout).toEqual(singleLeaf());
      expect(state?.activeLeafId).toBe(singleLeaf().id);
    });

    it("re-points a dangling activeLeafId at the first leaf", () => {
      const entry = twoDocumentState();

      const state = sanitizeEditorState({ ...entry, activeLeafId: "leaf-9" });

      expect(state?.activeLeafId).toBe(leaves(entry.layout)[0].id);
    });

    it("drops a mis-shaped document and the tab pointing at it", () => {
      const entry = twoDocumentState();

      const state = sanitizeEditorState({
        ...entry,
        documents: { ...entry.documents, "files:base": { id: "files:base", kind: "files" } },
      });

      expect(Object.keys(state?.documents ?? {})).toEqual(["details"]);
      expect(findLeaf(state!.layout, state!.activeLeafId)?.tabs).toEqual(["details"]);
    });

    it("completes an entry that lost fields rather than crashing on it", () => {
      const state = sanitizeEditorState({});

      expect(state?.documents).toEqual({});
      expect(state?.layout).toEqual(singleLeaf());
      expect(state?.selectedLayer).toBeNull();
    });
  });
});
