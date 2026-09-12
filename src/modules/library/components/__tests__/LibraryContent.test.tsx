// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentView } from "../../api/useLibraryContent";
import { LibraryContent } from "../LibraryContent";

const useLibraryContent = vi.fn();

vi.mock("../../api", () => ({
  ModThumbnails: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLibraryContent: (args: unknown) => useLibraryContent(args),
  useReorderMods: () => ({ mutate: vi.fn() }),
  useReorderFolderMods: () => ({ mutate: vi.fn() }),
}));

vi.mock("../LibraryContextMenu", () => ({
  LibraryContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../LibraryStates", () => ({
  LibraryLoadingState: () => <div>loading</div>,
  LibraryErrorState: () => <div>error</div>,
  LibraryEmptyState: () => <div>empty</div>,
}));
vi.mock("../UnifiedDndGrid", () => ({
  UnifiedDndGrid: () => <div>grid</div>,
  gridClass: () => "grid",
}));
vi.mock("../SortableModList", () => ({ SortableModList: () => <div>list</div> }));
vi.mock("../FolderHeader", () => ({ FolderHeader: () => <div>folder</div> }));

const unified: ContentView = {
  type: "unified",
  folders: [],
  rootMods: [],
  modsByFolder: new Map(),
};

function show(contentView: ContentView) {
  useLibraryContent.mockReturnValue({
    viewMode: "grid",
    dndDisabled: false,
    hasSelection: false,
    contentView,
  });
}

const scroller = (container: HTMLElement) => container.querySelector(".overflow-auto");

beforeEach(() => vi.clearAllMocks());

describe("LibraryContent", () => {
  it("keeps one scroller across every state", () => {
    show({ type: "loading" });
    const { container, rerender } = render(<LibraryContent {...props()} />);
    const first = scroller(container);

    for (const view of [unified, { type: "empty", hasSearch: false, hasFilters: false } as const]) {
      show(view);
      rerender(<LibraryContent {...props()} />);
      expect(scroller(container)).toBe(first);
    }

    expect(first?.isConnected).toBe(true);
  });

  it("keeps the library a failed background refetch left standing", () => {
    show(unified);
    render(<LibraryContent {...props({ error: { code: "Other" } as never })} />);

    expect(useLibraryContent).toHaveBeenCalledWith(expect.objectContaining({ hasError: false }));
  });

  it("reports the error when there is no library behind it", () => {
    show({ type: "error" });
    render(<LibraryContent {...props({ error: { code: "Other" } as never, mods: [] })} />);

    expect(useLibraryContent).toHaveBeenCalledWith(expect.objectContaining({ hasError: true }));
  });
});

function props(overrides: Partial<Parameters<typeof LibraryContent>[0]> = {}) {
  return {
    mods: [{ id: "a" } as never],
    searchQuery: "",
    isLoading: false,
    error: null,
    ...overrides,
  };
}
