// @vitest-environment happy-dom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeyTable } from "../KeyTable";
import type { CurveKey } from "../valueRows";

const VECTOR: CurveKey[] = [
  { time: 0, values: [0, 5, 10] },
  { time: 1, values: [10, 5, 0] },
];

const COLOR: CurveKey[] = [
  { time: 0, values: [1, 0, 0, 1] },
  { time: 0.5, values: [0, 0, 1, 0] },
];

const columns = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent);

describe("KeyTable", () => {
  it("gives a vector a column per channel, in the letters Riot labels them with", () => {
    render(<KeyTable keys={VECTOR} family="vector" />);

    expect(columns()).toEqual(["Time", "X", "Y", "Z"]);
  });

  it("writes a row per key, its time first", () => {
    render(<KeyTable keys={VECTOR} family="vector" />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("0.000")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("10")).toBeInTheDocument();
  });

  it("carries a swatch and the hex on a colour's row, which four numbers are not", () => {
    render(<KeyTable keys={COLOR} family="color" />);

    expect(screen.getByText("#FF0000FF")).toBeInTheDocument();
    expect(screen.getByText("#0000FF00")).toBeInTheDocument();
    expect(columns()).toEqual(["Time", "", "R", "G", "B", "A"]);
  });

  it("names its one channel nothing on a scalar, which has none to tell apart", () => {
    render(<KeyTable keys={[{ time: 0, values: [2.5] }]} family="scalar" />);

    expect(screen.getByText("2.5")).toBeInTheDocument();
  });

  it("says so where the read answered no key", () => {
    render(<KeyTable keys={[]} family="scalar" />);

    expect(screen.getByText("No keys")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
