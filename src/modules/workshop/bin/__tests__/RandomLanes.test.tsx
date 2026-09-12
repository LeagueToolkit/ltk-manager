// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { randomDraw } from "../randomDraw";
import { RandomLanes } from "../RandomLanes";
import type { ProbabilityTable, ValueMark } from "../valueRows";
import { type VfxRun, VfxRunContext } from "../vfx/run";

function table(channel: number, keys: [number, number][]): ProbabilityTable {
  return { channel, single: 1, keys: keys.map(([time, value]) => ({ time, values: [value] })) };
}

function rotation(tables: ProbabilityTable[], slots = tables.length): ValueMark {
  return {
    family: "vector",
    constant: { type: "vector", values: [1, 0, 0] },
    keys: [],
    tables,
    curve: true,
    slots,
  };
}

const ANGLE = table(0, [
  [0, 0],
  [1, 360],
]);

const SPUN = rotation([ANGLE, table(1, []), table(2, [])]);

function lanes(mark: ValueMark, muted: ReadonlySet<number> = new Set()) {
  const draw = randomDraw(mark);
  if (draw === null) throw new Error("no draw");
  return <RandomLanes draw={draw} unit="degrees" muted={muted} />;
}

/** A run that holds only the pin, which is all a lane reads of one. */
function pinnedAt(pinned: number | null, setPinned = vi.fn()) {
  return { pinned, setPinned } as unknown as VfxRun;
}

describe("RandomLanes", () => {
  it("reads a uniform angle as its range on a lane, and the filler channels as fixed", () => {
    render(lanes(SPUN));

    expect(screen.getByText("0 .. 360")).toBeInTheDocument();
    expect(screen.getAllByText("deg")).toHaveLength(3);
    expect(screen.getByText("uniform")).toBeInTheDocument();
    expect(screen.getAllByText("fixed")).toHaveLength(2);
    expect(screen.getByRole("slider", { name: "Pin the chance on X" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "How often each value is drawn" })).toBeInTheDocument();
  });

  it("hides the lane of a muted channel", () => {
    render(lanes(SPUN, new Set([1, 2])));

    expect(screen.queryByText("fixed")).toBeNull();
    expect(screen.getByText("uniform")).toBeInTheDocument();
  });

  it("opens a split's keys, and dims one past the chance", async () => {
    const sign = table(0, [
      [0, -1],
      [0.5, -0.6],
      [0.501, 0.6],
      [12, 1],
    ]);
    render(lanes(rotation([sign, table(1, []), table(2, [])])));
    expect(screen.getByText("split")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Keys" }));

    expect(await screen.findByText("never rolled")).toBeInTheDocument();
    expect(screen.getByText(/^×-1 \.\. -0\.6 or 0\.6 \.\. .+ of 1$/)).toBeInTheDocument();
  });

  it("names a missing table on its channel", () => {
    render(lanes(rotation([ANGLE], 3)));

    expect(screen.getAllByText("no table")).toHaveLength(2);
  });

  it("reads the value at the pin, and moves the pin by key", async () => {
    const setPinned = vi.fn();
    render(<VfxRunContext value={pinnedAt(0.25, setPinned)}>{lanes(SPUN)}</VfxRunContext>);

    expect(screen.getByText("90")).toBeInTheDocument();

    screen.getByRole("slider", { name: "Pin the chance on X" }).focus();
    await userEvent.setup().keyboard("{ArrowRight}");

    expect(setPinned).toHaveBeenCalledWith(0.26);
  });

  it("pins nothing outside a run", () => {
    render(lanes(SPUN));

    expect(screen.getByRole("slider", { name: "Pin the chance on X" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
