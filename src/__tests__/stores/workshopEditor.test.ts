import { findLeaf, leaves, singleLeaf } from "@/modules/editor";
import {
  detailsDocument,
  filesDocument,
  migrateFromV1,
  previewDocument,
  readLegacyEditorSeed,
} from "@/modules/workshop";
import { EMPTY_EDITOR, useWorkshopEditorStore } from "@/stores/workshopEditor";

const A = "C:/mods/project-a";
const B = "C:/mods/project-b";

const ROOT_LEAF = EMPTY_EDITOR.layout.id;

function store() {
  return useWorkshopEditorStore.getState();
}

function editorOf(projectPath: string) {
  return store().byProject[projectPath] ?? EMPTY_EDITOR;
}

function tabsOf(projectPath: string, leafId: string): readonly string[] {
  return findLeaf(editorOf(projectPath).layout, leafId)?.tabs ?? [];
}

function activeTabOf(projectPath: string, leafId: string): string | null {
  return findLeaf(editorOf(projectPath).layout, leafId)?.activeTab ?? null;
}

/** Every open id in reading order, which is what `useOpenDocuments` resolves. */
function openIds(projectPath: string): string[] {
  return leaves(editorOf(projectPath).layout).flatMap((leaf) => leaf.tabs);
}

/** What `useRevealRequest` reads, without a React render to get at it. */
function revealFor(projectPath: string, layerName: string) {
  const request = editorOf(projectPath).reveal;
  if (!request || request.layerName !== layerName) return null;
  return request;
}

/** A two-leaf tree: details left in the root leaf, files right in a fresh one. */
function splitApart(projectPath: string): string {
  store().openDocument(projectPath, detailsDocument());
  store().openDocument(projectPath, filesDocument("base"));
  store().splitWithDocument(projectPath, "files:base", ROOT_LEAF, "right");
  return editorOf(projectPath).activeLeafId;
}

describe("workshopEditor store", () => {
  beforeEach(() => {
    useWorkshopEditorStore.setState({ byProject: {} });
  });

  describe("setDocumentDirty", () => {
    /* Every project has a document called "details", so one flat dirty set
       marked the tab dirty in each of them at once. */
    it("keeps the same document id dirty in one project only", () => {
      store().setDocumentDirty(A, "details", true);

      expect(editorOf(A).dirty.has("details")).toBe(true);
      expect(editorOf(B).dirty.has("details")).toBe(false);
    });

    it("returns the same state when the flag does not change", () => {
      store().setDocumentDirty(A, "details", true);
      const before = store().byProject;
      store().setDocumentDirty(A, "details", true);

      expect(store().byProject).toBe(before);
    });
  });

  describe("openDocument", () => {
    it("lands in the focused leaf by default", () => {
      const rightLeaf = splitApart(A);

      store().openDocument(A, filesDocument("test"));

      expect(tabsOf(A, rightLeaf)).toEqual(["files:base", "files:test"]);
      expect(activeTabOf(A, rightLeaf)).toBe("files:test");
    });

    it("activates a reopened document where it is and keeps the stored one", () => {
      const first = detailsDocument();
      store().openDocument(A, first);
      store().openDocument(A, filesDocument("base"));
      store().splitWithDocument(A, "files:base", ROOT_LEAF, "right");

      store().openDocument(A, detailsDocument());

      expect(editorOf(A).activeLeafId).toBe(ROOT_LEAF);
      expect(editorOf(A).documents.details).toBe(first);
      expect(openIds(A)).toEqual(["details", "files:base"]);
    });

    it("falls back to the first leaf when the asked-for leaf is gone", () => {
      store().openDocument(A, detailsDocument(), "leaf-99");

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["details"]);
      expect(editorOf(A).activeLeafId).toBe(ROOT_LEAF);
    });
  });

  describe("openPreview", () => {
    /** A layer file, which is what a click in the file tree opens. */
    function preview(path: string) {
      return previewDocument({ kind: "layer", project: A, layer: "base", path });
    }

    /* The root leaf is empty, so there is nothing to sit beside and splitting
       would leave one of the two groups showing nothing. */
    it("opens as the ephemeral tab and records it", () => {
      const document = preview("icon.tex");

      store().openPreview(A, document);

      expect(tabsOf(A, ROOT_LEAF)).toEqual([document.id]);
      expect(editorOf(A).previewId).toBe(document.id);
    });

    /* Removing and re-inserting would send the tab to the end of the strip and
       move it under a pointer that is about to click again. */
    it("replaces the previous preview where it sits", () => {
      store().openDocument(A, detailsDocument());
      store().openPreview(A, preview("first.tex"));
      const previews = editorOf(A).activeLeafId;
      store().openDocument(A, filesDocument("base"));
      const second = preview("second.tex");

      store().openPreview(A, second);

      expect(tabsOf(A, previews)).toEqual([second.id, "files:base"]);
      expect(editorOf(A).previewId).toBe(second.id);
      expect(editorOf(A).documents["preview:layer:base:first.tex"]).toBeUndefined();
    });

    it("activates a document that is already open and leaves its role alone", () => {
      store().openDocument(A, detailsDocument());
      const document = preview("icon.tex");
      store().openPreview(A, document);
      const previews = editorOf(A).activeLeafId;
      store().activateDocument(A, ROOT_LEAF, "details");

      store().openPreview(A, document);

      expect(tabsOf(A, previews)).toEqual([document.id]);
      expect(activeTabOf(A, previews)).toBe(document.id);
      expect(editorOf(A).previewId).toBe(document.id);
    });

    /* One preview across the whole project, so a click in a second group
       replaces the first group's rather than leaving two on screen. */
    it("replaces a preview held by another leaf", () => {
      const first = preview("first.tex");
      store().openPreview(A, first);
      const other = splitApart(A);
      const second = preview("second.tex");

      store().openPreview(A, second, other);

      expect(openIds(A)).not.toContain(first.id);
      expect(openIds(A)).toContain(second.id);
      expect(editorOf(A).previewId).toBe(second.id);
    });
  });

  describe("where a preview opens", () => {
    function preview(path: string) {
      return previewDocument({ kind: "layer", project: A, layer: "base", path });
    }

    /* A browser keeps its own group, so a walk through its tree never pushes
       the tree itself off screen. */
    it("splits a group off the one that asked, rather than joining it", () => {
      store().openDocument(A, detailsDocument());
      const document = preview("icon.tex");

      store().openDocument(A, document);

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["details"]);
      const previews = editorOf(A).activeLeafId;
      expect(previews).not.toBe(ROOT_LEAF);
      expect(tabsOf(A, previews)).toEqual([document.id]);
    });

    it("joins the group a preview already sits in", () => {
      store().openDocument(A, detailsDocument());
      const first = preview("first.tex");
      store().openDocument(A, first);
      const previews = editorOf(A).activeLeafId;
      const second = preview("second.tex");

      store().openDocument(A, second);

      expect(leaves(editorOf(A).layout)).toHaveLength(2);
      expect(tabsOf(A, previews)).toEqual([first.id, second.id]);
    });

    /* Everything else opens where the focus is, so the sidebar's own documents
       do not scatter across the grid. */
    it("leaves a document that is not a preview in the focused group", () => {
      store().openDocument(A, detailsDocument());

      store().openDocument(A, filesDocument("base"));

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["details", "files:base"]);
    });

    it("honours a group the caller named", () => {
      const other = splitApart(A);

      store().openDocument(A, preview("icon.tex"), other);

      expect(leaves(editorOf(A).layout)).toHaveLength(2);
      expect(tabsOf(A, other)).toContain("preview:layer:base:icon.tex");
    });
  });

  describe("promoteDocument", () => {
    it("gives up the ephemeral role and keeps the tab", () => {
      const document = previewDocument({ kind: "file", path: "C:/loose/icon.tex" });
      store().openPreview(A, document);

      store().promoteDocument(A, document.id);

      expect(tabsOf(A, ROOT_LEAF)).toEqual([document.id]);
      expect(editorOf(A).previewId).toBeNull();
    });

    it("returns the same state for a document that is not the preview", () => {
      store().openDocument(A, detailsDocument());
      const before = store().byProject;

      store().promoteDocument(A, "details");

      expect(store().byProject).toBe(before);
    });

    /* What a context menu's open does: one gesture rather than a click and a
       double click on the tab it just opened. */
    it("is what a permanent open of the current preview does", () => {
      const document = previewDocument({ kind: "file", path: "C:/loose/icon.tex" });
      store().openPreview(A, document);

      store().openDocument(A, document);

      expect(tabsOf(A, ROOT_LEAF)).toEqual([document.id]);
      expect(editorOf(A).previewId).toBeNull();
    });
  });

  describe("closeDocument", () => {
    it("clears the closed document's dirty flag in its own project", () => {
      store().openDocument(A, detailsDocument());
      store().setDocumentDirty(A, "details", true);
      store().setDocumentDirty(B, "details", true);

      store().closeDocument(A, ROOT_LEAF, "details");

      expect(editorOf(A).dirty.has("details")).toBe(false);
      expect(editorOf(B).dirty.has("details")).toBe(true);
    });

    it("hands the active tab to a neighbour and drops the document", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));
      store().closeDocument(A, ROOT_LEAF, "files:base");

      expect(activeTabOf(A, ROOT_LEAF)).toBe("details");
      expect("files:base" in editorOf(A).documents).toBe(false);
    });

    it("re-points focus when the pruned tree loses the focused leaf", () => {
      const rightLeaf = splitApart(A);

      store().closeDocument(A, rightLeaf, "files:base");

      expect(leaves(editorOf(A).layout).map((leaf) => leaf.id)).toEqual([ROOT_LEAF]);
      expect(editorOf(A).activeLeafId).toBe(ROOT_LEAF);
      expect("files:base" in editorOf(A).documents).toBe(false);
    });
  });

  describe("moveDocument", () => {
    it("carries the tab to the target leaf and focuses it", () => {
      const rightLeaf = splitApart(A);
      store().openDocument(A, filesDocument("test"), ROOT_LEAF);

      store().moveDocument(A, "details", rightLeaf);

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["files:test"]);
      expect(tabsOf(A, rightLeaf)).toEqual(["files:base", "details"]);
      expect(activeTabOf(A, rightLeaf)).toBe("details");
      expect(editorOf(A).activeLeafId).toBe(rightLeaf);
    });
  });

  describe("splitWithDocument", () => {
    it("moves the document into a fresh leaf and focuses it", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));

      store().splitWithDocument(A, "files:base", ROOT_LEAF, "right");

      const newLeaf = editorOf(A).activeLeafId;
      expect(newLeaf).not.toBe(ROOT_LEAF);
      expect(tabsOf(A, ROOT_LEAF)).toEqual(["details"]);
      expect(tabsOf(A, newLeaf)).toEqual(["files:base"]);
    });

    it("returns the same state for a leaf that would split into itself", () => {
      store().openDocument(A, detailsDocument());
      const before = store().byProject;

      store().splitWithDocument(A, "details", ROOT_LEAF, "right");

      expect(store().byProject).toBe(before);
    });
  });

  describe("resetLayout", () => {
    it("merges every strip into the focused leaf in reading order", () => {
      const rightLeaf = splitApart(A);

      store().resetLayout(A);

      const layout = editorOf(A).layout;
      expect(layout.kind).toBe("leaf");
      expect(layout.id).toBe(rightLeaf);
      expect(openIds(A)).toEqual(["details", "files:base"]);
      expect(activeTabOf(A, rightLeaf)).toBe("files:base");
      expect(editorOf(A).activeLeafId).toBe(rightLeaf);
    });
  });

  describe("reveal", () => {
    /* Every open document stays mounted, so an unaddressed request scrolled the
       tree of every open layer rather than the one that was asked for. */
    it("addresses a request to one project and layer", () => {
      store().reveal(A, "base", "Smolder.wad.client/assets/x.dds");

      expect(revealFor(A, "base")?.path).toBe("Smolder.wad.client/assets/x.dds");
      expect(revealFor(A, "test")).toBeNull();
      expect(revealFor(B, "base")).toBeNull();
    });

    it("bumps the token so the same entry can be asked for twice", () => {
      store().reveal(A, "base", "same.dds");
      const first = revealFor(A, "base")?.token;

      store().reveal(A, "base", "same.dds");

      expect(first).toBeDefined();
      expect(revealFor(A, "base")?.token).toBe((first ?? 0) + 1);
    });

    it("counts a token per project rather than across all of them", () => {
      store().reveal(A, "base", "one.dds");
      store().reveal(B, "base", "two.dds");

      expect(revealFor(A, "base")?.token).toBe(1);
      expect(revealFor(B, "base")?.token).toBe(1);
    });
  });

  describe("toggleCollapsed", () => {
    it("shuts and reopens a directory for one layer only", () => {
      store().toggleCollapsed(A, "base", "assets");

      expect(editorOf(A).collapsed.base?.has("assets")).toBe(true);
      expect(editorOf(A).collapsed.test?.has("assets") ?? false).toBe(false);

      store().toggleCollapsed(A, "base", "assets");
      expect(editorOf(A).collapsed.base?.has("assets")).toBe(false);
    });
  });

  describe("selectLayer", () => {
    it("holds the layer independently of the strip", () => {
      store().selectLayer(A, "test");
      store().openDocument(A, detailsDocument());

      expect(editorOf(A).selectedLayer).toBe("test");
    });
  });

  describe("reorderDocuments", () => {
    it("rewrites the strip order", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));

      store().reorderDocuments(A, ROOT_LEAF, ["files:base", "details"]);

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["files:base", "details"]);
    });

    it("keeps the strip when the incoming list is stale", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));

      store().reorderDocuments(A, ROOT_LEAF, ["files:base"]);

      expect(tabsOf(A, ROOT_LEAF)).toEqual(["details", "files:base"]);
    });
  });

  describe("moveProject", () => {
    it("carries the whole editor to the path a rename gave it", () => {
      store().openDocument(A, detailsDocument());
      store().setDocumentDirty(A, "details", true);
      store().selectLayer(A, "test");

      store().moveProject(A, B);

      expect(editorOf(B).dirty.has("details")).toBe(true);
      expect(editorOf(B).selectedLayer).toBe("test");
      expect(A in store().byProject).toBe(false);
    });
  });

  describe("migrateFromV1", () => {
    it("converts a v1 strip into a single leaf carrying its ids", () => {
      const migrated = migrateFromV1({
        byProject: {
          [A]: {
            open: [detailsDocument(), filesDocument("base")],
            activeId: "files:base",
            selectedLayer: "base",
          },
        },
      }).byProject[A];

      expect(Object.keys(migrated?.documents ?? {}).sort()).toEqual(["details", "files:base"]);
      expect(migrated?.layout.kind).toBe("leaf");
      expect(findLeaf(migrated!.layout, migrated!.activeLeafId)?.tabs).toEqual([
        "details",
        "files:base",
      ]);
      expect(findLeaf(migrated!.layout, migrated!.activeLeafId)?.activeTab).toBe("files:base");
      expect(migrated?.selectedLayer).toBe("base");
    });

    it("completes an entry written before the store held a selected layer", () => {
      const migrated = migrateFromV1({
        byProject: { [A]: { open: [detailsDocument()], activeId: "details" } },
      }).byProject[A];

      expect(migrated?.selectedLayer).toBeNull();
      expect(findLeaf(migrated!.layout, migrated!.activeLeafId)?.activeTab).toBe("details");
    });

    it("hydrates into the store as a whole editor", () => {
      const migrated = migrateFromV1({
        byProject: {
          [A]: { open: [detailsDocument(), filesDocument("base")], activeId: "details" },
        },
      }).byProject[A];

      store().hydrateProject(A, migrated);

      const editor = editorOf(A);
      expect(editor.documents.details?.id).toBe("details");
      expect(findLeaf(editor.layout, editor.activeLeafId)?.tabs).toEqual(["details", "files:base"]);
      expect(editor.dirty.size).toBe(0);
      expect(editor.collapsed).toEqual({});
      expect(editor.reveal).toBeNull();
    });
  });

  describe("hydrateProject", () => {
    it("installs the persisted slice and fills the memory-only fields", () => {
      const layout = singleLeaf(["details"], "details");

      store().hydrateProject(A, {
        documents: { details: detailsDocument() },
        layout,
        activeLeafId: layout.id,
        selectedLayer: "base",
        previewId: null,
      });

      const editor = editorOf(A);
      expect(findLeaf(editor.layout, editor.activeLeafId)?.tabs).toEqual(["details"]);
      expect(editor.selectedLayer).toBe("base");
      expect(editor.dirty.size).toBe(0);
      expect(editor.collapsed).toEqual({});
      expect(editor.reveal).toBeNull();
    });

    it("replaces whatever the project already held", () => {
      store().openDocument(A, detailsDocument());
      store().setDocumentDirty(A, "details", true);

      store().hydrateProject(A, EMPTY_EDITOR);

      expect(openIds(A)).toEqual([]);
      expect(editorOf(A).dirty.size).toBe(0);
    });

    it("hydrates one project without touching its neighbour", () => {
      store().openDocument(B, detailsDocument());

      store().hydrateProject(A, EMPTY_EDITOR);

      expect(openIds(B)).toEqual(["details"]);
    });
  });

  describe("readLegacyEditorSeed", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("reads this project's entry out of a v2 envelope", () => {
      const layout = singleLeaf(["details"], "details");
      localStorage.setItem(
        "ltk-workshop-documents",
        JSON.stringify({
          state: {
            byProject: {
              [A]: {
                documents: { details: detailsDocument() },
                layout,
                activeLeafId: layout.id,
                selectedLayer: "base",
              },
            },
          },
          version: 2,
        }),
      );

      const seed = readLegacyEditorSeed(A);

      expect(seed?.selectedLayer).toBe("base");
      expect(findLeaf(seed!.layout, seed!.activeLeafId)?.tabs).toEqual(["details"]);
      expect(readLegacyEditorSeed(B)).toBeNull();
    });

    it("carries a v1 envelope through migrateFromV1", () => {
      localStorage.setItem(
        "ltk-workshop-documents",
        JSON.stringify({
          state: {
            byProject: {
              [A]: {
                open: [detailsDocument(), filesDocument("base")],
                activeId: "files:base",
                selectedLayer: "base",
              },
            },
          },
          version: 1,
        }),
      );

      const seed = readLegacyEditorSeed(A);

      const leaf = findLeaf(seed!.layout, seed!.activeLeafId);
      expect(leaf?.tabs).toEqual(["details", "files:base"]);
      expect(leaf?.activeTab).toBe("files:base");
      expect(seed?.selectedLayer).toBe("base");
    });

    it("reads nothing from an empty or unparseable storage", () => {
      expect(readLegacyEditorSeed(A)).toBeNull();

      localStorage.setItem("ltk-workshop-documents", "not json");
      expect(readLegacyEditorSeed(A)).toBeNull();
    });
  });

  describe("forgetProject", () => {
    it("drops a deleted project's editor", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(B, detailsDocument());

      store().forgetProject(A);

      expect(A in store().byProject).toBe(false);
      expect(B in store().byProject).toBe(true);
    });

    it("returns the same state for a project it does not hold", () => {
      const before = store().byProject;
      store().forgetProject(A);

      expect(store().byProject).toBe(before);
    });
  });
});
