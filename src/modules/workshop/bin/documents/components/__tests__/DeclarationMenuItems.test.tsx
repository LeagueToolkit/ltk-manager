// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu, ToastProvider } from "@/components";
import type { BinRow, DeclaredMark, RowDeclaration } from "@/lib/tauri";
import { editCall, isEdit, landed } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { RowDocumentContext } from "../../../tree/state/rowFold";
import { DeclaredRowsContext } from "../../hooks/useDeclared";
import { useCopiedReferenceStore } from "../../state/copiedReference";
import { DeclarationMenuItems } from "../DeclarationMenuItems";

const DOCUMENT = 7;
const REFERENCE = "Characters/Jade_Teemo/Skins/Skin0/Resources:resourceMap";

const ROW: BinRow = {
  entry: "0x2a1f3c7d",
  path: "0000000a",
  label: "resourceMap",
  node: "property",
  name: "resourceMap",
  unnamed: false,
  kind: "map",
  value: { type: "map", len: 2, keyKind: "hash", valueKind: "link" },
  declared: null,
};

const NO_MARKS: ReadonlyMap<string, DeclaredMark> = new Map();

interface MenuProps {
  declares: boolean;
  row?: BinRow;
  /** The tree takes edits, false for a document with declarations off. */
  editable?: boolean;
}

function Menu({ declares, row = ROW, editable = true }: MenuProps) {
  const [client] = useState(() => createTestQueryClient());
  const rows = declares
    ? {
        layer: "base",
        marks: NO_MARKS,
        diagnostics: new Map(),
        objects: new Map(),
        links: new Map(),
        editable,
      }
    : null;
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DeclaredRowsContext value={rows}>
          <RowDocumentContext value={DOCUMENT}>{children}</RowDocumentContext>
        </DeclaredRowsContext>
      </ToastProvider>
    </QueryClientProvider>
  );
  return wrap(
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <span>the row</span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <DeclarationMenuItems row={row} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>,
  );
}

let spelled: RowDeclaration;
const writeText = vi.fn((_text: string) => Promise.resolve());

async function openMenu() {
  const user = userEvent.setup();
  /* The setup installs a clipboard of its own, so the spy goes in after it. */
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await user.pointer({ keys: "[MouseRight]", target: screen.getByText("the row") });
  return user;
}

beforeEach(() => {
  spelled = {
    declaration: "- entries:\n    A:\n      resourceMap: {}",
    reference: REFERENCE,
    skipped: 0,
  };
  useCopiedReferenceStore.setState({ reference: null });
  writeText.mockClear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_row_declaration") return Promise.resolve({ ok: true, value: spelled });
    if (isEdit(command, args, "declareReference")) return landed();
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

describe("the declaration actions of a row", () => {
  it("copies the reference behind its tag and holds it for a paste", async () => {
    render(<Menu declares={false} />);
    const user = await openMenu();

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Copy reference" })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    await user.click(screen.getByRole("menuitem", { name: "Copy reference" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`!ref ${REFERENCE}`));
    expect(useCopiedReferenceStore.getState().reference).toBe(REFERENCE);
  });

  it("disables Copy as declaration with its reason where the value has no spelling", async () => {
    spelled = { declaration: null, reference: REFERENCE, skipped: 0 };
    render(<Menu declares={false} />);
    await openMenu();

    const item = await screen.findByRole("menuitem", { name: "Copy as declaration" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("title", expect.stringContaining("no table names"));
  });

  it("offers no paste outside a declared document", async () => {
    render(<Menu declares={false} />);
    await openMenu();

    await screen.findByRole("menuitem", { name: "Copy reference" });
    expect(screen.queryByRole("menuitem", { name: "Paste reference" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Merge reference" })).toBeNull();
  });

  it("offers no paste or merge on a declared document that takes no edit", async () => {
    useCopiedReferenceStore.setState({ reference: REFERENCE });
    render(<Menu declares editable={false} />);
    await openMenu();

    await screen.findByRole("menuitem", { name: "Copy reference" });
    expect(screen.queryByRole("menuitem", { name: "Paste reference" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Merge reference" })).toBeNull();
  });

  it("merges the copied reference into a map of a declared document", async () => {
    useCopiedReferenceStore.setState({ reference: REFERENCE });
    render(<Menu declares />);
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Merge reference" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "declareReference",
          entry: ROW.entry,
          path: ROW.path,
          reference: REFERENCE,
          merge: true,
        }),
      ),
    );
  });

  it("offers Merge reference on a list and a map alone", async () => {
    useCopiedReferenceStore.setState({ reference: REFERENCE });
    const leaf: BinRow = { ...ROW, kind: "f32", value: { type: "float", value: 1 } };
    render(<Menu declares row={leaf} />);
    await openMenu();

    await screen.findByRole("menuitem", { name: "Paste reference" });
    expect(screen.queryByRole("menuitem", { name: "Merge reference" })).toBeNull();
  });

  it("copies an object as its entry, and offers no reference or paste on it", async () => {
    spelled = {
      declaration: "- entries:\n    A:\n      championSkinName: Teemo",
      reference: null,
      skipped: 2,
    };
    useCopiedReferenceStore.setState({ reference: REFERENCE });
    const object: BinRow = { ...ROW, path: "", node: "object", kind: null };
    render(<Menu declares row={object} />);
    const user = await openMenu();

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Copy as declaration" })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    expect(screen.queryByRole("menuitem", { name: "Copy reference" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Paste reference" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Copy as declaration" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("- entries:\n    A:\n      championSkinName: Teemo"),
    );
    expect(
      await screen.findByText(
        "2 fields or entries no declaration can spell are left as the game has them",
      ),
    ).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("bin_row_declaration", {
      document: DOCUMENT,
      entry: ROW.entry,
      path: "",
    });
  });
});
