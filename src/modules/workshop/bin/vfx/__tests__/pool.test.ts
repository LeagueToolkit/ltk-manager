import { describe, expect, it } from "vitest";

import { createPool, type Pool, retire, spawn } from "../pool";

function fill(pool: Pool, count: number): void {
  for (let at = 0; at < count; at += 1) spawn(pool, at, at, 1 + at, at / 10);
}

describe("createPool", () => {
  it("sizes every array to the capacity, three wide for a vector and four for a colour", () => {
    const pool = createPool(4);

    expect(pool.count).toBe(0);
    expect(pool.emitter).toHaveLength(4);
    expect(pool.birthTime).toHaveLength(4);
    expect(pool.position).toHaveLength(12);
    expect(pool.velocity).toHaveLength(12);
    expect(pool.birthScale).toHaveLength(12);
    expect(pool.birthColor).toHaveLength(16);
  });
});

describe("spawn", () => {
  it("numbers each particle in birth order, and keeps counting past a retire", () => {
    const pool = createPool(4);
    fill(pool, 3);
    retire(pool, 0);
    spawn(pool, 9, 5, 1, 0);

    expect(Array.from(pool.serial.subarray(0, 3))).toEqual([2, 1, 3]);
    expect(pool.born).toBe(4);
  });

  it("packs the live particles at the front, in the order they were born", () => {
    const pool = createPool(8);

    expect(spawn(pool, 3, 1.5, 2, 0.25)).toBe(0);
    expect(spawn(pool, 4, 1.5, 2, 0.75)).toBe(1);
    expect(pool.count).toBe(2);
    expect(Array.from(pool.emitter.subarray(0, 2))).toEqual([3, 4]);
    expect(pool.birthTime[0]).toBeCloseTo(1.5, 6);
    expect(pool.roll[1]).toBeCloseTo(0.75, 6);
  });

  it("starts a particle at the origin, at rest, at the identity of both products", () => {
    const pool = createPool(2);
    const at = spawn(pool, 0, 0, 1, 0);

    expect(at).toBe(0);
    expect(Array.from(pool.position.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(pool.velocity.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(pool.birthScale.subarray(0, 3))).toEqual([1, 1, 1]);
    expect(Array.from(pool.birthColor.subarray(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(pool.frame.subarray(0, 9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("scrubs the slot a retired particle left behind", () => {
    const pool = createPool(2);
    spawn(pool, 0, 0, 1, 0);
    pool.position.set([5, 5, 5], 0);
    retire(pool, 0);

    expect(spawn(pool, 0, 0, 1, 0)).toBe(0);
    expect(Array.from(pool.position.subarray(0, 3))).toEqual([0, 0, 0]);
  });

  it("refuses a spawn once the pool is full", () => {
    const pool = createPool(2);
    fill(pool, 2);

    expect(spawn(pool, 9, 0, 1, 0)).toBeNull();
    expect(pool.count).toBe(2);
  });
});

describe("retire", () => {
  it("swaps the last live particle into the slot it frees", () => {
    const pool = createPool(4);
    fill(pool, 4);
    retire(pool, 1);

    expect(pool.count).toBe(3);
    expect(Array.from(pool.emitter.subarray(0, 3))).toEqual([0, 3, 2]);
    expect(pool.lifetime[1]).toBeCloseTo(4, 6);
    expect(pool.roll[1]).toBeCloseTo(0.3, 6);
  });

  it("carries every array of the swapped particle across, one index per particle", () => {
    const pool = createPool(2);
    fill(pool, 2);
    pool.position.set([1, 2, 3], 3);
    pool.velocity.set([4, 5, 6], 3);
    pool.birthScale.set([7, 8, 9], 3);
    pool.birthColor.set([0.1, 0.2, 0.3, 0.4], 4);
    pool.frame.set([0, 0, 1, 0, 1, 0, -1, 0, 0], 9);
    retire(pool, 0);

    expect(Array.from(pool.position.subarray(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(pool.velocity.subarray(0, 3))).toEqual([4, 5, 6]);
    expect(Array.from(pool.birthScale.subarray(0, 3))).toEqual([7, 8, 9]);
    expect(Array.from(pool.frame.subarray(0, 9))).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    expect(Array.from(pool.birthColor.subarray(0, 4)).map((c) => Math.round(c * 10))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("drops the last particle without swapping anything into it", () => {
    const pool = createPool(3);
    fill(pool, 3);
    retire(pool, 2);

    expect(pool.count).toBe(2);
    expect(Array.from(pool.emitter.subarray(0, 2))).toEqual([0, 1]);
  });

  it("leaves the pool alone for an index no live particle holds", () => {
    const pool = createPool(3);
    fill(pool, 2);
    retire(pool, 2);
    retire(pool, -1);

    expect(pool.count).toBe(2);
  });
});
