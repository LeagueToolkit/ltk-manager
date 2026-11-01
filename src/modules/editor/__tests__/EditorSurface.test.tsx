// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { DocumentStage } from "../components/DocumentStage";
import { EditorSurface } from "../components/EditorSurface";
import { useDocumentSave } from "../state/documentSaves";
import { leafCloses } from "../state/leafCloses";
import type { EditorDocumentBase, EditorDocumentProps, EditorRegistry } from "../types";

interface Note extends EditorDocumentBase {
  kind: "note";
  title: string;
}

const NOTES: readonly Note[] = [
  { id: "a", kind: "note", title: "Alpha" },
  { id: "b", kind: "note", title: "Beta" },
];

/** A document with nothing to save, which is every kind that writes on its own. */
const PLAIN: EditorRegistry<Note> = {
  note: {
    icon: () => null,
    label: (document) => ({ title: document.title }),
    component: ({ document }) => <p>{document.title} body</p>,
  },
};

/** The save the one document on screen offers, for the registry below. */
let save = vi.fn<() => Promise<void>>();

function SavingNote({ document }: EditorDocumentProps<Note>) {
  useDocumentSave(document.id, save);
  return <p>{document.title} body</p>;
}

/** A document that holds its edits until it is asked, as Mod details does. */
const SAVING: EditorRegistry<Note> = {
  note: {
    icon: () => null,
    label: (document) => ({ title: document.title }),
    component: SavingNote,
  },
};

/** A document whose label names a layer, as the strings and preview tabs do. */
const LAYERED: EditorRegistry<Note> = {
  note: {
    icon: () => null,
    label: (document) => ({ title: document.title, layer: `From ${document.id}` }),
    component: ({ document }) => <p>{document.title} body</p>,
  },
};

function Fragmented({ children }: { leafId: string; children: ReactNode }) {
  return children;
}

interface DrawOptions {
  registry?: EditorRegistry<Note>;
  dirtyIds?: ReadonlySet<string>;
  sharedTitles?: ReadonlySet<string>;
  onClose?: (id: string) => void;
  onActivate?: (id: string) => void;
}

function draw({
  registry = PLAIN,
  dirtyIds = new Set(["a", "b"]),
  sharedTitles,
  onClose = vi.fn(),
  onActivate = vi.fn(),
}: DrawOptions = {}) {
  const placements = NOTES.map((document) => ({
    document,
    leafId: "leaf-1",
    active: document.id === "a",
  }));

  render(
    <DocumentStage placements={placements} registry={registry} leafScope={Fragmented}>
      <EditorSurface
        leafId="leaf-1"
        documents={NOTES}
        activeId="a"
        registry={registry}
        dirtyIds={dirtyIds}
        pinnedIds={[]}
        sharedTitles={sharedTitles}
        onActivate={onActivate}
        onClose={onClose}
      />
    </DocumentStage>,
  );
  return { onClose, onActivate };
}

/*
 * The strip's own close button. Found through hidden elements, because the
 * question is modal and marks the surface behind it away from a reader - a
 * close made while one stands comes from a command rather than a pointer.
 */
function closeTab(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Close ${title}`, hidden: true }));
}

beforeEach(() => {
  save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
});

describe("EditorSurface", () => {
  it("asks about a second close rather than dropping the first question", async () => {
    const user = userEvent.setup();
    const { onClose, onActivate } = draw();

    closeTab("Alpha");
    closeTab("Beta");

    expect(screen.getByText(/Alpha has unsaved changes/)).toBeTruthy();
    /* The question stands over the document it names. */
    expect(onActivate).toHaveBeenCalledWith("a");

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledWith("a");
    await screen.findByText(/Beta has unsaved changes/);
    expect(onActivate).toHaveBeenCalledWith("b");

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("drops the whole queue on a cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = draw();

    closeTab("Alpha");
    closeTab("Beta");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/has unsaved changes/)).toBeNull());
  });

  it("offers a save for a document that holds its edits, and closes on the write", async () => {
    const user = userEvent.setup();
    const { onClose } = draw({ registry: SAVING });

    closeTab("Alpha");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("a"));
  });

  it("keeps the document open when the write fails", async () => {
    const user = userEvent.setup();
    save = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("the disk is full"));
    const { onClose } = draw({ registry: SAVING });

    closeTab("Alpha");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText(/has unsaved changes/)).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers no save for a document that writes on its own", () => {
    draw();

    closeTab("Alpha");

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("publishes its closes, which a command outside the strip runs", async () => {
    const { onClose } = draw({ dirtyIds: new Set() });

    fireEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    leafCloses("leaf-1")?.closeAll();

    await waitFor(() => expect(onClose).toHaveBeenCalledWith("a"));
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("asks the strip's own question for a close a command asked for", async () => {
    draw();

    leafCloses("leaf-1")?.closeOne("a");

    expect(await screen.findByText(/Alpha has unsaved changes/)).toBeTruthy();
  });

  it("names a tab's layer only where another tab takes its title", () => {
    draw({ registry: LAYERED, sharedTitles: new Set(["Alpha"]) });

    expect(screen.getByRole("tab", { name: /Alpha From a/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();
  });

  /* On the tab itself rather than the box around it, which is what a reader
     lands on and what tells them the tab moves at all. */
  it("announces a tab as draggable", () => {
    draw();

    const tab = screen.getByRole("tab", { name: "Alpha" });
    expect(tab).toHaveAttribute("aria-roledescription", "Draggable tab");
    expect(tab).toHaveAttribute("aria-describedby");
  });
});
