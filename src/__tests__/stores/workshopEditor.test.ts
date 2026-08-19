import { detailsDocument, filesDocument } from "@/modules/workshop";
import { EMPTY_EDITOR, rehydrate, useWorkshopEditorStore } from "@/stores/workshopEditor";

const A = "C:/mods/project-a";
const B = "C:/mods/project-b";

function store() {
  return useWorkshopEditorStore.getState();
}

function editorOf(projectPath: string) {
  return store().byProject[projectPath] ?? EMPTY_EDITOR;
}

/** What `useRevealRequest` reads, without a React render to get at it. */
function revealFor(projectPath: string, layerName: string) {
  const request = editorOf(projectPath).reveal;
  if (!request || request.layerName !== layerName) return null;
  return request;
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

  describe("closeDocument", () => {
    it("clears the closed document's dirty flag in its own project", () => {
      store().openDocument(A, detailsDocument());
      store().setDocumentDirty(A, "details", true);
      store().setDocumentDirty(B, "details", true);

      store().closeDocument(A, "details");

      expect(editorOf(A).dirty.has("details")).toBe(false);
      expect(editorOf(B).dirty.has("details")).toBe(true);
    });

    it("hands the active tab to a neighbour", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));
      store().closeDocument(A, "files:base");

      expect(editorOf(A).activeId).toBe("details");
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

      store().reorderDocuments(A, ["files:base", "details"]);

      expect(editorOf(A).open.map((d) => d.id)).toEqual(["files:base", "details"]);
    });

    it("keeps the strip when the incoming list is stale", () => {
      store().openDocument(A, detailsDocument());
      store().openDocument(A, filesDocument("base"));

      store().reorderDocuments(A, ["files:base"]);

      expect(editorOf(A).open.map((d) => d.id)).toEqual(["details", "files:base"]);
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

  describe("rehydrate", () => {
    /* What every existing install reads on the first run after this store
       replaced the two it was split across. */
    it("completes an entry written before the store held a selected layer", () => {
      const editor = rehydrate({
        byProject: { [A]: { open: [detailsDocument()], activeId: "details" } },
      })[A];

      expect(editor?.open.map((d) => d.id)).toEqual(["details"]);
      expect(editor?.activeId).toBe("details");
      expect(editor?.selectedLayer).toBeNull();
      expect(editor?.dirty.size).toBe(0);
      expect(editor?.collapsed).toEqual({});
      expect(editor?.reveal).toBeNull();
    });

    it("reads back an empty record from nothing stored", () => {
      expect(rehydrate(null)).toEqual({});
      expect(rehydrate({})).toEqual({});
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
