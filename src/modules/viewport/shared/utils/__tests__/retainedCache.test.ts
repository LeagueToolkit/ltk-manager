import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRetainedCache } from "../retainedCache";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("hands every asker of one key the same value", () => {
  const cache = createRetainedCache<string, object>(() => {});
  const first = cache.get("map11", () => ({}));

  expect(cache.get("map11", () => ({}))).toBe(first);
});

it("keeps a released value through the grace period for the view taking over", () => {
  const dispose = vi.fn();
  const cache = createRetainedCache<string, object>(dispose);
  const value = cache.get("map11", () => ({}));
  const release = cache.hold("map11");

  release();
  vi.advanceTimersByTime(1_000);
  const next = cache.get("map11", () => ({}));
  cache.hold("map11");
  vi.advanceTimersByTime(60_000);

  expect(next).toBe(value);
  expect(dispose).not.toHaveBeenCalled();
});

it("disposes a value once nothing has held it for the grace period", () => {
  const dispose = vi.fn();
  const cache = createRetainedCache<string, object>(dispose);
  const value = cache.get("map11", () => ({}));
  const release = cache.hold("map11");

  release();
  release();
  vi.advanceTimersByTime(60_000);

  expect(dispose).toHaveBeenCalledExactlyOnceWith(value);
  expect(cache.get("map11", () => ({}))).not.toBe(value);
});

it("disposes a value a thrown-away render asked for and nothing held", () => {
  const dispose = vi.fn();
  const cache = createRetainedCache<string, object>(dispose);
  cache.get("map11", () => ({}));

  vi.advanceTimersByTime(60_000);

  expect(dispose).toHaveBeenCalledOnce();
});
