import { describe, expect, it } from "vitest";

import type { ChildBirth } from "../children";
import { BLEND_MODE } from "../enums";
import {
  childBars,
  childLanes,
  draggedLoop,
  fitted,
  gripAt,
  laneBar,
  laneOrder,
  laneSpan,
  matchingLanes,
  minorTicks,
  painted,
  panned,
  shownAlone,
  soloAlone,
  ticks,
  tickStep,
  timeAt,
  xOf,
  zoomed,
} from "../laneModel";
import type { EmitterModel, SystemModel } from "../model";
import { emptySystem } from "../systemModel";

describe("lane visibility", () => {
  it("sets every lane of a stroke the same way", () => {
    expect(painted(new Set([1]), [1, 2, 3], true)).toEqual(new Set([1, 2, 3]));
    expect(painted(new Set([1, 2, 3]), [2, 3], false)).toEqual(new Set([1]));
  });

  it("spans the lanes between two in draw order, whichever was pressed first", () => {
    expect(laneSpan([4, 2, 7, 1], 7, 4)).toEqual([4, 2, 7]);
    expect(laneSpan([4, 2, 7, 1], 2, 1)).toEqual([2, 7, 1]);
  });

  it("spans the pressed lane alone where the other end is no longer listed", () => {
    expect(laneSpan([4, 2, 7], 9, 2)).toEqual([2]);
  });

  it("hides every other lane, and shows them all again from the lane standing alone", () => {
    expect(shownAlone(new Set([1]), 2, [0, 1, 2])).toEqual(new Set([0, 1]));
    expect(shownAlone(new Set([0, 1]), 2, [0, 1, 2])).toEqual(new Set());
  });

  it("solos a lane alone, and clears the solo from the lane already alone", () => {
    expect(soloAlone(new Set([0, 3]), 2)).toEqual(new Set([2]));
    expect(soloAlone(new Set([2]), 2)).toEqual(new Set());
  });
});

describe("gripAt", () => {
  /** A hundred pixels a second, which puts the loop at 50 to 100. */
  const VIEW = { from: 0, to: 2 };
  const LOOP = { from: 0.5, to: 1 };

  it("grips the in and the out within a few pixels of each edge", () => {
    expect(gripAt(LOOP, VIEW, 200, 52)).toBe("in");
    expect(gripAt(LOOP, VIEW, 200, 97)).toBe("out");
  });

  it("grips the band between its edges, and the open ruler outside it", () => {
    expect(gripAt(LOOP, VIEW, 200, 75)).toBe("band");
    expect(gripAt(LOOP, VIEW, 200, 150)).toBe("ruler");
    expect(gripAt(null, VIEW, 200, 75)).toBe("ruler");
  });

  it("grips the nearer edge of a band narrower than its two grips", () => {
    const narrow = { from: 0.5, to: 0.54 };

    expect(gripAt(narrow, VIEW, 200, 53)).toBe("out");
    expect(gripAt(narrow, VIEW, 200, 51)).toBe("in");
  });
});

describe("draggedLoop", () => {
  const LOOP = { from: 0.5, to: 1 };

  it("moves the in alone, never past the out or before zero", () => {
    expect(draggedLoop("in", LOOP, -0.25, 2)).toEqual({ from: 0.25, to: 1 });
    expect(draggedLoop("in", LOOP, -1, 2)).toEqual({ from: 0, to: 1 });
    expect(draggedLoop("in", LOOP, 1, 2).from).toBeLessThan(1);
  });

  it("moves the out alone, never past the span or before the in", () => {
    expect(draggedLoop("out", LOOP, 0.5, 2)).toEqual({ from: 0.5, to: 1.5 });
    expect(draggedLoop("out", LOOP, 5, 2)).toEqual({ from: 0.5, to: 2 });
    expect(draggedLoop("out", LOOP, -1, 2).to).toBeGreaterThan(0.5);
  });

  it("moves the whole band, holding its width inside the span", () => {
    expect(draggedLoop("band", LOOP, 0.25, 2)).toEqual({ from: 0.75, to: 1.25 });
    expect(draggedLoop("band", LOOP, 5, 2)).toEqual({ from: 1.5, to: 2 });
    expect(draggedLoop("band", LOOP, -5, 2)).toEqual({ from: 0, to: 0.5 });
  });
});

function constant(...values: number[]) {
  return { constant: values, keys: [], tables: [] };
}

/** An emitter as the lanes read one: its timing, its order keys and its name. */
function emitter(over: Partial<EmitterModel> = {}): EmitterModel {
  return {
    index: 0,
    simple: false,
    listIndex: 0,
    name: "smoke",
    disabled: false,
    lifetime: 1,
    timeBeforeFirstEmission: 0,
    particleLifetime: constant(0.5),
    particleLinger: 0,
    blendMode: BLEND_MODE.add,
    pass: 0,
    miscRenderFlags: 0,
    groundLayer: false,
    childSet: null,
    ...over,
  } as EmitterModel;
}

function system(...emitters: EmitterModel[]): SystemModel {
  return { ...emptySystem("0x1"), emitters };
}

describe("laneBar", () => {
  it("spans the emission window from the first emission to the end of the lifetime", () => {
    const bar = laneBar(emitter({ timeBeforeFirstEmission: 0.5, lifetime: 2 }));

    expect(bar.start).toBe(0.5);
    expect(bar.end).toBe(2.5);
  });

  it("leaves an endless emitter with no end", () => {
    expect(laneBar(emitter({ lifetime: null })).end).toBeNull();
  });

  it("tails by the peak of the particle lifetime, keys included", () => {
    const bar = laneBar(
      emitter({
        particleLifetime: { constant: [0.5], keys: [{ time: 1, values: [2] }], tables: [] },
      }),
    );

    expect(bar.tail).toBe(2);
  });

  it("lingers by the emitter's own linger, capped as the engine caps it", () => {
    expect(laneBar(emitter({ particleLinger: 3 })).linger).toBe(3);
    expect(laneBar(emitter({ particleLinger: 99, particleLifetime: constant(1) })).linger).toBe(11);
  });
});

describe("laneOrder", () => {
  it("lists the ground layer first, then by pass, and by index last", () => {
    const ordered = laneOrder(
      system(
        emitter({ index: 0, name: "late", pass: 1 }),
        emitter({ index: 1, name: "early", pass: 0 }),
        emitter({ index: 2, name: "ground", groundLayer: true, pass: 5 }),
      ),
    );

    expect(ordered.map((each) => each.name)).toEqual(["ground", "early", "late"]);
  });
});

describe("matchingLanes", () => {
  it("keeps the emitters whose name holds the text, case-insensitively", () => {
    const held = [emitter({ name: "Orb" }), emitter({ name: "Sparkles" })];

    expect(matchingLanes(held, "spark").map((each) => each.name)).toEqual(["Sparkles"]);
    expect(matchingLanes(held, "  ")).toBe(held);
  });
});

describe("the window", () => {
  it("opens fitted to the run with a margin past its span", () => {
    expect(fitted(2)).toEqual({ from: 0, to: 2.1 });
  });

  it("never opens narrower than a quarter second", () => {
    expect(fitted(0).to).toBe(0.25);
  });

  it("zooms about the time under the pointer", () => {
    const held = { from: 0, to: 4 };

    const narrowed = zoomed(held, 2, 0.5, 4);

    expect(narrowed.from).toBeCloseTo(1);
    expect(narrowed.to).toBeCloseTo(3);
  });

  it("zooms out no further than the fitted run", () => {
    expect(zoomed({ from: 1, to: 2 }, 1.5, 100, 4)).toEqual(fitted(4));
  });

  it("pans inside the run and stops at its ends", () => {
    expect(panned({ from: 1, to: 2 }, 0.5, 4)).toEqual({ from: 1.5, to: 2.5 });
    expect(panned({ from: 1, to: 2 }, -5, 4)).toEqual({ from: 0, to: 1 });
    expect(panned({ from: 1, to: 2 }, 50, 4).to).toBeCloseTo(4.2);
  });

  it("maps a time to a pixel and back", () => {
    const window = { from: 1, to: 3 };

    expect(xOf(window, 200, 2)).toBe(100);
    expect(timeAt(window, 200, 150)).toBe(2.5);
  });
});

describe("the ruler", () => {
  it("ticks at the finest round step that keeps the labels apart", () => {
    expect(tickStep({ from: 0, to: 2 }, 400)).toBe(0.5);
    expect(tickStep({ from: 0, to: 60 }, 400)).toBe(10);
  });

  it("lists the round ticks inside the window", () => {
    expect(ticks({ from: 0.3, to: 2 }, 400)).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(ticks({ from: 0.3, to: 2 }, 200)).toEqual([0.5, 1, 1.5, 2]);
  });

  it("cuts each labelled step into minor ticks, leaving the labelled ones out", () => {
    expect(minorTicks({ from: 0, to: 1 }, 400).slice(0, 5)).toEqual([0.05, 0.1, 0.15, 0.2, 0.3]);
    expect(minorTicks({ from: 0, to: 8 }, 400).slice(0, 4)).toEqual([0.5, 1, 1.5, 2.5]);
  });
});

describe("child lanes", () => {
  const spark = emitter({ index: 0, name: "spark", lifetime: 0.5 });
  const child = system(spark);
  const parent = emitter({
    index: 3,
    name: "burst",
    childSet: {
      children: [child, null],
      bones: [],
      probability: constant(0),
      onDeath: false,
      inheritance: null,
    },
  });

  it("nests one lane per emitter of each child the set names, skipping a null", () => {
    const lanes = childLanes(parent);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].path).toBe("3.0");
    expect(lanes[0].emitter).toBe(spark);
  });

  it("stands a bar at each spawn of this pass, in the run's own phase", () => {
    const [lane] = childLanes(parent);
    const births: ChildBirth[] = [
      { path: "3.0", emitter: 3, slot: 0, bornAt: 10.25, depth: 1 },
      { path: "3.1", emitter: 3, slot: 1, bornAt: 10.5, depth: 1 },
      { path: "3.0", emitter: 3, slot: 0, bornAt: 11, depth: 1 },
    ];

    const bars = childBars(births, lane, 10);

    expect(bars.map((bar) => [bar.start, bar.end])).toEqual([
      [0.25, 0.75],
      [1, 1.5],
    ]);
  });

  it("runs an endless child emitter to the end of the child's span", () => {
    const endless = emitter({ index: 0, name: "glow", lifetime: null });
    const lane = childLanes(
      emitter({ index: 1, childSet: { ...parent.childSet!, children: [system(endless)] } }),
    )[0];

    const [bar] = childBars([{ path: "1.0", emitter: 1, slot: 0, bornAt: 2, depth: 1 }], lane, 0);

    expect(bar.end).toBeGreaterThan(2);
  });
});
