// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DeclarationsLayer, DeclaredModule } from "@/lib/tauri";

import type { OutlineActions } from "../../hooks/useOutlineActions";
import { keyItemId, type OutlineShape } from "../../utils/outlineTree";
import { DeclarationsTree } from "../DeclarationsTree";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: (index: number) => number;
  }) => {
    const sizes = Array.from({ length: count }, (_, index) => estimateSize(index));
    const starts = sizes.map((_, index) => sizes.slice(0, index).reduce((a, b) => a + b, 0));

    return {
      measure: () => {},
      scrollToIndex: () => {},
      getTotalSize: () => sizes.reduce((a, b) => a + b, 0),
      getVirtualItems: () =>
        sizes.map((size, index) => ({ key: index, index, start: starts[index]!, size })),
    };
  },
}));

const SPAN = { line: 1, column: 1, endLine: 1, endColumn: 2 };

const ENTRIES: DeclaredModule = {
  index: 0,
  name: null,
  note: null,
  selector: "entries",
  target: null,
  targetHash: null,
  source: null,
  overrides: [],
  links: { add: [], remove: [] },
  span: SPAN,
  entries: [
    {
      name: "Characters/Teemo/Skins/Skin0",
      knownName: null,
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
      links: { add: [], remove: [] },
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

const SHAPE: OutlineShape = { layers: false, keys: true, adds: false };

function actions(): OutlineActions {
  return {
    create: vi.fn(() => Promise.resolve(null)),
    moveToNewModule: vi.fn(() => Promise.resolve(null)),
    rename: vi.fn(),
    move: vi.fn(() => Promise.resolve(null)),
    remove: vi.fn(),
    moveKeys: vi.fn(),
    toggleWriteHere: vi.fn(),
    writesHere: () => false,
  };
}

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
      expect.stringContaining(
        "+resourceMap{Teemo_R: Characters/Jade/R, Teemo_Q: Characters/Jade/Q}",
      ),
      expect.stringContaining("Module 2skin0.bin"),
      expect.stringContaining("Drag entries here"),
    ]);
  });

  it("goes to a key's row from its action and from Enter", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTree();

    /* The entry's own action comes first. */
    await user.click(screen.getAllByRole("button", { name: "Go to row" })[1]!);
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

    /* The second module, and the line saying it declares nothing. */
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
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

  it("draws a module with what it edits, the comment above it and a tally", () => {
    const noted = { ...TARGET, name: "Jade outline", note: "Outline on the base skin." };
    renderTree({ layers: [{ ...LAYER, modules: [ENTRIES, noted] }] });

    const module = screen.getAllByRole("treeitem").at(-2)!;

    expect(module.textContent).toContain("Jade outline");
    expect(module.textContent).toContain("skin0.bin");
    expect(module.textContent).toContain("Outline on the base skin.");
    expect(screen.getAllByRole("treeitem")[0]!.textContent).toContain("1 object · 2 keys");
  });

  it("offers no Go to row under an object the module creates", () => {
    const entry = ENTRIES.entries[0]!;
    const created: DeclaredModule = {
      ...TARGET,
      entries: [
        {
          ...entry,
          name: "Mods/jade/Outline",
          object: { kind: "construct", class: "StaticMaterialDef", knownClass: null },
        },
      ],
    };
    renderTree({ layers: [{ ...LAYER, modules: [created] }] });

    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(screen.queryAllByRole("button", { name: "Go to row" })).toHaveLength(0);
  });

  it("renames a module in place from F2", async () => {
    const user = userEvent.setup();
    const held = actions();
    renderTree({ actions: held });

    screen.getAllByRole("treeitem")[0]!.focus();
    await user.keyboard("{F2}");
    await user.keyboard("Base look{Enter}");

    expect(held.rename).toHaveBeenCalledWith("base", ENTRIES, "Base look");
  });

  it("moves a module down from Alt+ArrowDown", async () => {
    const user = userEvent.setup();
    const held = actions();
    renderTree({ actions: held });

    screen.getAllByRole("treeitem")[0]!.focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(held.move).toHaveBeenCalledWith("base", ENTRIES, 1);
  });

  it("adds a module from the New module line", async () => {
    const user = userEvent.setup();
    const held = actions();
    renderTree({ shape: { ...SHAPE, adds: true }, actions: held });

    await user.click(screen.getByText("New module"));

    expect(held.create).toHaveBeenCalledWith("base");
  });

  it("says what a module that declares nothing takes", () => {
    const empty: DeclaredModule = { ...ENTRIES, name: "Particles", entries: [] };
    renderTree({ layers: [{ ...LAYER, modules: [empty] }] });

    expect(screen.getAllByRole("treeitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Particles"),
      expect.stringContaining("Drag entries here"),
    ]);
  });
});
