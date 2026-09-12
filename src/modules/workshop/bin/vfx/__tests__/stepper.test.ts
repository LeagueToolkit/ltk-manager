import { describe, expect, it } from "vitest";

import { fixedRateStepper, MAX_STEPS, variableStepper } from "../stepper";

describe("variableStepper", () => {
  it("yields one step per frame, as long as the frame was", () => {
    const stepper = variableStepper();

    expect(stepper.advance(0.016)).toEqual([{ dt: 0.016, now: 0.016 }]);

    const [second] = stepper.advance(0.25);
    expect(second?.dt).toBe(0.25);
    expect(second?.now).toBeCloseTo(0.266, 10);
  });

  it("yields nothing for a frame that took no time", () => {
    const stepper = variableStepper();

    expect(stepper.advance(0)).toEqual([]);
    expect(stepper.now).toBe(0);
  });

  it("starts where the caller puts it", () => {
    const stepper = variableStepper(10);

    expect(stepper.advance(1)).toEqual([{ dt: 1, now: 11 }]);
  });

  it("puts the clock back on a reset", () => {
    const stepper = variableStepper();
    stepper.advance(5);
    stepper.reset();

    expect(stepper.now).toBe(0);
    expect(stepper.advance(1)).toEqual([{ dt: 1, now: 1 }]);
  });
});

describe("fixedRateStepper", () => {
  it("spends a frame in whole steps of the authored period", () => {
    const stepper = fixedRateStepper(10);
    const steps = stepper.advance(0.3);

    expect(steps.map((step) => step.dt)).toEqual([0.1, 0.1, 0.1]);
    expect(stepper.now).toBeCloseTo(0.3, 10);
  });

  it("banks a partial step and spends it on a later frame", () => {
    const stepper = fixedRateStepper(10);

    expect(stepper.advance(0.06)).toEqual([]);
    expect(stepper.advance(0.06)).toHaveLength(1);
    expect(stepper.now).toBeCloseTo(0.1, 10);
  });

  it("carries a remainder rather than losing it, so the rate holds over many frames", () => {
    const stepper = fixedRateStepper(60);
    let count = 0;
    for (let frame = 0; frame < 100; frame += 1) count += stepper.advance(1 / 100).length;

    expect(count).toBe(60);
  });

  it("caps the steps one frame runs, doubling the length of each instead", () => {
    const stepper = fixedRateStepper(60);
    const steps = stepper.advance(10);

    expect(steps.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(steps[0]?.dt).toBeGreaterThan(1 / 60);
    expect(stepper.now).toBeGreaterThan(8);
  });

  it("drains a backlog rather than dropping it", () => {
    const stepper = fixedRateStepper(60);
    stepper.advance(10);
    const drained = stepper.advance(0);

    expect(drained.length).toBeGreaterThan(0);
    expect(drained.length).toBeLessThanOrEqual(MAX_STEPS);
  });

  it("ends each step at the time the step ran to", () => {
    const stepper = fixedRateStepper(4, 100);
    const steps = stepper.advance(0.5);

    expect(steps.map((step) => step.now)).toEqual([100.25, 100.5]);
  });

  it("drops the bank on a reset", () => {
    const stepper = fixedRateStepper(10);
    stepper.advance(0.09);
    stepper.reset(2);

    expect(stepper.now).toBe(2);
    expect(stepper.advance(0.05)).toEqual([]);
  });
});
