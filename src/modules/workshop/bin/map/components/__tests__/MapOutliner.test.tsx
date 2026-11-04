// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapChunk, MapChunkItem } from "@/lib/tauri";

import { mapQueries } from "../../api/mapQueries";
import { MapOutliner } from "../MapOutliner";

const DOCUMENT = 7 as never;
const focusOn = vi.fn();
/* What the scene holds as the outliner mounts, as a pick made in the viewport leaves it. */
const seed: { selected: ReadonlySet<string>; lead: string | null } = {
  selected: new Set(),
  lead: null,
};

/* The virtualizer measures nothing here, so every row is laid out at its estimate. */
vi.mock("@tanstack/react-virtual", () => ({
  elementScroll: () => {},
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: (index: number) => number;
  }) => {
    const size = count === 0 ? 0 : estimateSize(0);
    return {
      measure: () => {},
      scrollToIndex: () => {},
      getTotalSize: () => size * count,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          key: index,
          index,
          start: index * size,
          size,
        })),
    };
  },
}));

/* Each reader holds its own filter and selection, which is all one outliner needs. */
vi.mock("../../state/mapScene", async () => {
  const { useState } = await import("react");
  const { NO_FILTER } = await import("../../utils/mapOutline");
  const { NAV_GUIDE_DEFAULT } = await import("../../utils/navGuide");
  return {
    useMapScene: () => {
      const [filter, setFilter] = useState(NO_FILTER);
      const [selected, setSelected] = useState<ReadonlySet<string>>(seed.selected);
      const [lead, setLead] = useState<string | null>(seed.lead);
      return {
        materials: DOCUMENT,
        chosen: null,
        variants: undefined,
        failed: false,
        hidden: new Set(),
        setHidden: vi.fn(),
        focus: null,
        focusOn,
        filter,
        setFilter,
        selected,
        lead,
        select: (ids: readonly string[]) => {
          setSelected(new Set(ids));
          setLead(ids[0] ?? null);
        },
        backdrop: { controllers: [], navGrid: null, visibility: { flags: 0 } },
        navGuide: NAV_GUIDE_DEFAULT,
        setNavGuide: vi.fn(),
        geometry: null,
        geometryDocument: null,
        geometryEdited: null,
        editable: false,
        apply: vi.fn(),
        editGeometry: vi.fn(),
        stepHistory: vi.fn(),
        stepsHistory: () => false,
        saveGeometry: vi.fn(),
        tool: "select",
        setTool: vi.fn(),
        setRenaming: vi.fn(),
        target: null,
        setTarget: vi.fn(),
        dragged: null,
      };
    },
  };
});

afterEach(() => {
  cleanup();
  seed.selected = new Set();
  seed.lead = null;
  focusOn.mockClear();
});

function item(key: string, name: string, kind: MapChunkItem["kind"]): MapChunkItem {
  return {
    key,
    name,
    class: kind === "particle" ? "MapParticle" : "MapLocator",
    kind,
    position: [1, 2, 3],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
    shape: null,
    visibility: 255,
    controller: null,
  };
}

const CHUNKS: MapChunk[] = [
  {
    entry: "0xaaaaaaaa",
    name: "Maps/MapGeometry/Map11/Chunks/SRX_VFX_Fire",
    items: [item("0x00000001", "Brazier_01", "particle"), item("0x00000002", "Spawn", "locator")],
  },
  {
    entry: "0xbbbbbbbb",
    name: "Maps/MapGeometry/Map11/Chunks/Plants",
    items: [item("0x00000003", "Bush_01", "particle")],
  },
];

function renderOutliner() {
  const client = new QueryClient();
  client.setQueryData(mapQueries.outline(DOCUMENT).queryKey, CHUNKS);
  render(
    <QueryClientProvider client={client}>
      <MapOutliner />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe("MapOutliner", () => {
  it("narrows to what the search matches, opening its chunk and counting the matches", async () => {
    const user = renderOutliner();

    await user.type(screen.getByRole("textbox", { name: "Search placeables" }), "brazier");

    const rows = screen.getAllByRole("treeitem").map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("SRX_VFX_Fire");
    expect(rows[1]).toContain("Brazier_01");
    expect(screen.getByText("1/2")).toBeDefined();
  });

  it("leaves out a kind unticked in the filter menu", async () => {
    const user = renderOutliner();

    await user.click(screen.getByRole("button", { name: "What the outliner shows" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /Particles/ }));

    const names = screen.getAllByRole("treeitem").map((row) => row.textContent);
    expect(names.some((name) => name?.includes("Spawn"))).toBe(true);
    expect(names.some((name) => name?.includes("Plants"))).toBe(false);
  });

  it("walks the rows from the keyboard and flies to a placeable on Enter", async () => {
    const user = renderOutliner();

    await user.click(screen.getByRole("tree"));
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowDown}{Enter}");

    expect(focusOn).toHaveBeenCalledWith({
      id: "0xaaaaaaaa/0x00000001",
      position: [1, 2, 3],
    });
  });

  it("selects a placeable on a click and lets Ctrl+A select every one listed", async () => {
    const user = renderOutliner();

    await user.type(screen.getByRole("textbox", { name: "Search placeables" }), "_01");
    const brazier = screen
      .getAllByRole("treeitem")
      .find((row) => row.textContent?.includes("Brazier_01"));
    if (brazier === undefined) throw new Error("no Brazier_01 row");
    await user.click(brazier);

    const selected = () =>
      screen
        .getAllByRole("treeitem")
        .filter((row) => row.getAttribute("aria-selected") === "true")
        .map((row) => row.textContent);
    expect(selected()).toHaveLength(1);

    await user.click(screen.getByRole("tree"));
    await user.keyboard("{Control>}a{/Control}");
    expect(selected()).toHaveLength(2);
  });

  it("opens the chunk of a placeable picked in the viewport and stands on its row", () => {
    seed.selected = new Set(["0xbbbbbbbb/0x00000003"]);
    seed.lead = "0xbbbbbbbb/0x00000003";
    renderOutliner();

    const bush = screen
      .getAllByRole("treeitem")
      .find((row) => row.textContent?.includes("Bush_01"));
    expect(bush?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tree").getAttribute("aria-activedescendant")).toBe(bush?.id);
  });
});
