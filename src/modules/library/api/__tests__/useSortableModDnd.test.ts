import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLibraryFilterStore } from "@/stores";
import { createMockInstalledMod } from "@/test/fixtures";

const mockMutate = vi.fn();

vi.mock("../useMoveMod", () => ({
  useMoveModToFolder: () => ({ mutate: mockMutate }),
}));

import { useSortableModDnd } from "../useSortableModDnd";

function makeMods(ids: string[]) {
  return ids.map((id) => createMockInstalledMod({ id, displayName: id }));
}

function dragStart(id: string): DragStartEvent {
  return { active: { id } } as DragStartEvent;
}

function dragOver(activeId: string, overId: string): DragOverEvent {
  return { active: { id: activeId }, over: { id: overId } } as DragOverEvent;
}

function dragEnd(activeId: string, overId?: string): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  } as DragEndEvent;
}

describe("useSortableModDnd", () => {
  const onReorder = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryFilterStore.setState({ sort: { field: "priority", direction: "desc" } });
  });

  it("initializes localOrder from mods", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b", "c"]), onReorder }),
    );

    expect(result.current.localOrder).toEqual(["a", "b", "c"]);
  });

  it("returns orderedMods matching localOrder", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b", "c"]), onReorder }),
    );

    expect(result.current.orderedMods.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("sets activeId on drag start", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));

    expect(result.current.activeId).toBe("a");
    expect(result.current.activeMod?.id).toBe("a");
  });

  it("reorders on drag over", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b", "c"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragOver(dragOver("a", "c")));

    expect(result.current.localOrder).toEqual(["b", "c", "a"]);
  });

  it("skips reorder when hovering remove-from-folder zone", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragOver(dragOver("a", "remove-from-folder")));

    expect(result.current.localOrder).toEqual(["a", "b"]);
  });

  it("calls onReorder on drag end when order changed", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b", "c"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragOver(dragOver("a", "c")));
    act(() => result.current.handleDragEnd(dragEnd("a", "c")));

    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
    expect(result.current.activeId).toBeNull();
  });

  it("does not call onReorder when order unchanged", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragEnd(dragEnd("a", "a")));

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("resets order on drag cancel", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b", "c"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragOver(dragOver("a", "c")));
    expect(result.current.localOrder).toEqual(["b", "c", "a"]);

    act(() => result.current.handleDragCancel());

    expect(result.current.localOrder).toEqual(["a", "b", "c"]);
    expect(result.current.activeId).toBeNull();
  });

  it("calls moveModToFolder when dropped on remove zone with folderId", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b"]), onReorder, folderId: "folder-1" }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragEnd(dragEnd("a", "remove-from-folder")));

    expect(mockMutate).toHaveBeenCalledWith({ modId: "a", folderId: "root" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not call moveModToFolder without folderId", () => {
    const { result } = renderHook(() =>
      useSortableModDnd({ mods: makeMods(["a", "b"]), onReorder }),
    );

    act(() => result.current.handleDragStart(dragStart("a")));
    act(() => result.current.handleDragEnd(dragEnd("a", "remove-from-folder")));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("syncs localOrder when mods prop changes", () => {
    const { result, rerender } = renderHook(({ mods }) => useSortableModDnd({ mods, onReorder }), {
      initialProps: { mods: makeMods(["a", "b"]) },
    });

    expect(result.current.localOrder).toEqual(["a", "b"]);

    rerender({ mods: makeMods(["a", "b", "c"]) });

    expect(result.current.localOrder).toEqual(["a", "b", "c"]);
  });

  it("does not sync localOrder during active drag", () => {
    const { result, rerender } = renderHook(({ mods }) => useSortableModDnd({ mods, onReorder }), {
      initialProps: { mods: makeMods(["a", "b"]) },
    });

    act(() => result.current.handleDragStart(dragStart("a")));

    rerender({ mods: makeMods(["b", "a"]) });

    expect(result.current.localOrder).toEqual(["a", "b"]);
  });
});
