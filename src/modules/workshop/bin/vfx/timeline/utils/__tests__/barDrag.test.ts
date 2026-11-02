import { describe, expect, it } from "vitest";

import type { EmitterModel } from "../../../engine/model/model";
import {
  barFields,
  barGripAt,
  draggedBar,
  dragReadout,
  edgeTime,
  followedBar,
  snapTime,
} from "../barDrag";
import {
  clearedEdits,
  cycleEdits,
  draggedEdits,
  noCycleEdits,
  TIMING,
  withBar,
} from "../timingEdits";

const view = { from: 0, to: 10 };
const bar = { start: 1, end: 3, tail: 1, linger: 1, period: null, burst: false };

describe("a bar's grips", () => {
  it("grips the nearest edge, moves between them, and takes nothing off the bar", () => {
    expect(barGripAt(bar, view, 100, 10, true)).toBe("start");
    expect(barGripAt(bar, view, 100, 31, true)).toBe("end");
    expect(barGripAt(bar, view, 100, 50, true)).toBe("linger");
    expect(barGripAt(bar, view, 100, 20, true)).toBe("move");
    expect(barGripAt(bar, view, 100, 50, false)).toBeNull();
    expect(barGripAt(bar, view, 100, 80, true)).toBeNull();
  });

  it("keeps the end on a burst and on a bar too short to tell its edges apart", () => {
    expect(barGripAt({ ...bar, burst: true }, view, 100, 30, true)).toBe("end");
    expect(barGripAt({ ...bar, end: 1.02 }, view, 100, 10.2, false)).toBe("end");
  });

  it("grips an endless bar's end at the view's edge", () => {
    expect(barGripAt({ ...bar, end: null }, view, 100, 99, true)).toBe("end");
  });
});

describe("a dragged bar", () => {
  it("moves whole, or trims its start alone keeping its end", () => {
    expect(draggedBar("move", bar, 2)).toMatchObject({ start: 2, end: 4 });
    expect(draggedBar("start", bar, 2)).toMatchObject({ start: 2, end: 3 });
    expect(draggedBar("start", bar, 5).start).toBeLessThan(3);
  });

  it("moves an endless bar by its start alone, and ends one where the drag leaves its edge", () => {
    const endless = { ...bar, end: null };

    expect(draggedBar("move", endless, 2)).toMatchObject({ start: 2, end: null });
    expect(draggedBar("end", endless, 6)).toMatchObject({ start: 1, end: 6 });
  });

  it("never drags the end before the start, nor the linger under nothing", () => {
    expect(draggedBar("end", bar, 0).end).toBeGreaterThan(bar.start);
    expect(draggedBar("linger", bar, 2).linger).toBe(0);
    expect(draggedBar("linger", bar, 6.5).linger).toBe(2.5);
  });
});

describe("followedBar", () => {
  const other = { ...bar, start: 4, end: 8, linger: 0.5 };

  it("shifts another bar's start by what a move or a start trim shifted the dragged one", () => {
    expect(followedBar("move", bar, draggedBar("move", bar, 2), other, true)).toMatchObject({
      start: 5,
      end: 9,
    });
    expect(followedBar("start", bar, draggedBar("start", bar, 2), other, true)).toMatchObject({
      start: 5,
      end: 8,
    });
  });

  it("shifts another bar's end or linger by what the drag shifted the dragged one's", () => {
    expect(followedBar("end", bar, draggedBar("end", bar, 4), other, true)?.end).toBe(9);
    expect(followedBar("linger", bar, { ...bar, linger: 2 }, other, true)?.linger).toBe(1.5);
  });

  it("returns null for a bar that has no such edge", () => {
    const endless = { ...other, end: null };

    expect(followedBar("end", bar, draggedBar("end", bar, 4), endless, true)).toBeNull();
    expect(followedBar("linger", bar, { ...bar, linger: 2 }, endless, true)).toBeNull();
    expect(followedBar("linger", bar, { ...bar, linger: 2 }, other, false)).toBeNull();
  });

  it("moves no other bar on an end drag that started on an endless bar", () => {
    const endless = { ...bar, end: null };

    expect(followedBar("end", endless, { ...endless, end: 6 }, other, true)).toBeNull();
  });
});

describe("draggedEdits", () => {
  it("writes each moved bar under its own list, one edit per list", () => {
    const edits = draggedEdits("0x1", "start", [
      { place: { list: "0xaaaaaaaa", index: 0 }, bar: { ...bar, start: 2 } },
      { place: { list: "0xbbbbbbbb", index: 1 }, bar: { ...bar, start: 3 } },
      { place: { list: "0xaaaaaaaa", index: 4 }, bar: { ...bar, start: 5 } },
    ]);

    const leaf = (index: number, value: number) => [
      { type: "ensureProperty", path: `[${index}]`, field: TIMING.timeBeforeFirstEmission },
      {
        type: "setLeaf",
        path: `[${index}].${TIMING.timeBeforeFirstEmission.slice(2)}`,
        value: { type: "float", value },
      },
    ];
    expect(edits).toEqual([
      { entry: "0x1", holder: "", field: "0xaaaaaaaa", edits: [...leaf(0, 2), ...leaf(4, 5)] },
      { entry: "0x1", holder: "", field: "0xbbbbbbbb", edits: leaf(1, 3) },
    ]);
  });
});

describe("cycleEdits", () => {
  const period = TIMING.period.slice(2);
  const active = TIMING.timeActiveDuringPeriod.slice(2);

  it("writes a second's cycle with half of it active", () => {
    expect(cycleEdits(2, null)).toEqual([
      { type: "ensureProperty", path: "[2]", field: TIMING.period },
      { type: "setLeaf", path: `[2].${period}`, value: { type: "float", value: 1 } },
      { type: "ensureProperty", path: "[2]", field: TIMING.timeActiveDuringPeriod },
      { type: "setLeaf", path: `[2].${active}`, value: { type: "float", value: 0.5 } },
    ]);
  });

  it("keeps a held active time and grows the cycle past it", () => {
    expect(cycleEdits(0, 3)).toEqual([
      { type: "ensureProperty", path: "[0]", field: TIMING.period },
      { type: "setLeaf", path: `[0].${period}`, value: { type: "float", value: 6 } },
    ]);
  });

  it("clears the period alone, or with the active time the emitter holds", () => {
    expect(noCycleEdits(1, null)).toEqual([{ type: "removeItem", path: `[1].${period}[0]` }]);
    expect(noCycleEdits(1, 0.5)).toEqual([
      { type: "removeItem", path: `[1].${period}[0]` },
      { type: "removeItem", path: `[1].${active}[0]` },
    ]);
    expect(clearedEdits(1, [])).toEqual([]);
  });
});

describe("the fields a drag writes", () => {
  it("writes a trimmed start alone, which leaves the end time where it was", () => {
    expect(barFields("start", draggedBar("start", bar, 2))).toEqual([
      { field: "timeBeforeFirstEmission", value: 2 },
    ]);
  });

  it("writes a moved bar's start and the end time it carried along", () => {
    expect(barFields("move", draggedBar("move", bar, 2))).toEqual([
      { field: "timeBeforeFirstEmission", value: 2 },
      { field: "lifetime", value: 4 },
    ]);
  });

  it("writes a moved endless bar's start alone, which gives it no end", () => {
    expect(barFields("move", draggedBar("move", { ...bar, end: null }, 2))).toEqual([
      { field: "timeBeforeFirstEmission", value: 2 },
    ]);
  });

  it("writes a dragged end as the time the bar ends at, on the system's clock", () => {
    expect(barFields("end", draggedBar("end", bar, 4))).toEqual([{ field: "lifetime", value: 4 }]);
    expect(barFields("end", draggedBar("end", { ...bar, start: 2.5 }, 4))).toEqual([
      { field: "lifetime", value: 4 },
    ]);
    expect(barFields("end", { ...bar, end: null })).toEqual([{ field: "lifetime", value: 1 }]);
  });

  it("writes a dragged linger as the seconds past the particle tail", () => {
    expect(barFields("linger", draggedBar("linger", bar, 3))).toEqual([
      { field: "particleLinger", value: 0 },
    ]);
    expect(barFields("linger", draggedBar("linger", bar, 5.5))).toEqual([
      { field: "particleLinger", value: 1.5 },
    ]);
  });
});

describe("a drag's readout", () => {
  it("reads where the start stands for a move and for a trim", () => {
    expect(dragReadout("move", draggedBar("move", bar, 2))).toBe(2);
    expect(dragReadout("start", draggedBar("start", bar, 2.5))).toBe(2.5);
  });

  it("reads the time the bar ends at for a dragged end, and its start for a bar with none", () => {
    expect(dragReadout("end", draggedBar("end", bar, 4))).toBe(4);
    expect(dragReadout("end", { ...bar, end: null })).toBe(1);
  });

  it("reads the linger a dragged linger sets", () => {
    expect(dragReadout("linger", draggedBar("linger", bar, 5.5))).toBe(1.5);
  });
});

describe("a bar's edges", () => {
  it("stands the end at the end time, and the linger past the tail after it", () => {
    expect(edgeTime("start", bar, view)).toBe(1);
    expect(edgeTime("move", bar, view)).toBe(1);
    expect(edgeTime("end", bar, view)).toBe(3);
    expect(edgeTime("linger", bar, view)).toBe(5);
  });

  it("stands an endless bar's end at the view's edge, and gives it no linger edge", () => {
    expect(edgeTime("end", { ...bar, end: null }, view)).toBe(10);
    expect(edgeTime("end", { ...bar, end: 40 }, view)).toBe(10);
    expect(edgeTime("linger", { ...bar, end: null }, view)).toBeNull();
  });
});

describe("the preview a drag runs", () => {
  const emitter = { timeBeforeFirstEmission: 0, lifetime: 1, particleLinger: 0 } as EmitterModel;

  it("stands the bar's end as the emitter's lifetime, and its start and linger beside it", () => {
    expect(withBar(emitter, { ...bar, start: 2, end: 6, linger: 0.5 })).toMatchObject({
      timeBeforeFirstEmission: 2,
      lifetime: 6,
      particleLinger: 0.5,
    });
  });

  it("leaves an endless bar's emitter with no lifetime", () => {
    expect(withBar(emitter, { ...bar, end: null }).lifetime).toBeNull();
  });
});

describe("snapping", () => {
  it("pulls a time onto a target within reach, and rounds it otherwise", () => {
    expect(snapTime(2.04, [2], view, 100, 0.01)).toEqual({ time: 2, snapped: 2 });
    const free = snapTime(2.444, [5], view, 100, 0.01);
    expect(free.time).toBeCloseTo(2.44, 9);
    expect(free.snapped).toBeNull();
  });
});
