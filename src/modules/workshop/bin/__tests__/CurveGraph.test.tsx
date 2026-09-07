// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { CurveGraph } from "../CurveGraph";
import type { CurveKey } from "../valueRows";

const SIDE = 100;

beforeAll(() => {
  /* The graph plots in pixels, which happy-dom runs no layout to answer. */
  for (const measured of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, measured, {
      configurable: true,
      get: () => SIDE,
    });
  }
});

const VECTOR: CurveKey[] = [
  { time: 0, values: [0, 5, 10] },
  { time: 1, values: [10, 5, 0] },
];

const COLOR: CurveKey[] = [
  { time: 0, values: [1, 0, 0, 1] },
  { time: 1, values: [0, 0, 1, 0] },
];

function draw(keys: CurveKey[], family: "scalar" | "vector" | "color") {
  return render(<CurveGraph keys={keys} family={family} />).container;
}

const strokes = (container: HTMLElement) =>
  [...container.querySelectorAll("polyline")].map(
    (line) => line.parentElement?.getAttribute("class") ?? "",
  );

describe("CurveGraph", () => {
  it("draws a line per channel of a vector, each in a hue of its own", () => {
    const drawn = strokes(draw(VECTOR, "vector"));

    expect(drawn).toEqual(["text-channel-1", "text-channel-2", "text-channel-3"]);
  });

  it("names each channel of a vector in the letters Riot labels them with", () => {
    draw(VECTOR, "vector");

    for (const axis of ["X", "Y", "Z"]) {
      expect(screen.getByRole("button", { name: axis })).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("mutes the channel a chip turns off", async () => {
    const container = draw(VECTOR, "vector");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Y" }));

    expect(strokes(container)).toEqual(["text-channel-1", "text-channel-3"]);
    expect(screen.getByRole("button", { name: "Y" })).toHaveAttribute("aria-pressed", "false");
  });

  it("draws a colour as its band, and no channel until a chip asks", async () => {
    const container = draw(COLOR, "color");
    const user = userEvent.setup();

    expect(screen.getByLabelText("2 colour stops")).toBeInTheDocument();
    expect(strokes(container)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "R" }));

    expect(strokes(container)).toEqual(["text-channel-1"]);
  });

  it("draws a scalar with no chips, because it has one channel to tell apart from none", () => {
    draw(
      [
        { time: 0, values: [1] },
        { time: 1, values: [2] },
      ],
      "scalar",
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
