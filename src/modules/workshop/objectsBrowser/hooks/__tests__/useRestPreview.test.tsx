// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { nameHash } from "../../../bin/shared/utils/binHash";
import { objectDocumentId } from "../../../documents/utils/contentDocument";
import type { ObjectRowNode } from "../../utils/objectTree";
import { REST_PREVIEW_MS, useRestPreview } from "../useRestPreview";

const state = vi.hoisted(() => ({ preview: vi.fn(), reveal: vi.fn() }));

vi.mock("../../../state", async (original) => ({
  ...(await original<typeof import("../../../state")>()),
  useOpenRowPreview: () => state.preview,
  useRequestObjectsReveal: () => state.reveal,
}));

function node(name: string, className = "VfxSystemDefinitionData"): ObjectRowNode {
  return {
    type: "object",
    id: `Effects/${name}`,
    path: `Effects/${name}`,
    name,
    objectHash: `0x${name.length.toString(16).padStart(8, "0")}`,
    unnamed: false,
    layers: [],
    count: 0,
    children: [],
    declarations: [
      {
        asset: { kind: "gameChunk", wad: "test.wad.client", pathHash: "00aa" },
        file: "test.bin",
        class: className,
        classHash: nameHash(className),
      },
    ],
  };
}

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return { current: element };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("opens the preview tab of a particle system the selection rests on", () => {
  const { result } = renderHook(() => useRestPreview(host()));
  const system = node("Burst");

  act(() => result.current(system));
  act(() => vi.advanceTimersByTime(REST_PREVIEW_MS - 1));
  expect(state.preview).not.toHaveBeenCalled();

  act(() => vi.advanceTimersByTime(1));
  expect(state.preview).toHaveBeenCalledOnce();
  expect(state.preview.mock.calls[0]![0]).toMatchObject({
    kind: "object",
    id: objectDocumentId(system.declarations[0]!.asset, system.objectHash),
  });
});

it("opens only where the selection rests, and nothing for another kind of object", () => {
  const { result } = renderHook(() => useRestPreview(host()));

  act(() => result.current(node("Passed")));
  act(() => vi.advanceTimersByTime(REST_PREVIEW_MS / 2));
  act(() => result.current(node("Skin", "SkinCharacterDataProperties")));
  act(() => vi.advanceTimersByTime(REST_PREVIEW_MS * 2));
  expect(state.preview).not.toHaveBeenCalled();

  act(() => result.current(node("Passed")));
  act(() => result.current(node("Rested on")));
  act(() => vi.advanceTimersByTime(REST_PREVIEW_MS));
  expect(state.preview).toHaveBeenCalledOnce();
  expect(state.preview.mock.calls[0]![0]).toMatchObject({ objectPath: "Effects/Rested on" });
});

it("reveals the node again when the open remounts the browser", () => {
  const browser = host();
  const { result } = renderHook(() => useRestPreview(browser));
  state.preview.mockImplementation(() => browser.current.remove());

  act(() => result.current(node("Burst")));
  act(() => vi.advanceTimersByTime(REST_PREVIEW_MS + 20));
  expect(state.reveal).toHaveBeenCalledWith("Effects/Burst");
});

it("cancels a pending open when the browser unmounts", () => {
  const { result, unmount } = renderHook(() => useRestPreview(host()));

  act(() => result.current(node("Burst")));
  unmount();
  vi.advanceTimersByTime(REST_PREVIEW_MS);
  expect(state.preview).not.toHaveBeenCalled();
});
