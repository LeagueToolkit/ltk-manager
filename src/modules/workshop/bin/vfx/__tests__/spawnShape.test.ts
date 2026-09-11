import { describe, expect, it } from "vitest";

import { turnInto } from "../basis";
import type { SpawnShape, ValueCurve } from "../model";
import { Rng } from "../Rng";
import { birth, sampleShape } from "../spawnShape";

function flat(...constant: number[]): ValueCurve {
  return { constant, keys: [], tables: [] };
}

function offsetOf(
  shape: SpawnShape,
  seed = 1,
): { at: number[]; turned: boolean; velocity: number[] } {
  const out = birth();
  sampleShape(shape, new Rng(seed), 0, 0.5, out);
  const velocity = new Float32Array([1, 0, 0]);
  if (out.turned) turnInto(out.turn, velocity, 0);
  return { at: Array.from(out.offset), turned: out.turned, velocity: Array.from(velocity) };
}

function length(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

describe("sampleShape", () => {
  it("places a point shape at its offset and turns nothing", () => {
    const held = offsetOf({ kind: "point", offset: [1, 2, 3] });

    expect(held.at).toEqual([1, 2, 3]);
    expect(held.turned).toBe(false);
  });

  it("turns a legacy shape's birth velocity about its axes by its angles in degrees", () => {
    const held = offsetOf({
      kind: "legacy",
      offset: flat(0, 0, 0),
      translation: flat(0, 0, 0),
      angles: [flat(90)],
      axes: [[0, 0, 1]],
    });

    expect(held.turned).toBe(true);
    expect(held.velocity[0]).toBeCloseTo(0, 6);
    expect(held.velocity[1]).toBeCloseTo(1, 6);
    expect(held.velocity[2]).toBeCloseTo(0, 6);
  });

  it("adds a legacy shape's translation to its offset and turns both", () => {
    const held = offsetOf({
      kind: "legacy",
      offset: flat(1, 0, 0),
      translation: flat(1, 0, 0),
      angles: [flat(180)],
      axes: [[0, 1, 0]],
    });

    expect(held.at[0]).toBeCloseTo(-2, 6);
    expect(held.at[2]).toBeCloseTo(0, 6);
  });

  it("composes a legacy shape's turns in list order and ignores an axis with no angle", () => {
    const held = offsetOf({
      kind: "legacy",
      offset: flat(0, 0, 0),
      translation: flat(0, 0, 0),
      angles: [flat(90)],
      axes: [
        [0, 0, 1],
        [0, 1, 0],
      ],
    });

    expect(held.velocity[1]).toBeCloseTo(1, 6);
  });

  it("lands a surface sphere on its radius and sends the velocity outward", () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const held = offsetOf({ kind: "sphere", radius: 50, volume: false }, seed);
      expect(length(held.at)).toBeCloseTo(50, 3);

      const dot =
        held.at[0] * held.velocity[0] +
        held.at[1] * held.velocity[1] +
        held.at[2] * held.velocity[2];
      expect(dot / (length(held.at) * length(held.velocity))).toBeCloseTo(1, 4);
    }
  });

  it("fills a volume sphere inside its radius", () => {
    let inside = false;
    for (let seed = 1; seed < 20; seed += 1) {
      const held = offsetOf({ kind: "sphere", radius: 50, volume: true }, seed);
      expect(length(held.at)).toBeLessThanOrEqual(50.001);
      if (length(held.at) < 49) inside = true;
    }
    expect(inside).toBe(true);
  });

  /* A small seed's first draws are small, so the spread is looked for across wide ones. */
  const WIDE = 0x1000193;

  it("lands a surface cylinder on its radius, its height running up from the emitter", () => {
    let high = false;
    for (let seed = WIDE; seed < WIDE * 20; seed += WIDE) {
      const held = offsetOf({ kind: "cylinder", radius: 10, height: 4, volume: false }, seed);
      expect(Math.hypot(held.at[0], held.at[2])).toBeCloseTo(10, 3);
      expect(held.at[1]).toBeGreaterThanOrEqual(0);
      expect(held.at[1]).toBeLessThanOrEqual(4.001);
      if (held.at[1] > 2) high = true;
    }
    expect(high).toBe(true);
  });

  it("fills a volume cylinder across its whole radius, piling up on the axis", () => {
    let inside = false;
    for (let seed = WIDE; seed < WIDE * 20; seed += WIDE) {
      const held = offsetOf({ kind: "cylinder", radius: 10, height: 4, volume: true }, seed);
      expect(Math.hypot(held.at[0], held.at[2])).toBeLessThanOrEqual(10.001);
      expect(held.at[1]).toBeGreaterThanOrEqual(0);
      if (Math.hypot(held.at[0], held.at[2]) < 9) inside = true;
    }
    expect(inside).toBe(true);
  });

  it("lands a surface box on one of its side faces", () => {
    const faces = new Set<string>();
    for (let seed = 1; seed < 40; seed += 1) {
      const held = offsetOf({ kind: "box", size: [1, 2, 3], volume: false }, seed);
      expect(Math.max(Math.abs(held.at[0]), Math.abs(held.at[2]))).toBeCloseTo(3, 3);
      faces.add(
        Math.abs(held.at[0]) > 2.99 ? `x${Math.sign(held.at[0])}` : `z${Math.sign(held.at[2])}`,
      );
    }
    expect(faces.size).toBe(4);
  });

  it("fills a volume box inside its size and turns nothing", () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const held = offsetOf({ kind: "box", size: [1, 2, 3], volume: true }, seed);
      expect(Math.abs(held.at[0])).toBeLessThanOrEqual(1.001);
      expect(Math.abs(held.at[1])).toBeLessThanOrEqual(2.001);
      expect(Math.abs(held.at[2])).toBeLessThanOrEqual(3.001);
      expect(held.turned).toBe(false);
    }
  });

  it("draws the same placement from the same seed", () => {
    const shape: SpawnShape = { kind: "sphere", radius: 7, volume: true };

    expect(offsetOf(shape, 5)).toEqual(offsetOf(shape, 5));
    expect(offsetOf(shape, 5)).not.toEqual(offsetOf(shape, 6));
  });
});
