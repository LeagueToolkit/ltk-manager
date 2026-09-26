// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BinRow, Dependency } from "@/lib/tauri";

import type { ChildrenRequest } from "../../../documents/hooks/useBinDocument";
import { DEPENDENCIES_KEY, rowKey } from "../../utils/binRows";
import { useTreeRows } from "../useTreeRows";

const { asked } = vi.hoisted(() => ({ asked: [] as (readonly ChildrenRequest[])[] }));

vi.mock("../../../documents/hooks/useBinDocument", () => ({
  useBinChildren: (_document: number, requests: readonly ChildrenRequest[]) => {
    asked.push(requests);
    return { loaded: new Map(), notOpen: false };
  },
}));

const ENTRY = "0x2a1f3c7d";

const OBJECT: BinRow = {
  entry: ENTRY,
  path: "",
  label: "",
  node: "object",
  name: "Characters/Aatrox",
  unnamed: false,
  kind: null,
  value: { type: "struct", classHash: "0x9b67e9f6", class: "CharacterRecord", len: 2 },
  declared: null,
};

const OBJECT_KEY = rowKey(OBJECT);
const NESTED_KEY = `${OBJECT_KEY}0000000b`;
const DEPENDENCIES: readonly Dependency[] = [];

function renderRows() {
  return renderHook(() =>
    useTreeRows({
      document: 1,
      roots: [OBJECT],
      rootOwner: null,
      initialExpanded: [OBJECT_KEY, NESTED_KEY, DEPENDENCIES_KEY],
      onNotOpen: () => {},
      editable: false,
      rootEntry: null,
      dependencies: DEPENDENCIES,
    }),
  );
}

function lastAsked() {
  return asked.at(-1)?.map((request) => request.key);
}

function expandedLines(result: ReturnType<typeof renderRows>["result"]) {
  return result.current.visible.flatMap((line) =>
    "expanded" in line && line.expanded ? [line.key] : [],
  );
}

beforeEach(() => {
  asked.length = 0;
});

describe("useTreeRows collapseAll", () => {
  it("collapses every open row, the pinned dependencies included", () => {
    const { result } = renderRows();
    expect(expandedLines(result)).toEqual([DEPENDENCIES_KEY, OBJECT_KEY]);

    act(() => result.current.collapseAll());

    expect(expandedLines(result)).toEqual([]);
    expect(lastAsked()).toEqual([]);
  });

  it("opens one level on the next toggle, without the rows that were open under it", () => {
    const { result } = renderRows();

    act(() => result.current.collapseAll());
    act(() => result.current.toggle(OBJECT_KEY));

    expect(lastAsked()).toEqual([OBJECT_KEY]);
  });
});
