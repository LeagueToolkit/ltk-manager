// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { ProbabilityPlot } from "../ProbabilityPlot";
import type { ProbabilityTable } from "../valueRows";

const SIDE = 100;

beforeAll(() => {
  /* The plot is placed in pixels, which happy-dom runs no layout to answer. */
  for (const measured of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, measured, {
      configurable: true,
      get: () => SIDE,
    });
  }
});

const KEYED: ProbabilityTable = {
  channel: 0,
  single: 1,
  keys: [
    { time: 0, values: [0.1] },
    { time: 1, values: [0.9] },
  ],
};

const SINGLE: ProbabilityTable = { channel: 2, single: 0.25, keys: [] };

describe("ProbabilityPlot", () => {
  it("plots the table of the channel it opens on", () => {
    render(<ProbabilityPlot tables={[KEYED, SINGLE]} family="color" />);

    expect(screen.getByLabelText("2 probability keys")).toBeInTheDocument();
  });

  it("offers a chip per channel the file wrote a table for, and no other", () => {
    render(<ProbabilityPlot tables={[KEYED, SINGLE]} family="color" />);

    expect(screen.getByRole("button", { name: "R" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "G" })).toBeNull();
  });

  it("draws a table's single value in place of a plot of no keys", async () => {
    render(<ProbabilityPlot tables={[KEYED, SINGLE]} family="color" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "B" }));

    expect(screen.getByText("0.25")).toBeInTheDocument();
    expect(screen.getByText("B single value")).toBeInTheDocument();
    expect(screen.queryByLabelText(/probability key/)).toBeNull();
  });

  it("says so for a curve whose channels carry no table at all", () => {
    render(<ProbabilityPlot tables={[]} family="scalar" />);

    expect(screen.getByText("No probability table")).toBeInTheDocument();
  });
});
