// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { ChoiceQuery } from "@/lib/tauri";
import { editCall, isEdit } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { assetKey } from "../../../../preview/utils/assetRef";
import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { forgetBinSave } from "../../../../state";
import { undoStep } from "../../../documents/hooks/useUndoKeys";
import { BinEditContext, type TreeFocus, useBinEditor } from "../../hooks/useBinEdit";
import type { AddLine } from "../../utils/binRows";
import { AddPropertyLine } from "../AddPropertyLine";
import { ASSET, DOCUMENT, ENTRY, NO_FOCUS, PROJECT, renderRow, row } from "./binEditFixtures";

function patches() {
  return mockInvoke.mock.calls.filter(([command, args]) => isEdit(command, args, "patch"));
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ ok: true, value: { type: "float", value: 1.5 } });
});

afterEach(() => {
  forgetBinSave(assetKey(ASSET));
});

describe("a leaf of an editable document", () => {
  it("sends a float once the field is left, and saves after the wait", async () => {
    renderRow(row({}));
    const field = screen.getByDisplayValue("1.5");
    expect(field).not.toHaveAttribute("readonly");

    await userEvent.clear(field);
    await userEvent.type(field, "2.25{Enter}");

    await waitFor(() =>
      expect(patches()).toEqual([
        editCall(DOCUMENT, {
          kind: "patch",
          entry: ENTRY,
          path: "0000000a",
          value: { type: "float", value: 2.25 },
        }),
      ]),
    );
    await waitFor(
      () => expect(mockInvoke).toHaveBeenCalledWith("bin_save", { document: DOCUMENT }),
      {
        timeout: 2000,
      },
    );
  });

  it("marks a value it cannot send, and sends nothing", async () => {
    renderRow(row({}));
    const field = screen.getByDisplayValue("1.5");

    await userEvent.clear(field);
    await userEvent.type(field, "wide{Enter}");

    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(patches()).toEqual([]);
  });

  it("marks a value the backend refused", async () => {
    mockInvoke.mockResolvedValue({
      ok: false,
      error: {
        code: "BIN_EDIT_REJECTED",
        address: `${ENTRY}:0000000a`,
        rejection: { reason: "outOfRange", kind: "u8" },
      },
    });
    renderRow(row({ kind: "u8", value: { type: "integer", text: "7" } }));
    const field = screen.getByDisplayValue("7");

    await userEvent.clear(field);
    await userEvent.type(field, "300{Enter}");

    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveValue("300");
  });

  it("toggles a bool", async () => {
    renderRow(row({ kind: "bool", value: { type: "bool", value: false } }));

    await userEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(patches()).toEqual([
        editCall(DOCUMENT, {
          kind: "patch",
          entry: ENTRY,
          path: "0000000a",
          value: { type: "bool", value: true },
        }),
      ]),
    );
  });

  it("leaves a field untouched by an Escape", async () => {
    renderRow(row({}));
    const field = screen.getByDisplayValue("1.5");

    await userEvent.clear(field);
    await userEvent.type(field, "9{Escape}");

    expect(field).toHaveValue("1.5");
    expect(patches()).toEqual([]);
  });
});

describe("a leaf drawn as a chip", () => {
  it("opens a field on its edit action and sends the name typed", async () => {
    renderRow(
      row({
        kind: "link",
        value: { type: "objectLink", hash: "0x0000002b", name: null },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit value" }));
    const field = screen.getByDisplayValue("0x0000002b");
    expect(field).toHaveFocus();

    await userEvent.clear(field);
    await userEvent.type(field, "Characters/Aatrox{Enter}");

    await waitFor(() =>
      expect(patches()).toEqual([
        editCall(DOCUMENT, {
          kind: "patch",
          entry: ENTRY,
          path: "0000000a",
          value: { type: "objectLink", text: "Characters/Aatrox" },
        }),
      ]),
    );
    expect(screen.queryByDisplayValue("Characters/Aatrox")).toBeNull();
  });
});

describe("the undo keys", () => {
  it("reads Ctrl+Z as an undo, and Ctrl+Shift+Z and Ctrl+Y as a redo", () => {
    const keys = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    expect(undoStep({ ...keys, key: "z" })).toBe("undo");
    expect(undoStep({ ...keys, key: "Z", shiftKey: true })).toBe("redo");
    expect(undoStep({ ...keys, key: "y" })).toBe("redo");
    expect(undoStep({ ...keys, key: "z", ctrlKey: false })).toBeNull();
    expect(undoStep({ ...keys, key: "z", altKey: true })).toBeNull();
  });
});
describe("the add line", () => {
  const LINE: AddLine = {
    kind: "add",
    key: `${ENTRY}::add`,
    document: DOCUMENT,
    entry: ENTRY,
    path: "",
    depth: 1,
    target: { kind: "property" },
    index: null,
  };
  const ADDABLE = {
    classHash: "0x9b67e9f6",
    class: "SkinData",
    fields: [
      {
        hash: "0x0000000a",
        name: "birthScale",
        shape: { kind: "f32", key: null, value: null },
        classHash: null,
        class: null,
        inheritedFrom: null,
      },
    ],
  };

  function Tree({ focus, children }: { focus: TreeFocus; children: ReactNode }) {
    const edit = useBinEditor(DOCUMENT, ASSET, true, focus);
    return <BinEditContext value={edit}>{children}</BinEditContext>;
  }

  function renderAddLine(focus: TreeFocus = NO_FOCUS) {
    return render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProjectProvider project={PROJECT}>
          <ToastProvider>
            <Tree focus={focus}>
              <AddPropertyLine line={LINE} autoFocus={false} />
            </Tree>
          </ToastProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "bin_choices" && (args?.query as ChoiceQuery).kind === "addableFields") {
        return Promise.resolve({ ok: true, value: { kind: "fields", fields: ADDABLE } });
      }
      return Promise.resolve({ ok: true, value: null });
    });
  });

  it("adds the declared field typed toward, and sends focus to its value", async () => {
    const to = vi.fn();
    renderAddLine({ ...NO_FOCUS, to });
    const input = screen.getByRole("combobox", { name: "Add property" });

    await userEvent.type(input, "birth");
    await userEvent.click(await screen.findByRole("option", { name: /birthScale/ }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "addProperty",
          entry: ENTRY,
          path: "",
          property: { kind: "declared", field: "0x0000000a" },
        }),
      ),
    );
    await waitFor(() => expect(to).toHaveBeenCalledWith(`${ENTRY}:0000000a`, null));
    expect(input).toHaveValue("");
  });

  it("adds a field typed as name: kind with Enter", async () => {
    renderAddLine();
    const input = screen.getByRole("combobox", { name: "Add property" });

    await userEvent.type(input, "mySpeed: f32");
    await screen.findByRole("option", { name: /mySpeed/ });
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "addProperty",
          entry: ENTRY,
          path: "",
          property: {
            kind: "custom",
            field: "mySpeed",
            shape: { kind: "f32", key: null, value: null },
            class: null,
          },
        }),
      ),
    );
  });
});

describe("the remove action of a property row", () => {
  it("sends the path of the row", async () => {
    renderRow(row({}));

    await userEvent.click(screen.getByRole("button", { name: "Remove property" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "removeProperty",
          entry: ENTRY,
          path: "0000000a",
        }),
      ),
    );
  });
});
