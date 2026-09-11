import { describe, expect, it } from "vitest";

import { nameHash } from "../binHash";
import {
  chanceNear,
  type ChannelDraw,
  drawGap,
  drawnAtBirth,
  drawsFlat,
  drawSpan,
  drawsSpread,
  drawSummary,
  neverRolled,
  randomDraw,
  rerollsEveryFrame,
  tableShape,
  valueDensity,
} from "../randomDraw";
import type { ProbabilityTable, ValueMark } from "../valueRows";

function table(channel: number, keys: [number, number][], single = 1): ProbabilityTable {
  return { channel, single, keys: keys.map(([time, value]) => ({ time, values: [value] })) };
}

const IDENTITY = (channel: number): ProbabilityTable => table(channel, []);

function vector(values: number[], tables: ProbabilityTable[], over: Partial<ValueMark> = {}) {
  return {
    family: "vector",
    constant: { type: "vector", values },
    keys: [],
    tables,
    curve: true,
    slots: tables.length,
    ...over,
  } satisfies ValueMark;
}

describe("tableShape", () => {
  it("reads a keyless table of 1 as fixed and one of anything else as always", () => {
    expect(tableShape(table(0, []))).toBe("fixed");
    expect(tableShape(table(0, [], 2))).toBe("always");
    expect(tableShape(table(0, [[0, 90]]))).toBe("always");
    expect(
      tableShape(
        table(0, [
          [0, 1],
          [1, 1],
        ]),
      ),
    ).toBe("fixed");
  });

  it("reads two keys on 0 and 1 as uniform", () => {
    expect(
      tableShape(
        table(0, [
          [0, 0],
          [1, 360],
        ]),
      ),
    ).toBe("uniform");
  });

  it("reads one narrow step inside the chance as a split", () => {
    const sign = table(0, [
      [0, -1],
      [0.5, -0.6],
      [0.501, 0.6],
      [1, 1],
    ]);

    expect(tableShape(sign)).toBe("split");
  });

  it("reads a knee, or two keys off the ends, as custom", () => {
    expect(
      tableShape(
        table(0, [
          [0, 0.4],
          [0.8, 1],
          [1, 1.5],
        ]),
      ),
    ).toBe("custom");
    expect(
      tableShape(
        table(0, [
          [0.5, 0],
          [1, 1],
        ]),
      ),
    ).toBe("custom");
  });
});

describe("randomDraw", () => {
  it("draws nothing before the tables are read, or for a value that has none", () => {
    const { slots: _, ...unread } = vector(
      [1, 1, 1],
      [
        table(0, [
          [0, 0],
          [1, 1],
        ]),
      ],
    );

    expect(randomDraw(unread)).toBeNull();
    expect(randomDraw(vector([1, 1, 1], []))).toBeNull();
    expect(randomDraw(undefined)).toBeNull();
  });

  it("reads the result as the base times the factor, and the filler as fixed", () => {
    const draw = randomDraw(
      vector(
        [1, 0, 0],
        [
          table(0, [
            [0, 0],
            [1, 360],
          ]),
          IDENTITY(1),
          IDENTITY(2),
        ],
      ),
    );

    expect(draw?.channels.map((each) => each.shape)).toEqual(["uniform", "fixed", "fixed"]);
    expect(draw?.channels[0]?.results).toEqual([{ least: 0, most: 360 }]);
  });

  it("turns a spread over a magnitude into the magnitude's range", () => {
    const draw = randomDraw(
      vector(
        [20, 20, 20],
        [
          table(0, [
            [0, 0.5],
            [1, 1],
          ]),
          IDENTITY(1),
          IDENTITY(2),
        ],
      ),
    );

    expect(draw?.channels[0]?.results).toEqual([{ least: 10, most: 20 }]);
  });

  it("gives a split two ranges", () => {
    const sign = table(0, [
      [0, -1],
      [0.5, -0.6],
      [0.501, 0.6],
      [1, 1],
    ]);
    const draw = randomDraw(vector([1, 1, 1], [sign, IDENTITY(1), IDENTITY(2)]));

    expect(draw?.channels[0]?.factors).toEqual([
      { least: -1, most: -0.6 },
      { least: 0.6, most: 1 },
    ]);
  });

  it("reads a random table over a base of 0 as dead", () => {
    const draw = randomDraw(
      vector(
        [1, 0, 0],
        [
          IDENTITY(0),
          table(1, [
            [0, 0],
            [1, 5],
          ]),
          IDENTITY(2),
        ],
      ),
    );

    expect(draw?.channels[1]?.shape).toBe("dead");
  });

  it("gives a value whose base animates its factor alone", () => {
    const keys = [
      { time: 0, values: [1, 1, 1] },
      { time: 1, values: [2, 1, 1] },
    ];
    const draw = randomDraw(
      vector(
        [1, 1, 1],
        [
          table(0, [
            [0, 0.5],
            [1, 1],
          ]),
          IDENTITY(1),
          IDENTITY(2),
        ],
        { keys },
      ),
    );

    expect(draw?.channels[0]?.base).toBeNull();
    expect(draw?.channels[0]?.results).toBeNull();
    expect(draw?.channels[0]?.factors).toEqual([{ least: 0.5, most: 1 }]);
  });

  it("reads a null slot beside a table as broken, as the engine would crash on it", () => {
    const draw = randomDraw(
      vector(
        [1, 1, 1],
        [
          table(0, [
            [0, 0],
            [1, 1],
          ]),
        ],
        { slots: 3 },
      ),
    );

    expect(draw?.broken).toBe(true);
    expect(draw?.channels[1]?.shape).toBe("broken");
  });

  it("reads lists of two lengths as broken", () => {
    const zeroed: ProbabilityTable = { channel: 0, single: 0, keys: [], mismatched: true };
    const draw = randomDraw(vector([1, 1, 1], [zeroed, IDENTITY(1), IDENTITY(2)]));

    expect(draw?.channels[0]?.shape).toBe("broken");
  });
});

describe("drawSummary", () => {
  const uniform = (channel: number) =>
    table(channel, [
      [0, 0.8],
      [1, 1.2],
    ]);

  it("names one random channel", () => {
    const draw = randomDraw(vector([1, 1, 1], [uniform(0), IDENTITY(1), IDENTITY(2)]));

    expect(draw === null ? null : drawSummary(draw)).toMatchObject({ kind: "one" });
  });

  it("links channels that draw one table over one base", () => {
    const draw = randomDraw(vector([2, 2, 2], [uniform(0), uniform(1), uniform(2)]));

    expect(draw === null ? null : drawSummary(draw)).toMatchObject({
      kind: "linked",
      channels: [0, 1, 2],
    });
  });

  it("counts random channels that differ", () => {
    const draw = randomDraw(vector([1, 2, 1], [uniform(0), uniform(1), IDENTITY(2)]));

    expect(draw === null ? null : drawSummary(draw)).toEqual({ kind: "several", count: 2 });
  });

  it("says nothing of a value whose tables are all filler", () => {
    const draw = randomDraw(vector([1, 1, 1], [IDENTITY(0), IDENTITY(1), IDENTITY(2)]));

    expect(draw === null ? null : drawSummary(draw)).toBeNull();
  });
});

const SIGN = table(0, [
  [0, -1],
  [0.5, -0.6],
  [0.501, 0.6],
  [1, 1],
]);

const ANGLE = table(0, [
  [0, 0],
  [1, 360],
]);

/** The first channel of a vector whose X draws `first` over a base of 1. */
function firstChannel(first: ProbabilityTable): ChannelDraw {
  const channel = randomDraw(vector([1, 1, 1], [first, IDENTITY(1), IDENTITY(2)]))?.channels[0];
  if (channel === undefined) throw new Error("no channel");
  return channel;
}

describe("valueDensity", () => {
  it("draws a uniform table flat across its span", () => {
    const channel = firstChannel(ANGLE);

    expect(drawSpan(channel)).toEqual({ least: 0, most: 360 });
    expect(valueDensity(channel, 1, { least: 0, most: 360 }, 8)).toEqual(new Array(8).fill(1));
  });

  it("leaves next to nothing in a split's gap", () => {
    const density = valueDensity(firstChannel(SIGN), 1, { least: -1, most: 1 }, 10);

    expect(density[5]).toBeLessThan(0.01);
    expect(density[0]).toBeGreaterThan(0);
    expect(density[9]).toBeGreaterThan(0);
  });

  it("lands a flat run of the table whole in one bin", () => {
    const knee = table(0, [
      [0, 1],
      [0.5, 1],
      [1, 2],
    ]);

    const density = valueDensity(firstChannel(knee), 1, { least: 0, most: 2 }, 4);

    expect(density[2]).toBe(1);
    expect(density[3]).toBeCloseTo(1 / 3);
    expect(density[0]).toBe(0);
  });

  it("scales the draw by the level it multiplies", () => {
    const density = valueDensity(firstChannel(ANGLE), 0.5, { least: 0, most: 360 }, 2);

    expect(density).toEqual([1, 0]);
  });
});

describe("chanceNear and drawGap", () => {
  it("finds the chance a value is drawn at", () => {
    expect(chanceNear(firstChannel(ANGLE), 90)).toBeCloseTo(0.25);
  });

  it("names a split's gap, and none for a draw without one", () => {
    expect(drawGap(firstChannel(SIGN))).toEqual({ least: -0.6, most: 0.6 });
    expect(drawGap(firstChannel(ANGLE))).toBeNull();
  });
});

describe("drawsSpread and drawsFlat", () => {
  it("spreads a random channel and not a set of filler", () => {
    expect(drawsSpread(randomDraw(vector([1, 1, 1], [ANGLE, IDENTITY(1), IDENTITY(2)])))).toBe(
      true,
    );
    expect(
      drawsSpread(randomDraw(vector([1, 1, 1], [IDENTITY(0), IDENTITY(1), IDENTITY(2)]))),
    ).toBe(false);
    expect(drawsSpread(null)).toBe(false);
  });

  it("reads a base that animates as no longer flat", () => {
    const still = randomDraw(vector([1, 1, 1], [ANGLE, IDENTITY(1), IDENTITY(2)]));
    const moving = randomDraw(
      vector([1, 1, 1], [ANGLE, IDENTITY(1), IDENTITY(2)], {
        keys: [
          { time: 0, values: [1, 1, 1] },
          { time: 1, values: [2, 1, 1] },
        ],
      }),
    );

    expect(still !== null && drawsFlat(still)).toBe(true);
    expect(moving !== null && drawsFlat(moving)).toBe(false);
  });
});

describe("drawnAtBirth", () => {
  it("takes every birth field and the lifetime, and no field the emitter reads over time", () => {
    expect(drawnAtBirth("birthRotation0")).toBe(true);
    expect(drawnAtBirth("birthUVOffset")).toBe(true);
    expect(drawnAtBirth("particleLifetime")).toBe(true);
    expect(drawnAtBirth("rate")).toBe(false);
    expect(drawnAtBirth("scale0")).toBe(false);
  });
});

describe("neverRolled and rerollsEveryFrame", () => {
  it("dims a key outside the chance", () => {
    expect(neverRolled(12)).toBe(true);
    expect(neverRolled(1)).toBe(false);
  });

  it("names the per-frame fields a table flickers on", () => {
    expect(rerollsEveryFrame(nameHash("Color"))).toBe(true);
    expect(rerollsEveryFrame(nameHash("birthColor"))).toBe(false);
    expect(rerollsEveryFrame(null)).toBe(false);
  });
});
