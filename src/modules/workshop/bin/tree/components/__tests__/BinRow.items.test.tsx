// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { use } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { BinRow } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";

import { assetKey } from "../../../../preview/utils/assetRef";
import { forgetBinSave } from "../../../../state";
import { type BinEdit, BinEditContext, type TreeFocus } from "../../hooks/useBinEdit";
import type { AddLine } from "../../utils/binRows";
import { AddItemLine } from "../AddItemLine";
import { ASSET, DOCUMENT, ENTRY, NO_FOCUS, providers, renderRow, row } from "./binEditFixtures";

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  forgetBinSave(assetKey(ASSET));
});

const LIST = `${ENTRY}:0000000b`;
const WEIGHTS = row({
  path: "0000000b",
  label: "weights",
  name: "weights",
  kind: "list",
  value: { type: "container", len: 3, itemKind: "f32" },
});

function weight(index: number): BinRow {
  return row({
    path: `0000000b[${index}]`,
    label: `weights[${index}]`,
    name: `[${index}]`,
    node: "element",
    kind: "f32",
    value: { type: "float", value: index + 0.5 },
  });
}

/** An invoke's edit or choice query kind, or its command where it carries neither. */
function kindOf(command: string, args?: Record<string, unknown>): string {
  if (command === "bin_edit") return (args?.edit as { kind: string }).kind;
  if (command === "bin_choices") return (args?.query as { kind: string }).kind;
  return command;
}

/** Answer each edit and choice query by its kind, an edit with no answer as done. */
function answering(answers: Record<string, unknown>) {
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    const kind = kindOf(command, args);
    const fallback = command === "bin_edit" ? { kind: "done" } : null;
    return Promise.resolve({ ok: true, value: kind in answers ? answers[kind] : fallback });
  });
}

/** The `bin_edit` invokes of edit `kind`, as their arguments. */
function calls(kind: string) {
  return mockInvoke.mock.calls
    .filter(([command, args]) => command === "bin_edit" && kindOf(command, args) === kind)
    .map(([, args]) => args);
}

type FocusSpy = TreeFocus & Record<"to" | "reach" | "remap" | "addTo" | "insertAt", Mock>;

function spyFocus(): FocusSpy {
  return {
    ...NO_FOCUS,
    to: vi.fn(),
    reach: vi.fn(),
    remap: vi.fn(),
    addTo: vi.fn(),
    insertAt: vi.fn(),
  };
}

/** The first key remap an edit handed the tree. */
function firstRemap(focus: FocusSpy): (key: string) => string | null {
  return (focus.remap.mock.calls[0] as [(key: string) => string | null])[0];
}

describe("the items of a list", () => {
  it("appends a leaf item from the list row and focuses it", async () => {
    answering({ insertItem: { kind: "path", path: "0000000b[3]" } });
    const focus = spyFocus();
    renderRow(WEIGHTS, { focus });

    await userEvent.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(calls("insertItem")).toEqual([
        {
          document: DOCUMENT,
          edit: {
            kind: "insertItem",
            entry: ENTRY,
            path: "0000000b",
            item: { index: null, key: null, class: null },
          },
        },
      ]),
    );
    await waitFor(() => expect(focus.to).toHaveBeenCalledWith(`${LIST}[3]`, LIST));
    expect(focus.reach).toHaveBeenCalledWith(LIST, 4);
  });

  it("inserts after an item from its action and from Ctrl+Enter, and moves the rows below", async () => {
    answering({ insertItem: { kind: "path", path: "0000000b[2]" } });
    const focus = spyFocus();
    renderRow(weight(1), { parent: WEIGHTS, index: 1, focus });

    await userEvent.click(screen.getByRole("button", { name: "Insert after" }));
    await waitFor(() => expect(calls("insertItem")).toHaveLength(1));
    expect(calls("insertItem")[0]).toMatchObject({
      edit: { path: "0000000b", item: { index: 2 } },
    });
    await waitFor(() => expect(focus.remap).toHaveBeenCalled());
    expect(firstRemap(focus)(`${LIST}[2].0000000c`)).toBe(`${LIST}[3].0000000c`);
    expect(firstRemap(focus)(`${LIST}[1]`)).toBe(`${LIST}[1]`);

    act(() => screen.getByDisplayValue("1.5").focus());
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(calls("insertItem")).toHaveLength(2));
  });

  it("moves the focused item with Alt+ArrowDown and follows it", async () => {
    answering({ moveItem: { kind: "path", path: "0000000b[2]" } });
    const focus = spyFocus();
    renderRow(weight(1), { parent: WEIGHTS, index: 1, focus });

    act(() => screen.getByDisplayValue("1.5").focus());
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    await waitFor(() =>
      expect(calls("moveItem")).toEqual([
        {
          document: DOCUMENT,
          edit: { kind: "moveItem", entry: ENTRY, path: "0000000b[1]", to: 2 },
        },
      ]),
    );
    await waitFor(() => expect(focus.to).toHaveBeenCalledWith(`${LIST}[2]`, null));
  });

  it("does not move the first item up", async () => {
    answering({});
    renderRow(weight(0), { parent: WEIGHTS, index: 0 });

    act(() => screen.getByDisplayValue("0.5").focus());
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(calls("moveItem")).toEqual([]);
  });

  it("removes an item and drops the rows it held", async () => {
    answering({});
    const focus = spyFocus();
    renderRow(weight(1), { parent: WEIGHTS, index: 1, focus });

    await userEvent.click(screen.getByRole("button", { name: "Remove item" }));

    await waitFor(() =>
      expect(calls("removeItem")).toEqual([
        { document: DOCUMENT, edit: { kind: "removeItem", entry: ENTRY, path: "0000000b[1]" } },
      ]),
    );
    await waitFor(() => expect(focus.remap).toHaveBeenCalled());
    expect(firstRemap(focus)(`${LIST}[1].0000000c`)).toBeNull();
    expect(firstRemap(focus)(`${LIST}[2]`)).toBe(`${LIST}[1]`);
  });
});

const NAMES = row({
  path: "0000000e",
  label: "names",
  name: "names",
  kind: "map",
  value: { type: "map", len: 1, keyKind: "hash", valueKind: "f32" },
});

describe("the entries of a map", () => {
  it("sets an entry's key through the name's edit action", async () => {
    answering({ setKey: { kind: "path", path: "0000000e{0000abcd}" } });
    const idle = row({
      path: "0000000e{0000beef}",
      label: 'names{"Idle"}',
      name: '"Idle"',
      node: "entry",
    });
    renderRow(idle, { parent: NAMES, index: 0 });

    await userEvent.click(screen.getByRole("button", { name: "Edit key" }));
    const field = screen.getByDisplayValue("Idle");
    await userEvent.clear(field);
    await userEvent.type(field, "Run{Enter}");

    await waitFor(() =>
      expect(calls("setKey")).toEqual([
        {
          document: DOCUMENT,
          edit: { kind: "setKey", entry: ENTRY, path: "0000000e{0000beef}", key: "Run" },
        },
      ]),
    );
  });

  it("adds an entry under the key typed, and Enter on its value returns to the line", async () => {
    answering({ insertItem: { kind: "path", path: "0000000e{0000abcd}" } });
    const focus = spyFocus();
    const probed: { edit: BinEdit | null } = { edit: null };
    const line: AddLine = {
      kind: "add",
      key: `${ENTRY}:0000000e:add`,
      document: DOCUMENT,
      entry: ENTRY,
      path: "0000000e",
      depth: 1,
      target: { kind: "entry", keyKind: "hash", valueKind: "f32" },
      index: null,
    };
    function Probe() {
      probed.edit = use(BinEditContext);
      return null;
    }
    render(
      <>
        <Probe />
        <AddItemLine line={line} autoFocus={false} />
      </>,
      { wrapper: providers(focus) },
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Add entry" }), '"Walk"{Enter}');

    await waitFor(() =>
      expect(calls("insertItem")).toEqual([
        {
          document: DOCUMENT,
          edit: {
            kind: "insertItem",
            entry: ENTRY,
            path: "0000000e",
            item: { index: null, key: "Walk", class: null },
          },
        },
      ]),
    );
    const added = `${ENTRY}:0000000e{0000abcd}`;
    await waitFor(() => expect(focus.to).toHaveBeenCalledWith(added, null));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Add entry" })).toHaveValue(""));

    act(() => probed.edit?.enter(added));
    expect(focus.to).toHaveBeenLastCalledWith(line.key, null);
  });
});

describe("the class line of a pointer list", () => {
  it("offers the classes the list can hold and adds the one picked", async () => {
    answering({
      itemClasses: {
        kind: "classes",
        classes: [
          { hash: "0x00000abc", name: "VfxEmitterDefinitionData", held: true, derivesFrom: null },
        ],
      },
      insertItem: { kind: "path", path: "0000000f[1]" },
    });
    const focus = spyFocus();
    const line: AddLine = {
      kind: "add",
      key: `${ENTRY}:0000000f:add`,
      document: DOCUMENT,
      entry: ENTRY,
      path: "0000000f",
      depth: 1,
      target: { kind: "item", itemKind: "pointer" },
      index: null,
    };
    render(<AddItemLine line={line} autoFocus={false} />, { wrapper: providers(focus) });

    await userEvent.click(screen.getByRole("combobox", { name: "Add item" }));
    await userEvent.click(await screen.findByRole("option", { name: /VfxEmitterDefinitionData/ }));

    await waitFor(() =>
      expect(calls("insertItem")).toEqual([
        {
          document: DOCUMENT,
          edit: {
            kind: "insertItem",
            entry: ENTRY,
            path: "0000000f",
            item: { index: null, key: null, class: "0x00000abc" },
          },
        },
      ]),
    );
    const added = `${ENTRY}:0000000f[1]`;
    await waitFor(() => expect(focus.to).toHaveBeenCalledWith(`${added}:add`, added));
  });
});

describe("an option and a pointer", () => {
  it("clears a present option from its row", async () => {
    answering({});
    renderRow(row({ kind: "option" }));

    await userEvent.click(screen.getByRole("button", { name: "Clear value" }));

    await waitFor(() =>
      expect(calls("removeItem")).toEqual([
        { document: DOCUMENT, edit: { kind: "removeItem", entry: ENTRY, path: "0000000a[0]" } },
      ]),
    );
  });

  it("opens a null pointer's class line from its row", async () => {
    answering({});
    const focus = spyFocus();
    const pointer = row({ kind: "pointer", value: { type: "null" } });
    renderRow(pointer, { focus });

    await userEvent.click(screen.getByRole("button", { name: "Set class" }));

    expect(focus.addTo).toHaveBeenCalledWith(pointer);
  });
});
