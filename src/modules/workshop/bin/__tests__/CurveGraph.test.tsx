// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { CurveGraph } from "../CurveGraph";
import { randomDraw } from "../randomDraw";
import type { CurveKey, ProbabilityTable, ValueMark } from "../valueRows";

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

/** A vector whose X draws a uniform 0 to 360 over its base, and whose Y and Z are filler. */
function randomX(keys: CurveKey[]): ValueMark {
  const table = (channel: number, points: [number, number][]): ProbabilityTable => ({
    channel,
    single: 1,
    keys: points.map(([time, value]) => ({ time, values: [value] })),
  });
  return {
    family: "vector",
    constant: { type: "vector", values: [1, 0, 0] },
    keys,
    tables: [
      table(0, [
        [0, 0],
        [1, 360],
      ]),
      table(1, []),
      table(2, []),
    ],
    curve: true,
    slots: 3,
  };
}

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

  it("draws no line for a channel the toolbar muted", () => {
    const { container } = render(<CurveGraph keys={VECTOR} family="vector" muted={new Set([1])} />);

    expect(strokes(container)).toEqual(["text-channel-1", "text-channel-3"]);
  });

  it("draws a random value whose base holds still as lanes, with no time plot", () => {
    const { container } = render(
      <CurveGraph keys={[]} family="vector" draw={randomDraw(randomX([]))} unit="degrees" />,
    );

    expect(screen.getByRole("slider", { name: "Pin the chance on X" })).toBeInTheDocument();
    expect(screen.getByText("0 .. 360")).toBeInTheDocument();
    expect(container.querySelector('[data-ui="ChannelPlot"]')).toBeNull();
  });

  it("draws an animated random value over time, with the births at one time beside it", () => {
    const { container } = render(
      <CurveGraph keys={VECTOR} family="vector" draw={randomDraw(randomX(VECTOR))} />,
    );

    const plot = container.querySelector('[data-ui="ChannelPlot"] svg');
    expect(plot?.querySelectorAll("polyline")).toHaveLength(3);
    expect(screen.getByText("births")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "How often each value is drawn" })).toHaveLength(1);
    expect(screen.getByText("uniform")).toBeInTheDocument();
  });

  it("names the unit by the top value tick, and ticks time at its quarters", () => {
    render(<CurveGraph keys={VECTOR} family="vector" unit="rate" />);

    expect(screen.getByText("/s")).toBeInTheDocument();
    expect(screen.getByText("0.25")).toBeInTheDocument();
  });

  it("draws a colour as its ramp alone, with no line and no channel chip", () => {
    const container = draw(COLOR, "color");

    expect(screen.getByLabelText("2 colour stops")).toBeInTheDocument();
    expect(strokes(container)).toEqual([]);
    for (const channel of ["R", "G", "B", "A"]) {
      expect(screen.queryByRole("button", { name: channel })).toBeNull();
    }
  });

  it("puts a handle on the axis at each stop's own time", () => {
    draw(
      [
        { time: 0.25, values: [1, 0, 0, 1] },
        { time: 0.75, values: [0, 0, 1, 0] },
      ],
      "color",
    );

    const first = screen.getByRole("button", { name: "Colour stop at 0.250, #FF0000FF" });
    const last = screen.getByRole("button", { name: "Colour stop at 0.750, #0000FF00" });

    expect(first).toHaveStyle({ left: "25.00%" });
    expect(last).toHaveStyle({ left: "75.00%" });
  });

  it("draws the keys under the ramp, so the numbers need no tab of their own", () => {
    draw(COLOR, "color");

    expect(screen.getByText("#FF0000FF")).toBeInTheDocument();
    expect(screen.getByText("#0000FF00")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("opens on the first stop, and moves the selection a handle or a row picks", async () => {
    draw(COLOR, "color");
    const user = userEvent.setup();

    const rowOf = (at: number) => screen.getAllByRole("row")[at]!;
    expect(rowOf(1)).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Colour stop at 1.000, #0000FF00" }));
    expect(rowOf(2)).toHaveAttribute("aria-selected", "true");

    await user.click(rowOf(1));
    expect(rowOf(1)).toHaveAttribute("aria-selected", "true");
  });

  it("offers neither handle nor readout for a family that is no colour", () => {
    draw(VECTOR, "vector");

    expect(screen.queryByLabelText(/Colour stop at/)).toBeNull();
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
