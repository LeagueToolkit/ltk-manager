// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "../Sparkline";
import type { CurveKey } from "../valueRows";

function lines(keys: readonly CurveKey[]): string[] {
  const { container } = render(<Sparkline keys={keys} label="curve" />);
  return [...container.querySelectorAll("polyline")].map(
    (line) => line.getAttribute("points") ?? "",
  );
}

describe("Sparkline", () => {
  it("draws a line per channel, over the window the keys widen to", () => {
    expect(
      lines([
        { time: 2, values: [0, 10] },
        { time: 4, values: [10, 0] },
      ]),
    ).toEqual(["0.00,14.00 20.00,14.00 40.00,0.00", "0.00,0.00 20.00,0.00 40.00,14.00"]);
  });

  it("draws a curve that never moves down the middle", () => {
    expect(
      lines([
        { time: 0, values: [5] },
        { time: 1, values: [5] },
      ]),
    ).toEqual(["0.00,7.00 40.00,7.00"]);
  });

  it("stacks keys that share one time at the time they share", () => {
    expect(
      lines([
        { time: 1, values: [0] },
        { time: 1, values: [1] },
        { time: 1, values: [2] },
      ]),
    ).toEqual(["0.00,14.00 40.00,14.00 40.00,7.00 40.00,0.00"]);
  });

  it("draws a curve of one key flat, since it animates to nothing", () => {
    expect(lines([{ time: 0, values: [1] }])).toEqual(["0.00,7.00 40.00,7.00"]);
  });

  it("draws nothing at all for a value the read answered no keys for", () => {
    expect(lines([])).toEqual([]);
  });
});
