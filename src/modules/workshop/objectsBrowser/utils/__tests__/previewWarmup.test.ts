import { expect, it, vi } from "vitest";

import { createPreviewWarmup, GROWN_AT, SETTLE_SECONDS } from "../previewWarmup";

it("stops at once on a burst already grown instead of stepping past a short effect", () => {
  let steps = 0;
  const warmup = createPreviewWarmup(
    () => {
      steps += 1;
    },
    { seconds: 0.8, now: () => 0, oldest: () => (steps >= 2 ? 1 : null) },
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

it("settles a newborn burst until its oldest particle is a third through its life", () => {
  let elapsed = 0;
  const born = 0.1;
  const lifetime = 0.5;
  const warmup = createPreviewWarmup(
    (seconds) => {
      elapsed += seconds;
    },
    {
      seconds: 2,
      now: () => 0,
      oldest: () => (elapsed < born ? null : (elapsed - born) / lifetime),
    },
  );

  while (!warmup.ready) warmup.run();
  expect(warmup.found).toBe(true);
  expect((elapsed - born) / lifetime).toBeGreaterThanOrEqual(GROWN_AT);
  expect(elapsed - born).toBeLessThan(GROWN_AT * lifetime + 1 / 30);
});

it("caps the settle for a long-lived burst, however young its particles still are", () => {
  let elapsed = 0;
  const warmup = createPreviewWarmup(
    (seconds) => {
      elapsed += seconds;
    },
    { seconds: 2, now: () => 0, oldest: () => (elapsed < 0.2 ? null : 0) },
  );

  while (!warmup.ready) warmup.run();
  expect(warmup.found).toBe(true);
  expect(elapsed).toBeCloseTo(0.2 + SETTLE_SECONDS, 1);
});

it("ends the settle when every drawn particle has died", () => {
  let steps = 0;
  const warmup = createPreviewWarmup(
    () => {
      steps += 1;
    },
    { seconds: 2, now: () => 0, oldest: () => (steps === 3 ? 0 : null) },
  );

  warmup.run();
  expect(warmup.ready).toBe(true);
  expect(warmup.found).toBe(true);
  expect(steps).toBe(4);
});
