import { expect, it, vi } from "vitest";

import { createPreviewWarmup } from "../previewWarmup";

it("holds the first visible burst instead of stepping past a short effect", () => {
  let steps = 0;
  const warmup = createPreviewWarmup(
    () => {
      steps += 1;
    },
    { seconds: 0.8, now: () => 0, hasContent: () => steps === 2 },
  );
  warmup.run();
  expect(warmup.ready).toBe(true);
  expect(warmup.found).toBe(true);
  expect(steps).toBe(2);
});

it("samples 0.8 seconds in three inexpensive frames instead of waiting for wall time", () => {
  const advance = vi.fn();
  const warmup = createPreviewWarmup(advance, { seconds: 0.8, now: () => 0 });
  warmup.run();
  expect(advance).toHaveBeenCalledTimes(8);
  expect(warmup.ready).toBe(false);
  warmup.run();
  warmup.run();
  expect(warmup.ready).toBe(true);
  expect(warmup.found).toBe(false);
  expect(advance).toHaveBeenCalledTimes(24);
  expect(advance.mock.calls.reduce((sum, [seconds]) => sum + seconds, 0)).toBeCloseTo(0.8);
  warmup.run();
  expect(advance).toHaveBeenCalledTimes(24);
});

it("ends a system that draws nothing once its sample is spent", () => {
  const warmup = createPreviewWarmup(() => {}, { seconds: 2, now: () => 0 });
  for (let frame = 0; frame < 8; frame += 1) warmup.run();
  expect(warmup.ready).toBe(true);
  expect(warmup.found).toBe(false);
});

it("yields after an expensive simulation step consumes the frame budget", () => {
  let time = 0;
  const advance = vi.fn(() => {
    time += 3;
  });
  const warmup = createPreviewWarmup(advance, { seconds: 0.8, now: () => time });
  warmup.run();
  expect(advance).toHaveBeenCalledOnce();
  expect(warmup.ready).toBe(false);
});
