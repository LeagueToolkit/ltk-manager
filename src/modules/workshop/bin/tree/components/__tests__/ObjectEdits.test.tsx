// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu, ToastProvider } from "@/components";
import type { BinRow, ChoiceQuery, ObjectChange } from "@/lib/tauri";
import { editCall, landed, sentEdit } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { ObjectMenuItems } from "../../../documents/components/ObjectMenuItems";
import { type DeclaredRows, DeclaredRowsContext } from "../../../documents/hooks/useDeclared";
import { BinEditContext, useBinEditor } from "../../hooks/useBinEdit";
import { type NewObjectDraft, NewObjectContext, type ObjectDraft } from "../../state/newObject";
import { RowDocumentContext } from "../../state/rowFold";
import { type AddLine, NEW_OBJECT_KEY } from "../../utils/binRows";
import { BinRowLine } from "../BinRow";
import { NewObjectLine } from "../NewObjectLine";
import { ASSET, DOCUMENT, lineOf, NO_FOCUS, PROJECT } from "./binEditFixtures";

const SKIN = "0x2a1f3c7d";

const OBJECT: BinRow = {
  entry: SKIN,
  path: "",
  label: "",
  node: "object",
  name: "Characters/Teemo/Skins/Skin0",
  unnamed: false,
  kind: null,
  value: { type: "struct", classHash: "0x1b2c3d4e", class: "SkinCharacterDataProperties", len: 4 },
  declared: null,
};

const start = vi.fn<(draft: ObjectDraft) => void>();
const close = vi.fn<() => void>();

function rows(objects: ReadonlyMap<string, ObjectChange> = new Map()): DeclaredRows {
  return {
    layer: "base",
    marks: new Map(),
    diagnostics: new Map(),
    objects,
    links: new Map(),
    editable: true,
  };
}

function Editable({ children }: { children: ReactNode }) {
  const edit = useBinEditor(DOCUMENT, ASSET, true, NO_FOCUS);
  return <BinEditContext value={edit}>{children}</BinEditContext>;
}

function Providers({
  objects,
  draft = null,
  children,
}: {
  objects?: ReadonlyMap<string, ObjectChange>;
  draft?: ObjectDraft | null;
  children: ReactNode;
}) {
  const [client] = useState(() => createTestQueryClient());
  const drafts: NewObjectDraft = { draft, start, close };
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>
          <DeclaredRowsContext value={rows(objects)}>
            <RowDocumentContext value={DOCUMENT}>
              <NewObjectContext value={drafts}>
                <Editable>{children}</Editable>
              </NewObjectContext>
            </RowDocumentContext>
          </DeclaredRowsContext>
        </ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function Menu({ objects }: { objects?: ReadonlyMap<string, ObjectChange> }) {
  return (
    <Providers objects={objects}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <span>the row</span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
              <ObjectMenuItems row={OBJECT} />
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </Providers>
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.pointer({ keys: "[MouseRight]", target: screen.getByText("the row") });
  return user;
}

function newObjectLine(draft: ObjectDraft): AddLine {
  return {
    kind: "add",
    key: NEW_OBJECT_KEY,
    document: DOCUMENT,
    entry: "",
    path: "",
    depth: 0,
    target: { kind: "object", draft },
    index: null,
  };
}

function renderLine(draft: ObjectDraft) {
  return render(
    <Providers draft={draft}>
      <NewObjectLine line={newObjectLine(draft)} draft={draft} />
    </Providers>,
  );
}

beforeEach(() => {
  start.mockClear();
  close.mockClear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    const object = sentEdit(command, args, "object");
    if (object?.edit.kind === "create") return landed({ kind: "object", entry: "0x0badf00d" });
    if (object !== null) return landed();
    if (command === "bin_choices" && (args?.query as ChoiceQuery).kind === "objectClasses") {
      return Promise.resolve({
        ok: true,
        value: {
          kind: "classes",
          classes: [
            {
              hash: "0x1b2c3d4e",
              name: "SkinCharacterDataProperties",
              held: true,
              derivesFrom: null,
            },
            { hash: "0x5e6f7a8b", name: "VfxSystemDefinitionData", held: false, derivesFrom: null },
          ],
        },
      });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

describe("an object row's menu in a declared document", () => {
  it("duplicates the object into a new-object draft", async () => {
    render(<Menu />);
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Duplicate as new object" }));

    expect(start).toHaveBeenCalledWith({ kind: "clone", source: OBJECT });
  });

  it("removes the object", async () => {
    render(<Menu />);
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Remove object" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, { kind: "object", edit: { kind: "remove", entry: SKIN } }),
      ),
    );
  });

  it("offers only Restore on an object the layer removes", async () => {
    render(<Menu objects={new Map([[SKIN, "removed"]])} />);
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Restore object" }));

    expect(screen.queryByRole("menuitem", { name: "Remove object" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, { kind: "object", edit: { kind: "restore", entry: SKIN } }),
      ),
    );
  });
});

describe("the new-object line", () => {
  it("suggests a name in the mod's folder with the caret at its end, and declares it on Enter", async () => {
    renderLine({ kind: "clone", source: OBJECT });
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Name of the new object" });

    await waitFor(() => expect(input).toHaveFocus());
    expect(input.value).toBe("Mods/skin/Skin0");
    expect(input.selectionStart).toBe(input.value.length);

    await userEvent.type(input, "Jade{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "object",
          edit: {
            kind: "create",
            name: "Mods/skin/Skin0Jade",
            origin: { type: "clone", source: SKIN },
          },
        }),
      ),
    );
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("keeps the name open and says why where the chunk holds the name", async () => {
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (sentEdit(command, args, "object")?.edit.kind === "create") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "BIN_EDIT_REJECTED",
            address: "Mods/skin/Skin0",
            rejection: { reason: "objectExists" },
          },
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    renderLine({ kind: "clone", source: OBJECT });
    const input = screen.getByRole("textbox", { name: "Name of the new object" });

    await userEvent.type(input, "{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The bin already holds an object of this name.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(close).not.toHaveBeenCalled();
  });

  it("takes a class first and names the object after it", async () => {
    renderLine({ kind: "class" });
    const search = screen.getByRole("combobox", { name: "Class of the new object" });

    await userEvent.type(search, "VfxSys");
    await userEvent.click(await screen.findByRole("option", { name: /VfxSystemDefinitionData/ }));

    const input = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Name of the new object",
    });
    expect(input.value).toBe("Mods/skin/VfxSystemDefinitionData");

    await userEvent.type(input, "{Escape}");
    expect(await screen.findByRole("combobox", { name: "Class of the new object" })).toBeVisible();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("an object row the layer removes", () => {
  it("draws struck through with a removed mark, and offers no edit and no expansion", () => {
    render(
      <Providers objects={new Map([[SKIN, "removed"]])}>
        <BinRowLine line={lineOf(OBJECT)} focused={false} onToggle={() => {}} />
      </Providers>,
    );

    const treeitem = screen.getByRole("treeitem");
    expect(treeitem).not.toHaveAttribute("aria-expanded");
    expect(screen.getByText("Characters/Teemo/Skins/Skin0")).toHaveClass("line-through");
    expect(screen.getByLabelText("Removed in base")).toHaveTextContent("removed");
    expect(screen.queryByRole("button", { name: "Add property" })).not.toBeInTheDocument();
  });

  it("marks an object the layer creates", () => {
    render(
      <Providers objects={new Map([[SKIN, "created"]])}>
        <BinRowLine line={lineOf(OBJECT)} focused={false} onToggle={() => {}} />
      </Providers>,
    );

    expect(screen.getByRole("img", { name: "Created in base" })).toBeInTheDocument();
    expect(screen.getByText("Characters/Teemo/Skins/Skin0")).not.toHaveClass("line-through");
  });
});
