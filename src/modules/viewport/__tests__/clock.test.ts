import { describe, expect, it } from "vitest";

import { createSceneClock } from "../clock";

describe("createSceneClock", () => {
  it("stands at zero, and adds what each frame spends", () => {
    const clock = createSceneClock();
    clock.advance(0.25);
    clock.advance(0.5);

    expect(clock.time).toBe(0.75);
    expect(clock.generation).toBe(0);
  });

  it("counts a seek as a jump, where an advance is none", () => {
    const clock = createSceneClock();
    clock.advance(1);

    clock.seek(0.4);

    expect(clock.time).toBe(0.4);
    expect(clock.generation).toBe(1);
  });

  it("starts over at zero as a jump of its own", () => {
    const clock = createSceneClock();
    clock.advance(3);

    clock.restart();

    expect(clock.time).toBe(0);
    expect(clock.generation).toBe(1);
  });

  it("never stands before zero", () => {
    const clock = createSceneClock();

    clock.seek(-2);

    expect(clock.time).toBe(0);
  });
});
