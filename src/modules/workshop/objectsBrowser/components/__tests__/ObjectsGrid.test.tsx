// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { nameHash } from "../../../bin/shared/utils/binHash";
import {
  EMPTY_OUTCOME,
  FAILED_OUTCOME,
  type PreviewOutcome,
  resetPreviewStills,
  retryPreviews,
} from "../../state/previewStills";
import type { ObjectRowNode } from "../../utils/objectTree";
import { ObjectPreviewPool } from "../ObjectPreviewPool";
import { ObjectsGrid } from "../ObjectsGrid";

const state = vi.hoisted(() => ({
  reduced: false,
  visible: true,
  row: 0,
  width: 180,
  reports: new Map<string, (outcome: PreviewOutcome) => void>(),
  open: vi.fn(),
  virtualizer: {
    isScrolling: false,
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
    getTotalSize: () => 472,
    getVirtualItems: (): { index: number; key: number; start: number }[] => [],
  },
}));

vi.mock("@/hooks", async (original) => ({
  ...(await original<typeof import("@/hooks")>()),
  useContentVisible: () => state.visible,
  useReducedMotion: () => state.reduced,
  useZoomedPx: () => (value: number) => value,
}));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: () => state.virtualizer }));
vi.mock("../../../explorer/components/ExplorerSurface", () => ({
  useMeasuredWidth: () => state.width,
}));
vi.mock("../../../bin/documents/hooks/useBinDocument", () => ({
  useBinDocument: () => ({ state: { status: "opening" }, reopen: vi.fn() }),
}));
vi.mock("../../hooks/useOpenObjectNode", () => ({ useOpenObjectNode: () => state.open }));
vi.mock("../ObjectsContextMenu", () => ({ ObjectsContextMenu: () => null }));
vi.mock("../ObjectPreviewWorker", () => ({
  default: ({
    node,
    playing,
    onOutcome,
  }: {
    node: ObjectRowNode | null;
    playing: boolean;
    onOutcome: (outcome: PreviewOutcome) => void;
  }) => {
    if (node === null) return null;
    state.reports.set(node.name, onOutcome);
    return (
      <output data-testid="worker" data-playing={String(playing)}>
        {node.name}
      </output>
    );
  },
}));

function node(name: string): ObjectRowNode {
  return {
    type: "object",
    id: name,
    path: name,
    name,
    objectHash: name,
    unnamed: false,
    layers: [],
    count: 0,
    children: [],
    declarations: [
      {
        asset: { kind: "gameChunk", wad: "test.wad.client", pathHash: name },
        file: "test.bin",
        class: "VfxSystemDefinitionData",
        classHash: nameHash("VfxSystemDefinitionData"),
      },
    ],
  };
}

const nodes = [node("First effect"), node("Second effect")];
const noop = () => {};

function grid({
  thumbnails = true,
  gridKey,
  ...props
}: Partial<ComponentProps<typeof ObjectsGrid>> & { gridKey?: string } = {}) {
  return (
    <ObjectPreviewPool mounted={thumbnails} active>
      <ObjectsGrid
        key={gridKey}
        nodes={nodes}
        thumbnails={thumbnails}
        onDescend={noop}
        onUp={noop}
        {...props}
      />
    </ObjectPreviewPool>
  );
}

const still = (name: string): PreviewOutcome => ({
  kind: "image",
  src: `data:image/webp;base64,${name}`,
});
const tileOf = (name: string) =>
  screen.getByRole("button", { name: `${name} VfxSystemDefinitionData` });
const workers = () => screen.queryAllByTestId("worker").map((worker) => worker.textContent);

function report(name: string, outcome: PreviewOutcome) {
  act(() => state.reports.get(name)!(outcome));
}

async function wait(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  state.row = 0;
  state.visible = true;
  state.reduced = false;
  state.width = 180;
  state.reports.clear();
  state.virtualizer.isScrolling = false;
  state.virtualizer.getVirtualItems = () => [
    { index: state.row, key: state.row, start: state.row * 236 },
  ];
});

afterEach(() => {
  cleanup();
  resetPreviewStills();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("does no rendering until thumbnails are requested and releases the worker when disabled", async () => {
  const { rerender } = render(grid({ thumbnails: false }));
  expect(workers()).toEqual([]);

  rerender(grid());
  await wait();
  expect(workers()).toEqual(["First effect"]);
  report("First effect", still("first"));
  expect(workers()).toEqual([]);
  expect(tileOf("First effect").querySelector("img")).not.toBeNull();

  rerender(grid({ thumbnails: false }));
  expect(workers()).toEqual([]);
});

it("discards obsolete captures after scrolling and queues only the visible row", async () => {
  const { rerender } = render(grid());
  await wait();
  const obsolete = state.reports.get("First effect")!;

  state.row = 1;
  rerender(grid());
  expect(workers()).toEqual(["Second effect"]);
  act(() => obsolete(still("obsolete")));
  expect(workers()).toEqual(["Second effect"]);

  state.row = 0;
  rerender(grid());
  expect(workers()).toEqual(["First effect"]);
});

it("keeps stills across a remounted grid, as a folder change or a search does", async () => {
  const { rerender } = render(grid({ gridKey: "first" }));
  await wait();
  report("First effect", still("first"));

  rerender(grid({ gridKey: "second" }));
  await wait();
  expect(workers()).toEqual([]);
  expect(tileOf("First effect").querySelector("img")).toHaveAttribute(
    "src",
    "data:image/webp;base64,first",
  );
});

it("plays a hovered tile in place after a dwell, and not for focus or reduced motion", async () => {
  const { rerender } = render(grid());
  await wait();
  report("First effect", still("first"));
  const tile = tileOf("First effect");

  fireEvent.focus(tile);
  await wait(400);
  expect(workers()).toEqual([]);

  fireEvent.pointerOver(tile);
  await wait(399);
  expect(workers()).toEqual([]);
  await wait(1);
  const worker = screen.getByTestId("worker");
  expect(tile.contains(worker)).toBe(true);
  expect(worker).toHaveAttribute("data-playing", "true");
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.pointerLeave(screen.getByRole("grid"));
  expect(workers()).toEqual([]);

  fireEvent.pointerOver(tile);
  state.reduced = true;
  rerender(grid());
  await wait(400);
  expect(workers()).toEqual([]);
});

it("opens the focused tile in the large popover with Space and closes it with Escape", async () => {
  render(grid());
  await wait();
  report("First effect", still("first"));
  const tile = tileOf("First effect");

  fireEvent.focus(tile);
  fireEvent.keyDown(tile, { key: " " });
  await wait();
  const popup = screen.getByRole("dialog", { name: "First effect" });
  expect(popup).toHaveClass("w-96");
  expect(popup.contains(screen.getByTestId("worker"))).toBe(true);
  expect(state.open).not.toHaveBeenCalled();

  fireEvent.keyDown(popup, { key: "Escape" });
  await wait(300);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(workers()).toEqual([]);
});

it("scrolls and focuses a revealed tile without opening it, including a repeated reveal", async () => {
  state.width = 300;
  const settled = vi.fn();
  const { rerender } = render(
    grid({ thumbnails: false, reveal: { path: nodes[1]!.id, token: 1 }, onRevealed: settled }),
  );
  await wait(40);
  const tile = tileOf("Second effect");
  expect(tile).toHaveFocus();
  expect(settled).toHaveBeenCalledWith(1);
  expect(state.open).not.toHaveBeenCalled();

  rerender(
    grid({ thumbnails: false, reveal: { path: nodes[1]!.id, token: 2 }, onRevealed: settled }),
  );
  await wait(40);
  expect(settled).toHaveBeenLastCalledWith(2);
  expect(tile).toHaveFocus();
});

it("retries a failed still when its tile is hovered", async () => {
  render(grid());
  await wait();
  report("First effect", FAILED_OUTCOME);
  const tile = tileOf("First effect");
  expect(tile).toHaveAttribute("aria-description", "Preview unavailable");

  fireEvent.pointerOver(tile);
  await wait(400);
  expect(workers()).toEqual(["First effect"]);
  report("First effect", still("recovered"));
  expect(tile.querySelector("img")).toHaveAttribute("src", "data:image/webp;base64,recovered");
});

it("settles an unanswered preview once and keeps opening the object available", async () => {
  render(grid());
  await wait();
  await wait(15_000);
  expect(workers()).toEqual([]);

  fireEvent.click(tileOf("First effect"));
  expect(state.open).toHaveBeenCalledWith(nodes[0], "default");
});

it("loads two previews concurrently and keeps the unfinished slot when another completes", async () => {
  state.width = 600;
  const many = [...nodes, node("Third effect"), node("Fourth effect")];
  render(grid({ nodes: many }));
  await wait();
  expect(workers()).toEqual(["First effect", "Second effect"]);
  const second = screen.getAllByTestId("worker")[1];

  report("First effect", still("first"));
  expect(workers()).toEqual(["Third effect", "Second effect"]);
  expect(screen.getAllByTestId("worker")[1]).toBe(second);
});

it("starts no still during a scroll and resumes once it settles", async () => {
  state.width = 600;
  state.virtualizer.isScrolling = true;
  const many = [...nodes, node("Third effect")];
  const { rerender } = render(grid({ nodes: many }));
  await wait();
  expect(workers()).toEqual([]);

  state.virtualizer.isScrolling = false;
  rerender(grid({ nodes: many }));
  await wait();
  expect(workers()).toEqual(["First effect", "Second effect"]);
});

it("retries failed previews without discarding completed stills", async () => {
  state.width = 300;
  render(grid());
  await wait();
  report("First effect", FAILED_OUTCOME);
  report("Second effect", still("second"));

  act(() => retryPreviews());
  await wait();
  expect(workers()).toEqual(["First effect"]);
  expect(tileOf("Second effect").querySelector("img")).not.toBeNull();
});

it("marks an object with nothing to draw without a failure, and a retry leaves it", async () => {
  render(grid());
  await wait();
  report("First effect", EMPTY_OUTCOME);
  expect(tileOf("First effect")).toHaveAttribute("aria-description", "Nothing to preview");

  act(() => retryPreviews());
  await wait();
  expect(workers()).toEqual([]);
});

it("keeps child navigation separate from opening an object and sizes tiles to the setting", () => {
  const descend = vi.fn();
  const parent = { ...nodes[0]!, count: 12 };
  render(grid({ nodes: [parent], thumbnails: false, onDescend: descend }));
  fireEvent.click(screen.getByRole("button", { name: "Browse 12 children" }));
  expect(descend).toHaveBeenCalledWith(parent.id);
  expect(state.open).not.toHaveBeenCalled();
  expect(screen.getByRole("gridcell")).toHaveStyle({ width: "128px" });
  expect(
    screen
      .getByRole("button", { name: "Browse 12 children" })
      .closest("button")
      ?.parentElement?.closest("button"),
  ).toBeNull();
});
