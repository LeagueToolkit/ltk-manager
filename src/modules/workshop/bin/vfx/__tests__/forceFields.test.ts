import { describe, expect, it } from "vitest";

import {
  accelerateInto,
  applyFields,
  attractInto,
  dragInto,
  type FieldPlace,
  impulsesOwed,
  noiseClock,
  noiseInto,
  orbitFieldInto,
  prepareFields,
  type SampledNoise,
} from "../forceFields";
import type { FieldsModel, NoiseFieldModel, ValueCurve } from "../model";

function velocity(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

function rounded(values: ArrayLike<number>): number[] {
  return Array.from(values, (value) => Math.round(value * 1e5) / 1e5 + 0);
}

function flat(...constant: number[]): ValueCurve {
  return { constant, keys: [], tables: [] };
}

function length(values: ArrayLike<number>): number {
  return Math.hypot(values[0], values[1], values[2]);
}

describe("accelerateInto", () => {
  it("adds the acceleration over the step", () => {
    const held = velocity(1, 2, 3);
    accelerateInto(held, [10, 0, -20], 0.5);

    expect(rounded(held)).toEqual([6, 2, -7]);
  });
});

describe("attractInto", () => {
  it("pulls toward the centre at a constant rate wherever inside the radius", () => {
    const near = velocity(0, 0, 0);
    const far = velocity(0, 0, 0);
    attractInto(near, [10, 0, 0], [0, 0, 0], 100, 200, 0.5);
    attractInto(far, [150, 0, 0], [0, 0, 0], 100, 200, 0.5);

    expect(rounded(near)).toEqual([-50, 0, 0]);
    expect(rounded(far)).toEqual([-50, 0, 0]);
  });

  it("leaves a particle outside the radius alone", () => {
    const held = velocity(1, 1, 1);
    attractInto(held, [300, 0, 0], [0, 0, 0], 100, 200, 0.5);

    expect(rounded(held)).toEqual([1, 1, 1]);
  });

  it("weakens within one unit of the centre, where the distance is floored", () => {
    const held = velocity(0, 0, 0);
    attractInto(held, [0, 0.5, 0], [0, 0, 0], 100, 200, 1);

    expect(rounded(held)).toEqual([0, -50, 0]);
  });
});

/** A noise field at the origin, reaching 100 units, firing one impulse of 30. */
function noise(over: Partial<SampledNoise> = {}): SampledNoise {
  return {
    centre: [0, 0, 0],
    radius: 100,
    delta: 30,
    axes: [1, 1, 1],
    kicks: 1,
    first: 0,
    slot: 0,
    ...over,
  };
}

describe("impulsesOwed", () => {
  it("fires once on the field's first update", () => {
    const clock = noiseClock();

    expect(impulsesOwed(clock, 10, 0.05)).toBe(1);
    expect(clock).toEqual({ last: 0.05, fired: 1 });
  });

  it("then fires once for each whole period crossed on absolute time since the last fire", () => {
    const clock = noiseClock();
    impulsesOwed(clock, 10, 0.05);

    expect(impulsesOwed(clock, 10, 0.08)).toBe(0);
    expect(impulsesOwed(clock, 10, 0.12)).toBe(1);
    expect(impulsesOwed(clock, 10, 0.35)).toBe(2);
    expect(clock.fired).toBe(4);
  });

  it("never fires again at a frequency of zero", () => {
    const clock = noiseClock();

    expect(impulsesOwed(clock, 0, 0)).toBe(1);
    expect(impulsesOwed(clock, 0, 5)).toBe(0);
    expect(impulsesOwed(clock, 0, 500)).toBe(0);
  });
});

describe("noiseInto", () => {
  it("kicks by the velocity delta along one unit direction, whatever the step", () => {
    const held = velocity(0, 0, 0);
    noiseInto(held, [0, 0, 0], noise(), 7);

    expect(length(held)).toBeCloseTo(30, 4);
  });

  it("fires every impulse the step owes, each along a direction of its own", () => {
    const once = velocity(0, 0, 0);
    const thrice = velocity(0, 0, 0);
    noiseInto(once, [0, 0, 0], noise(), 7);
    noiseInto(thrice, [0, 0, 0], noise({ kicks: 3 }), 7);

    expect(length(thrice)).toBeLessThan(90);
    expect(rounded(thrice)).not.toEqual(rounded(once.map((value) => value * 3)));
  });

  it("does nothing on a step that owes no impulse", () => {
    const held = velocity(1, 2, 3);
    noiseInto(held, [0, 0, 0], noise({ kicks: 0 }), 7);

    expect(rounded(held)).toEqual([1, 2, 3]);
  });

  it("multiplies each axis by its own fraction, and a zero fraction reaches nothing", () => {
    const held = velocity(0, 0, 0);
    noiseInto(held, [0, 0, 0], noise({ axes: [0, 1, 0] }), 7);

    expect(held[0]).toBe(0);
    expect(held[2]).toBe(0);
    expect(Math.abs(held[1])).toBeLessThanOrEqual(30);

    const still = velocity(0, 0, 0);
    noiseInto(still, [0, 0, 0], noise({ axes: [0, 0, 0] }), 7);
    expect(rounded(still)).toEqual([0, 0, 0]);
  });

  it("draws each particle and each impulse a direction of its own", () => {
    const one = velocity(0, 0, 0);
    const other = velocity(0, 0, 0);
    const later = velocity(0, 0, 0);
    noiseInto(one, [0, 0, 0], noise(), 7);
    noiseInto(other, [0, 0, 0], noise(), 8);
    noiseInto(later, [0, 0, 0], noise({ first: 1 }), 7);

    expect(rounded(one)).not.toEqual(rounded(other));
    expect(rounded(one)).not.toEqual(rounded(later));
  });

  it("gates a particle past the radius out and keeps one standing on it", () => {
    const outside = velocity(1, 2, 3);
    noiseInto(outside, [500, 0, 0], noise(), 7);
    expect(rounded(outside)).toEqual([1, 2, 3]);

    const edge = velocity(0, 0, 0);
    noiseInto(edge, [100, 0, 0], noise(), 7);
    expect(length(edge)).toBeCloseTo(30, 4);
  });
});

describe("dragInto", () => {
  it("takes the strength's share of each axis over the step inside the radius", () => {
    const held = velocity(10, -20, 0);
    dragInto(held, [0, 0, 0], [0, 0, 0], 0.5, 100, 1);

    expect(rounded(held)).toEqual([5, -10, 0]);
  });

  it("stops a particle rather than turning it round", () => {
    const held = velocity(10, -20, 5);
    dragInto(held, [0, 0, 0], [0, 0, 0], 4, 100, 1);

    expect(rounded(held)).toEqual([0, 0, 0]);
  });

  it("leaves a particle outside the radius alone", () => {
    const held = velocity(10, 0, 0);
    dragInto(held, [500, 0, 0], [0, 0, 0], 0.5, 100, 1);

    expect(rounded(held)).toEqual([10, 0, 0]);
  });
});

describe("orbitFieldInto", () => {
  it("turns the motion across the axis tangential and keeps its speed and its motion along", () => {
    const held = velocity(3, 7, 4);
    orbitFieldInto(held, [10, 0, 0], [0, 0, 0], [0, 1, 0]);

    expect(rounded(held)).toEqual([0, 7, 5]);
  });

  it("keeps the sense the particle is already turning in", () => {
    const held = velocity(0, 0, -5);
    orbitFieldInto(held, [10, 0, 0], [0, 0, 0], [0, 1, 0]);

    expect(rounded(held)).toEqual([0, 0, -5]);
  });

  it("leaves a particle standing on the axis alone", () => {
    const held = velocity(3, 0, 4);
    orbitFieldInto(held, [0, 10, 0], [0, 0, 0], [0, 1, 0]);

    expect(rounded(held)).toEqual([3, 0, 4]);
  });
});

/** An orientation a quarter turn about up, sending `+X` to the engine's `-Z`. */
const TURNED = Float32Array.of(0, 0, 1, 0, 1, 0, -1, 0, 0);

const NONE: FieldsModel = { acceleration: [], attraction: [], noise: [], drag: [], orbital: [] };

/** Fields standing on a system at `x = 10`, turned a quarter about up. */
const ORIENTED: FieldPlace = { origin: [10, 0, 0], orientation: TURNED };

/** The same system under an emitter whose `isLocalOrientation` is off. */
const UNORIENTED: FieldPlace = { origin: [10, 0, 0], orientation: null };

function noiseField(over: Partial<NoiseFieldModel> = {}): NoiseFieldModel {
  return {
    position: flat(0, 0, 0),
    axisFraction: [1, 1, 1],
    frequency: flat(10),
    radius: flat(100),
    velocityDelta: flat(30),
    ...over,
  };
}

describe("prepareFields", () => {
  const acceleration: FieldsModel = {
    ...NONE,
    acceleration: [
      { acceleration: flat(1, 0, 0), localSpace: true },
      { acceleration: flat(0, 2, 0), localSpace: false },
    ],
  };

  it("sums the accelerations, a local one turned by the system's orientation", () => {
    const sampled = prepareFields(acceleration, 0, 0, ORIENTED, []);

    expect(rounded(sampled.acceleration)).toEqual([0, 2, -1]);
  });

  it("leaves a local acceleration as authored where isLocalOrientation is off", () => {
    const sampled = prepareFields(acceleration, 0, 0, UNORIENTED, []);

    expect(rounded(sampled.acceleration)).toEqual([1, 2, 0]);
  });

  it("stands a field's position on the origin, turned by nothing, its radius as authored", () => {
    const sampled = prepareFields(
      {
        ...NONE,
        attraction: [{ position: flat(5, 0, 0), acceleration: flat(100), radius: flat(50) }],
      },
      0,
      0,
      ORIENTED,
      [],
    );

    expect(rounded(sampled.attraction[0].centre)).toEqual([15, 0, 0]);
    expect(sampled.attraction[0].strength).toBe(100);
    expect(sampled.attraction[0].radius).toBe(50);
  });

  it("turns every orbital field about the origin, on a unit axis", () => {
    const sampled = prepareFields(
      { ...NONE, orbital: [{ direction: flat(0, 0, 3), localSpace: false }] },
      0,
      0,
      ORIENTED,
      [],
    );

    expect(sampled.origin).toEqual([10, 0, 0]);
    expect(rounded(sampled.orbital[0])).toEqual([0, 0, 1]);
  });

  it("drops an orbital field whose axis has no length", () => {
    const sampled = prepareFields(
      { ...NONE, orbital: [{ direction: flat(0, 0, 0), localSpace: false }] },
      0,
      0,
      ORIENTED,
      [],
    );

    expect(sampled.orbital).toEqual([]);
  });

  it("moves each noise field's own clock past the impulses it fires", () => {
    const fields: FieldsModel = {
      ...NONE,
      noise: [noiseField(), noiseField({ frequency: flat(0) })],
    };
    const clocks = [noiseClock()];

    const opening = prepareFields(fields, 0, 0.05, ORIENTED, clocks);
    expect(opening.noise.map((each) => [each.kicks, each.first])).toEqual([
      [1, 0],
      [1, 0],
    ]);

    const later = prepareFields(fields, 0, 0.25, ORIENTED, clocks);
    expect(later.noise.map((each) => [each.kicks, each.first])).toEqual([
      [2, 1],
      [0, 1],
    ]);
  });
});

describe("applyFields", () => {
  it("runs drag after noise, so a strong drag takes back the kick of the same step", () => {
    const sampled = prepareFields(
      {
        ...NONE,
        noise: [noiseField()],
        drag: [{ position: flat(0, 0, 0), radius: flat(100), strength: flat(100) }],
      },
      0,
      0,
      { origin: [0, 0, 0], orientation: null },
      [],
    );
    const held = velocity(0, 0, 0);
    applyFields(sampled, held, [0, 0, 0], 7, 1 / 30);

    expect(rounded(held)).toEqual([0, 0, 0]);
  });

  it("reaches a birth step through the noise alone, which no step scales", () => {
    const sampled = prepareFields(
      {
        ...NONE,
        noise: [noiseField()],
        attraction: [{ position: flat(50, 0, 0), acceleration: flat(100), radius: flat(100) }],
        drag: [{ position: flat(0, 0, 0), radius: flat(100), strength: flat(100) }],
      },
      0,
      0,
      { origin: [0, 0, 0], orientation: null },
      [],
    );
    const held = velocity(0, 0, 0);
    applyFields(sampled, held, [0, 0, 0], 7, 0);

    expect(length(held)).toBeCloseTo(30, 4);
  });
});
