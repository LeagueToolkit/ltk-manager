// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BinRow } from "@/lib/tauri";

import type { RowLine } from "../../utils/binRows";
import { useTreeNavigation } from "../useTreeNavigation";

const ENTRY = "0x2a1f3c7d";

function line(path: string, depth: number, expanded: boolean): RowLine {
  const row: BinRow = {
    entry: ENTRY,
    path,
    label: path,
    node: path === "" ? "object" : "property",
    name: path,
    unnamed: false,
    kind: null,
    value: { type: "struct", classHash: "0x00000001", class: null, len: 1 },
    declared: null,
  };
  return {
    kind: "row",
    key: `${ENTRY}:${path}`,
    row,
    depth,
    expanded,
    loading: false,
    owner: null,
    parent: null,
    index: 0,
  };
}

const OBJECT = line("", 0, true);
const MESH = line("0000000a", 1, false);
const SCALE = line("0000000b", 1, false);
const VISIBLE = [OBJECT, MESH, SCALE];

/** A focused row element as the tree draws one, with a value field where `valued`. */
function rowElement(key: string, expanded: boolean | null, valued = false): HTMLElement {
  const element = document.createElement("div");
  element.dataset.treeRow = key;
  if (expanded !== null) element.setAttribute("aria-expanded", String(expanded));
  if (valued) {
    const value = document.createElement("span");
    value.setAttribute("data-row-value", "");
    element.append(value);
  }
  return element;
}

function press(key: string, target: HTMLElement): ReactKeyboardEvent<HTMLElement> {
  return { key, target, altKey: false, ctrlKey: false, metaKey: false } as never;
}

function navigation(editValue: ((key: string) => void) | null = null) {
  const toggle = vi.fn<(key: string) => void>();
  const scrollToKey = vi.fn<(key: string, align?: "start" | "auto") => boolean>(() => true);
  const scrollRef = { current: document.createElement("div") };
  const hook = renderHook(() =>
    useTreeNavigation({
      visible: VISIBLE,
      scrollRef,
      scrollToKey,
      drawn: null,
      toggle,
      editValue,
    }),
  );
  return { toggle, scrollToKey, hook };
}

describe("the tree's arrow keys", () => {
  it("walks the rows with Up, Down, Home and End, the first row the tab stop", () => {
    const { scrollToKey, hook } = navigation();
    expect(hook.result.current.tabStop).toBe(OBJECT.key);

    act(() => void hook.result.current.keyDown(press("ArrowDown", rowElement(OBJECT.key, true))));
    expect(scrollToKey).toHaveBeenLastCalledWith(MESH.key, "auto");
    expect(hook.result.current.tabStop).toBe(MESH.key);

    act(() => void hook.result.current.keyDown(press("End", rowElement(MESH.key, false))));
    expect(scrollToKey).toHaveBeenLastCalledWith(SCALE.key, "auto");

    act(() => void hook.result.current.keyDown(press("ArrowUp", rowElement(SCALE.key, false))));
    expect(scrollToKey).toHaveBeenLastCalledWith(MESH.key, "auto");
  });

  it("opens and shuts with Right and Left, and steps out to the parent", () => {
    const { toggle, scrollToKey, hook } = navigation();

    act(() => void hook.result.current.keyDown(press("ArrowRight", rowElement(MESH.key, false))));
    expect(toggle).toHaveBeenCalledWith(MESH.key);

    act(() => void hook.result.current.keyDown(press("ArrowLeft", rowElement(OBJECT.key, true))));
    expect(toggle).toHaveBeenLastCalledWith(OBJECT.key);

    const nested = { ...MESH, parent: OBJECT.row };
    const stepped = renderHook(() =>
      useTreeNavigation({
        visible: [OBJECT, nested, SCALE],
        scrollRef: { current: document.createElement("div") },
        scrollToKey,
        drawn: null,
        toggle,
        editValue: null,
      }),
    );
    act(() => void stepped.result.current.keyDown(press("ArrowLeft", rowElement(MESH.key, null))));
    expect(scrollToKey).toHaveBeenLastCalledWith(OBJECT.key, "auto");
  });

  it("opens a row's value on Enter and F2, and opens a row with none on Enter", () => {
    const editValue = vi.fn<(key: string) => void>();
    const { toggle, hook } = navigation(editValue);

    expect(hook.result.current.keyDown(press("F2", rowElement(SCALE.key, null, true)))).toBe(true);
    expect(editValue).toHaveBeenCalledWith(SCALE.key);

    expect(hook.result.current.keyDown(press("Enter", rowElement(MESH.key, false)))).toBe(true);
    expect(toggle).toHaveBeenCalledWith(MESH.key);
  });

  it("leaves a key on a field inside a row to the field", () => {
    const { hook } = navigation();
    const field = document.createElement("input");

    expect(hook.result.current.keyDown(press("ArrowDown", field))).toBe(false);
  });
});
