// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DeclarationsLayer, DeclaredModule } from "@/lib/tauri";

import { keyItemId, type OutlineShape } from "../../utils/outlineTree";
import { DeclarationsTree } from "../DeclarationsTree";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    measure: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * estimateSize(),
      })),
  }),
}));

const SPAN = { line: 1, column: 1, endLine: 1, endColumn: 2 };

const ENTRIES: DeclaredModule = {
  index: 0,
  name: null,
  selector: "entries",
  target: null,
  targetHash: null,
  source: null,
  overrides: [],
  span: SPAN,
  entries: [
    {
      name: "Characters/Teemo/Skins/Skin0",
      hash: "0x1234abcd",
      edit: 0,
      object: null,
      span: SPAN,
      keys: [
        {
          key: "skinMeshProperties.selfIllumination",
          sign: "set",
          path: "skinMeshProperties.selfIllumination",
          value: "0.37",
          row: "0a.0b",
          span: SPAN,
        },
        {
          key: "+resourceMap",
          sign: "add",
          path: "resourceMap",
          value: "Teemo_R: Characters/Jade/R\nTeemo_Q: Characters/Jade/Q",
          row: "0c",
          span: SPAN,
        },
      ],
    },
  ],
};

const TARGET: DeclaredModule = {
  ...ENTRIES,
  index: 1,
  selector: "target",
  target: "data/characters/teemo/skins/skin0.bin",
  targetHash: "00112233aabbccdd",
  entries: [],
};

const LAYER: DeclarationsLayer = {
  layer: "base",
  file: "game_data.yaml",
  text: "version: 1\n",
  error: null,
  modules: [ENTRIES, TARGET],
};

const SHAPE: OutlineShape = { layers: false, keys: true };

function renderTree(overrides: Partial<Parameters<typeof DeclarationsTree>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <DeclarationsTree
      layers={[LAYER]}
      shape={SHAPE}
      ariaLabel="Declarations outline"
      onOpen={onOpen}
      openBranches={false}
      {...overrides}
    />,
  );
  return { onOpen };
}

describe("DeclarationsTree", () => {
  it("draws modules, entries and keys in manifest order", () => {
    renderTree();

    const rows = screen.getAllByRole("treeitem").map((row) => row.textContent);

    expect(rows).toEqual([
      expect.stringContaining("Module 1"),
      expect.stringContaining("Characters/Teemo/Skins/Skin0"),
      expect.stringContaining("skinMeshProperties.selfIllumination0.37"),
      expect.stringContaining("+resourceMapTeemo_R: Characters/Jade/R …"),
      expect.stringContaining("Module 2data/characters/teemo/skins/skin0.bin"),
    ]);
  });

  it("goes to a key's row from its action and from Enter", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTree();

    await user.click(screen.getAllByRole("button", { name: "Go to row" })[0]!);
    const key = screen.getAllByRole("treeitem")[3]!;
    key.focus();
    await user.keyboard("{Enter}");

    expect(onOpen.mock.calls.map(([node]) => node.id)).toEqual([
      keyItemId("base", 0, 0, 0),
      keyItemId("base", 0, 0, 1),
    ]);
  });

  it("folds a module from the keyboard", async () => {
    const user = userEvent.setup();
    renderTree();

    screen.getAllByRole("treeitem")[0]!.focus();
    await user.keyboard("{ArrowLeft}");

    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
  });

  it("selects a revealed item and settles the request", () => {
    const onRevealed = vi.fn();
    renderTree({ reveal: { itemId: keyItemId("base", 0, 0, 1), token: 7 }, onRevealed });

    const selected = screen
      .getAllByRole("treeitem")
      .filter((row) => row.getAttribute("aria-selected") === "true");

    expect(selected.map((row) => row.textContent)).toEqual([
      expect.stringContaining("+resourceMap"),
    ]);
    expect(onRevealed).toHaveBeenCalledWith(7);
  });
});
