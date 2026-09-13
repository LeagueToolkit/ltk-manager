import { describe, expect, it } from "vitest";

import type { DrawnEmitter } from "../definitions";
import { DRAG_MOTION } from "../enums";
import type { EmitterModel, SystemModel } from "../model";
import { flightPath, type RigModel } from "../rig";
import { definitionBounds, rigGround, STANDING_REACH } from "../systemBounds";
import { emitterOf } from "./emitterFixture";

/** A rig standing still, a champion's half height off the ground. */
const STILL: RigModel = { motion: { kind: "still" }, life: "once", height: 100 };

/** A rig flying 1200 units across the origin at that height. */
const FLYING: RigModel = { motion: flightPath(1200, 800), life: "loop", height: 100 };

function systemOf(...emitters: EmitterModel[]): SystemModel {
  return {
    entry: null,
    name: null,
    emitters,
    transform: null,
    dragMotion: DRAG_MOTION.stepped,
    buildUpTime: 0,
  };
}

function drawnOf(emitter: EmitterModel, path = ""): DrawnEmitter {
  return { key: `${path}:${emitter.index}`, emitter, path, root: emitter.index, rank: 0 };
}

describe("definitionBounds", () => {
  it("frames a champion about a still rig, off the ground by the rig's height", () => {
    expect(definitionBounds(systemOf(), [], STILL)).toEqual({
      min: [-STANDING_REACH, 0, -STANDING_REACH],
      max: [STANDING_REACH, 200, STANDING_REACH],
    });
  });

  it("spans a flying rig from one end of its path to the other", () => {
    const bounds = definitionBounds(systemOf(), [], FLYING);

    expect(bounds.min[0]).toBe(-600 - STANDING_REACH);
    expect(bounds.max[0]).toBe(600 + STANDING_REACH);
    expect(bounds.max[1]).toBe(200);
  });

  it("reaches an emitter's spawn box where its offset stands it, across the mirrored axis", () => {
    const boxed = emitterOf(0, {
      translationOverride: [300, 0, 0],
      shape: { kind: "box", size: [50, 10, 20], volume: true },
    });

    const bounds = definitionBounds(systemOf(boxed), [drawnOf(boxed)], STILL);

    expect(bounds.min[0]).toBe(-350);
    expect(bounds.max[0]).toBe(STANDING_REACH);
  });

  it("is the same box at any moment of the run", () => {
    const boxed = emitterOf(0, { shape: { kind: "sphere", radius: 400, volume: false } });
    const drawn = [drawnOf(boxed)];

    expect(definitionBounds(systemOf(boxed), drawn, STILL)).toEqual(
      definitionBounds(systemOf(boxed), drawn, STILL),
    );
    expect(definitionBounds(systemOf(boxed), drawn, STILL).max[0]).toBe(400);
  });

  it("leaves out a disabled emitter and one of a child set", () => {
    const off = emitterOf(0, {
      disabled: true,
      shape: { kind: "sphere", radius: 900, volume: false },
    });
    const child = emitterOf(0, { shape: { kind: "sphere", radius: 900, volume: false } });

    const bounds = definitionBounds(systemOf(off), [drawnOf(off), drawnOf(child, "0:0")], STILL);

    expect(bounds.max[0]).toBe(STANDING_REACH);
  });
});

describe("rigGround", () => {
  it("stands under a still rig at the origin", () => {
    expect(rigGround(systemOf(), STILL)).toEqual([0, 0, 0]);
  });

  it("stands where a flying rig starts, on the ground and across the mirrored axis", () => {
    expect(rigGround(systemOf(), FLYING)).toEqual([600, 0, 0]);
  });
});
