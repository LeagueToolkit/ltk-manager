import { describe, expect, it, vi } from "vitest";

import { createCheckpoints } from "../checkpoints";

/** A checkpoint as the set weighs one: the step it stands at, and what it holds. */
function held(step: number, bytes = 10) {
  return { step, bytes };
}

describe("createCheckpoints", () => {
  it("keeps one checkpoint per mark, and takes none at a mark already held", () => {
    const marks = createCheckpoints(8, 100);
    const capture = vi.fn(() => held(15));

    marks.keep(1, 10, capture);
    marks.keep(1, 10, capture);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(marks.latest(1, 15)).toEqual(held(15));
  });

  it("wants a mark in range that holds nothing, and no other", () => {
    const marks = createCheckpoints(8, 100);

    expect(marks.wants(0)).toBe(false);
    expect(marks.wants(9)).toBe(false);
    expect(marks.wants(3)).toBe(true);
    marks.keep(3, 10, () => held(45));
    expect(marks.wants(3)).toBe(false);
  });

  it("keeps no mark past the last one the run reaches", () => {
    const marks = createCheckpoints(8, 100);

    marks.keep(9, 10, () => held(135));

    expect(marks.bytes).toBe(0);
  });

  it("stands a seek on the latest checkpoint at or before it", () => {
    const marks = createCheckpoints(8, 100);
    marks.keep(1, 10, () => held(15));
    marks.keep(2, 10, () => held(30));

    expect(marks.latest(3, 44)?.step).toBe(30);
    expect(marks.latest(2, 29)?.step).toBe(15);
    expect(marks.latest(0, 10)).toBeNull();
  });

  it("paces the marks so the rest of the run fits the budget, and thins what it held", () => {
    const marks = createCheckpoints(8, 45);

    for (let at = 1; at <= 5; at += 1) marks.keep(at, 10, () => held(at * 15));
    expect(marks.bytes).toBe(30);
    expect(marks.latest(1, 15)).toBeNull();
    expect(marks.latest(3, 45)?.step).toBe(30);
    expect(marks.latest(5, 75)?.step).toBe(75);

    for (let at = 6; at <= 8; at += 1) marks.keep(at, 10, () => held(at * 15));
    expect(marks.bytes).toBe(40);
    expect(marks.latest(7, 105)?.step).toBe(90);
    expect(marks.latest(5, 75)?.step).toBe(60);
  });

  it("keeps a heavy stretch sparsely and a light one after it at every mark", () => {
    const marks = createCheckpoints(8, 100);
    const capture = vi.fn((at: number) => held(at * 15, at <= 4 ? 50 : 10));

    for (let at = 1; at <= 8; at += 1) marks.keep(at, at <= 4 ? 50 : 10, () => capture(at));

    expect(capture.mock.calls.map(([at]) => at)).toEqual([4, 5, 6, 7, 8]);
    expect(marks.bytes).toBe(90);
  });

  it("keeps nothing larger than the whole budget", () => {
    const marks = createCheckpoints(8, 5);

    marks.keep(1, 10, () => held(15, 10));

    expect(marks.bytes).toBe(0);
    expect(marks.latest(1, 15)).toBeNull();
  });

  it("keeps a later mark after one larger than the whole budget", () => {
    const marks = createCheckpoints(8, 25);

    marks.keep(4, 30, () => held(60, 30));
    marks.keep(6, 10, () => held(90));

    expect(marks.latest(4, 60)).toBeNull();
    expect(marks.latest(6, 90)?.step).toBe(90);
  });

  it("keeps every mark again once cleared", () => {
    const marks = createCheckpoints(8, 45);
    for (let at = 1; at <= 5; at += 1) marks.keep(at, 10, () => held(at * 15));

    marks.clear();
    marks.keep(2, 10, () => held(30));

    expect(marks.bytes).toBe(10);
    expect(marks.latest(2, 30)?.step).toBe(30);
  });
});
