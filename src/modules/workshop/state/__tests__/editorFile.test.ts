// @vitest-environment happy-dom

/* The full barrels, unlike the modules under test: a test file is outside the
   cycle the sub-barrel import exists to break, and entering through the
   layout sub-barrel first evaluates its components mid-barrel, which reaches
   `@/stores` before `tree` has bound its exports. */
import { findLeaf, leaves, singleLeaf } from "@/modules/editor";
import {
  detailsDocument,
  filesDocument,
  gameDocument,
  gameWadDocument,
  gameWadsDocument,
  objectDocument,
  objectsDocument,
  previewDocument,
  problemsDocument,
} from "@/modules/workshop";

import { defaultShellLayout, firstShellLeafId } from "../../bin/shellPanes";
import {
  parseEditorFile,
  type PersistedProjectEditor,
  sanitizeEditorState,
  serializeEditorFile,
} from "../editorFile";

function twoDocumentState(): PersistedProjectEditor {
  const layout = singleLeaf(["details", "files:base"], "files:base");
  const shellLayout = defaultShellLayout();
  return {
    documents: { details: detailsDocument(), "files:base": filesDocument("base") },
    layout,
    activeLeafId: layout.id,
    selectedLayer: "base",
    previewId: null,
    shellLayout,
    shellLeafId: firstShellLeafId(shellLayout),
  };
}

describe("editorFile", () => {
  describe("round trip", () => {
    it("parses back what serializeEditorFile wrote", () => {
      const state = twoDocumentState();

      const parsed = parseEditorFile(serializeEditorFile(state));

      expect(parsed).toEqual({ kind: "ok", state });
    });

    it("carries a locked group across the file", () => {
      const state = twoDocumentState();
      const locked = { ...state, layout: { ...state.layout, locked: true } };

      const parsed = parseEditorFile(serializeEditorFile(locked));

      expect(parsed).toEqual({ kind: "ok", state: locked });
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
      expect(parsed.state.previewId).toBeNull();
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

    it("falls back to a single leaf for a lock that is not a boolean", () => {
      const entry = twoDocumentState();

      const state = sanitizeEditorState({ ...entry, layout: { ...entry.layout, locked: "yes" } });

      expect(state?.layout).toEqual(singleLeaf());
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

    it("keeps game browser documents", () => {
      const list = gameWadsDocument();
      const scoped = gameWadDocument("Aatrox.wad.client");
      const objects = objectsDocument();
      const layout = singleLeaf(["game", list.id, scoped.id, objects.id], scoped.id);

      const state = sanitizeEditorState({
        documents: {
          game: gameDocument(),
          [list.id]: list,
          [scoped.id]: scoped,
          [objects.id]: objects,
        },
        layout,
        activeLeafId: layout.id,
        selectedLayer: null,
      });

      expect(Object.keys(state?.documents ?? {})).toEqual(["game", list.id, scoped.id, objects.id]);
      expect(findLeaf(state!.layout, state!.activeLeafId)?.tabs).toEqual([
        "game",
        list.id,
        scoped.id,
        objects.id,
      ]);
    });

    /* A document kind missing from the schema costs its tab on every restart,
       which reads as a tab that will not stay open rather than as a parse. */
    it("keeps the problems document", () => {
      const problems = problemsDocument();
      const layout = singleLeaf([problems.id], problems.id);

      const state = sanitizeEditorState({
        documents: { [problems.id]: problems },
        layout,
        activeLeafId: layout.id,
        selectedLayer: null,
      });

      expect(state?.documents[problems.id]).toEqual(problems);
      expect(findLeaf(state!.layout, state!.activeLeafId)?.tabs).toEqual([problems.id]);
    });

    it("keeps a preview document and the tab holding it", () => {
      const preview = previewDocument({
        kind: "layer",
        project: "C:/mods/skin",
        layer: "base",
        path: "assets/icon.tex",
      });
      const layout = singleLeaf([preview.id], preview.id);

      const state = sanitizeEditorState({
        documents: { [preview.id]: preview },
        layout,
        activeLeafId: layout.id,
        selectedLayer: "base",
        previewId: preview.id,
      });

      expect(state?.documents[preview.id]).toEqual(preview);
      expect(state?.previewId).toBe(preview.id);
    });

    it("keeps an object document and the tab holding it", () => {
      const object = objectDocument(
        { kind: "layer", project: "C:/mods/skin", layer: "base", path: "data/skin0.bin" },
        "0x2a1f3c7d",
        "Characters/Aatrox",
        "data/skin0.bin",
      );
      const layout = singleLeaf([object.id], object.id);

      const state = sanitizeEditorState({
        documents: { [object.id]: object },
        layout,
        activeLeafId: layout.id,
        selectedLayer: "base",
        previewId: object.id,
      });

      expect(state?.documents[object.id]).toEqual(object);
      expect(state?.previewId).toBe(object.id);
    });

    /* A file this build wrote before the field existed, and one whose preview
       document did not survive the sanitize. Neither is an ephemeral tab any
       more, so neither keeps the role. */
    it("drops a preview id that no open tab holds", () => {
      const layout = singleLeaf(["details"], "details");
      const entry = {
        documents: { details: detailsDocument() },
        layout,
        activeLeafId: layout.id,
        selectedLayer: null,
      };

      expect(sanitizeEditorState(entry)?.previewId).toBeNull();
      expect(
        sanitizeEditorState({ ...entry, previewId: "preview:layer:base:gone.tex" })?.previewId,
      ).toBeNull();
    });

    it("completes an entry that lost fields rather than crashing on it", () => {
      const state = sanitizeEditorState({});

      expect(state?.documents).toEqual({});
      expect(state?.layout).toEqual(singleLeaf());
      expect(state?.selectedLayer).toBeNull();
    });
  });
});
