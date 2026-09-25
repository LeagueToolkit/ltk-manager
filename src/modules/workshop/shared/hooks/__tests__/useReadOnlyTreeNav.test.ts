// @vitest-environment happy-dom

import type { Virtualizer } from "@tanstack/react-virtual";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { expect, it, vi } from "vitest";

import { useReadOnlyTreeNav } from "../useReadOnlyTreeNav";

const rows = ["first", "second", "third"].map((node) => ({ node, depth: 0 }));

function nav(onKeyMove?: (node: string) => void) {
  return renderHook(() =>
    useReadOnlyTreeNav({
      rows,
      isExpanded: () => false,
      onToggle: vi.fn(),
      onOpen: vi.fn(),
      expandable: () => false,
      activation: () => "open",
      virtualizer: { scrollToIndex: vi.fn() } as unknown as Virtualizer<HTMLDivElement, Element>,
      scrollElementRef: { current: null },
      onKeyMove,
    }),
  );
}

function press(key: string) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

it("reports the row each key moved focus to, and nothing for Enter", () => {
  const moved = vi.fn();
  const { result } = nav(moved);

  act(() => result.current.handleKeyDown(press("ArrowDown")));
  expect(moved).toHaveBeenLastCalledWith("second");

  act(() => result.current.handleKeyDown(press("End")));
  expect(moved).toHaveBeenLastCalledWith("third");

  act(() => result.current.handleKeyDown(press("ArrowDown")));
  expect(moved).toHaveBeenLastCalledWith("third");

  moved.mockClear();
  act(() => result.current.handleKeyDown(press("Enter")));
  expect(moved).not.toHaveBeenCalled();
});

it("moves focus alone for a tree that asks for no report", () => {
  const { result } = nav();

  act(() => result.current.handleKeyDown(press("ArrowDown")));
  expect(result.current.focusedIndex).toBe(1);
});
