// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import {
  EMPTY_OUTCOME,
  FAILED_OUTCOME,
  resetPreviewStills,
  retryPreviews,
  savePreviewOutcome,
  STILL_CAPACITY,
  usePinnedPreviews,
  usePreviewGeneration,
  usePreviewOutcomes,
} from "../previewStills";

afterEach(() => {
  cleanup();
  resetPreviewStills();
});

const image = (src: string) => ({ kind: "image", src }) as const;

it("keeps a still over a later failure and lets a still replace a failure", () => {
  const { result } = renderHook(() => usePreviewOutcomes());
  act(() => {
    savePreviewOutcome("a", image("first"));
    savePreviewOutcome("a", FAILED_OUTCOME);
    savePreviewOutcome("b", FAILED_OUTCOME);
    savePreviewOutcome("b", image("second"));
    savePreviewOutcome("c", EMPTY_OUTCOME);
  });
  expect(result.current.get("a")).toEqual(image("first"));
  expect(result.current.get("b")).toEqual(image("second"));
  expect(result.current.get("c")).toBe(EMPTY_OUTCOME);
});

it("never evicts a still a grid shows, however many are on screen", () => {
  const shown = Array.from({ length: STILL_CAPACITY + 2 }, (_, index) => `shown ${index}`);
  renderHook(() => usePinnedPreviews(new Set(shown)));
  const { result } = renderHook(() => usePreviewOutcomes());
  act(() => {
    savePreviewOutcome("offscreen", image("old"));
    for (const key of shown) savePreviewOutcome(key, image(key));
  });
  expect(result.current.has("offscreen")).toBe(false);
  expect(shown.every((key) => result.current.has(key))).toBe(true);
});

it("forgets failures on retry, keeping stills and empties, and starts a new generation", () => {
  const outcomes = renderHook(() => usePreviewOutcomes());
  const generation = renderHook(() => usePreviewGeneration());
  act(() => {
    savePreviewOutcome("a", image("still"));
    savePreviewOutcome("b", FAILED_OUTCOME);
    savePreviewOutcome("c", EMPTY_OUTCOME);
    savePreviewOutcome("d", FAILED_OUTCOME);
  });
  act(() => retryPreviews(["b"]));
  expect([...outcomes.result.current.keys()]).toEqual(["a", "c", "d"]);
  act(() => retryPreviews());
  expect([...outcomes.result.current.keys()]).toEqual(["a", "c"]);
  expect(generation.result.current).toBe(2);
});
