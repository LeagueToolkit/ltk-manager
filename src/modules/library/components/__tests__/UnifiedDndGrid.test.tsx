// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledMod } from "@/lib/tauri";
import { renderWithProviders } from "@/test/utils";

import { UnifiedDndGrid } from "../UnifiedDndGrid";
import { installedMod } from "./modHealthFixtures";

const VIEWPORT_PX = 600;
const CARD_PX = 200;

/* The cards themselves are the library's heaviest component and answer to
   queries of their own. What this suite is about is the tree above them. */
vi.mock("../SortableModCard", () => ({
  SortableModCard: ({ mod }: { mod: InstalledMod }) => <div data-testid="card">{mod.id}</div>,
}));
vi.mock("../SortableFolderCard", () => ({
  SortableFolderCard: () => <div data-testid="folder" />,
}));
vi.mock("../SortableFolderRow", () => ({ SortableFolderRow: () => <div data-testid="folder" /> }));
vi.mock("../DndDragOverlay", () => ({ DndDragOverlay: () => null }));
vi.mock("../RemoveFromFolderZone", () => ({ RemoveFromFolderZone: () => null }));

const mods = Array.from({ length: 6 }, (_, index) => installedMod(`mod-${index}`, `Mod ${index}`));

/** A scroller that reports a real height, which happy-dom does not lay out. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.dataset.scroller === "" ? VIEWPORT_PX : CARD_PX;
      return {
        top: 0,
        left: 0,
        bottom: height,
        right: 800,
        width: 800,
        height,
        x: 0,
        y: 0,
      } as DOMRect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(CARD_PX);
}

function grid(dndDisabled: boolean) {
  return (
    <div data-scroller="" style={{ overflowY: "auto", height: VIEWPORT_PX }}>
      <UnifiedDndGrid
        folders={[]}
        rootMods={mods}
        modsByFolder={new Map()}
        viewMode="list"
        dndDisabled={dndDisabled}
        onReorder={vi.fn()}
      />
    </div>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  layOut();
});

describe("UnifiedDndGrid", () => {
  /* Picking a mod disables the drag, and the grid used to answer that by
     rendering a second tree without the dnd contexts. That remounted every
     card, and `VirtualCards` starts each mount at one column - so a press that
     only picked a mod flashed the whole grid through a single column. */
  it("keeps its cards mounted when the drag is disabled under them", () => {
    const { rerender } = renderWithProviders(grid(false));
    const first = screen.getAllByTestId("card")[0];

    rerender(grid(true));

    expect(screen.getAllByTestId("card")[0]).toBe(first);
    expect(first?.isConnected).toBe(true);
  });

  /* The direction a reader actually notices: clearing the selection. */
  it("keeps them mounted when the drag is enabled again", () => {
    const { rerender } = renderWithProviders(grid(true));
    const first = screen.getAllByTestId("card")[0];

    rerender(grid(false));

    expect(screen.getAllByTestId("card")[0]).toBe(first);
    expect(first?.isConnected).toBe(true);
  });

  it("draws the same cards either way", () => {
    const { rerender } = renderWithProviders(grid(false));
    const enabled = screen.getAllByTestId("card").length;

    rerender(grid(true));

    expect(screen.getAllByTestId("card")).toHaveLength(enabled);
  });
});
