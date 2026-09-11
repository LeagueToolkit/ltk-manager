import { describe, expect, it } from "vitest";

import {
  alongInto,
  AXIS,
  axisInto,
  flightInto,
  mirrorInto,
  multiplyInto,
  standingInto,
  turnInto,
  unscaleInto,
  yawInto,
} from "../basis";

function axisOf(degrees: number[], axis: number, roll = 0): number[] {
  const basis = new Float32Array(9);
  standingInto(new Float32Array(degrees), 0, roll, basis);
  const out = new Float32Array(3);
  axisInto(basis, axis, out, 0);
  return rounded(out);
}

function rounded(values: ArrayLike<number>): number[] {
  return Array.from(values).map((value) => Math.round(value * 1e6) / 1e6 + 0);
}

/** `Rz . Rx . Ry` over the engine's rows, built one factor at a time and transposed. */
function meshByHand(degrees: number[]): number[] {
  const rad = degrees.map((held) => (held * Math.PI) / 180);
  const [x, y, z] = rad as [number, number, number];
  const rx = [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)];
  const ry = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const rz = [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1];

  const product = new Float32Array(9);
  multiplyInto(new Float32Array(rx), new Float32Array(rz), product);
  multiplyInto(new Float32Array(ry), product, product);
  return rounded(product);
}

describe("standingInto", () => {
  it("composes the three turns the way Mtx44_FromEulerZXY does", () => {
    for (const degrees of [
      [0, 0, 0],
      [90, 0, 0],
      [0, 90, 0],
      [0, 0, 90],
      [30, 45, 60],
      [-20, 110, 250],
    ]) {
      const built = standingInto(new Float32Array(degrees), 0, 0, new Float32Array(9));
      expect(rounded(built)).toEqual(meshByHand(degrees));
    }
  });

  it("adds the roll a simple emitter carries to the turn about z", () => {
    const rolled = standingInto(new Float32Array([0, 0, 20]), 0, 25, new Float32Array(9));
    const whole = standingInto(new Float32Array([0, 0, 45]), 0, 0, new Float32Array(9));

    expect(rounded(rolled)).toEqual(rounded(whole));
  });
});

describe("alongInto", () => {
  it("sends local z along the direction and holds the other two square to it", () => {
    const basis = alongInto(new Float32Array([0, 0, 5]), 0, new Float32Array(9));
    const out = new Float32Array(3);

    axisInto(basis, AXIS.z, out, 0);
    expect(rounded(out)).toEqual([0, 0, 1]);
    axisInto(basis, AXIS.x, out, 0);
    expect(rounded(out)).toEqual([1, 0, 0]);
    axisInto(basis, AXIS.y, out, 0);
    expect(rounded(out)).toEqual([0, 1, 0]);
  });

  it("stands on the world's x where the direction is the up itself, and still for no length", () => {
    const up = alongInto(new Float32Array([0, 4, 0]), 0, new Float32Array(9));
    const out = new Float32Array(3);
    axisInto(up, AXIS.z, out, 0);
    expect(rounded(out)).toEqual([0, 1, 0]);
    axisInto(up, AXIS.x, out, 0);
    expect(rounded(out)).toEqual([1, 0, 0]);

    expect(rounded(alongInto(new Float32Array([0, 0, 0]), 0, new Float32Array(9)))).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
  });
});

describe("yawInto", () => {
  it("stands on the world's axes facing forward", () => {
    expect(rounded(yawInto([0, 0, 1], new Float32Array(9)))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("sends local z onto the facing and keeps the up", () => {
    const basis = yawInto([1, 0, 0], new Float32Array(9));
    const out = new Float32Array(3);

    axisInto(basis, AXIS.z, out, 0);
    expect(rounded(out)).toEqual([1, 0, 0]);
    axisInto(basis, AXIS.x, out, 0);
    expect(rounded(out)).toEqual([0, 0, -1]);
    axisInto(basis, AXIS.y, out, 0);
    expect(rounded(out)).toEqual([0, 1, 0]);
  });

  it("lays the facing flat and stands still for one with no reach in the plane", () => {
    const climbing = yawInto([3, 5, 4], new Float32Array(9));
    const flat = yawInto([3, 0, 4], new Float32Array(9));
    expect(rounded(climbing)).toEqual(rounded(flat));
    expect(rounded(yawInto([0, 1, 0], new Float32Array(9)))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe("flightInto", () => {
  it("sends local y along the flight, x to its right and z down", () => {
    const basis = flightInto([1, 0, 0], new Float32Array(9));
    const out = new Float32Array(3);

    axisInto(basis, AXIS.y, out, 0);
    expect(rounded(out)).toEqual([1, 0, 0]);
    axisInto(basis, AXIS.x, out, 0);
    expect(rounded(out)).toEqual([0, 0, -1]);
    axisInto(basis, AXIS.z, out, 0);
    expect(rounded(out)).toEqual([0, -1, 0]);
  });

  it("is the forward yaw turned a right angle about x, and flies forward with no reach", () => {
    const forward = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    expect(rounded(flightInto([0, 0, 1], new Float32Array(9)))).toEqual(forward);
    expect(rounded(flightInto([0, 1, 0], new Float32Array(9)))).toEqual(forward);
  });
});

describe("multiplyInto and turnInto", () => {
  it("composes right to left, reading the left operand from an offset", () => {
    const stack = new Float32Array(18);
    yawInto([1, 0, 0], stack.subarray(9));
    const spin = standingInto(new Float32Array([0, 0, 90]), 0, 0, new Float32Array(9));
    const out = new Float32Array(9);

    multiplyInto(stack, spin, out, 9);

    const vector = new Float32Array([0, 1, 0, 1, 0, 0]);
    turnInto(out, vector, 3);
    /* Local x turns onto y about z, then y stays the world's up under the yaw. */
    expect(rounded(vector.subarray(3))).toEqual([0, 1, 0]);
    turnInto(stack, vector, 0, 9);
    expect(rounded(vector.subarray(0, 3))).toEqual([0, 1, 0]);
  });
});

describe("mirrorInto", () => {
  it("flips the cells that touch the mirrored axis once, and leaves the rest", () => {
    const basis = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = new Float32Array(9);

    mirrorInto(basis, 0, out, 0);

    expect(Array.from(out)).toEqual([1, -2, -3, -4, 5, 6, -7, 8, 9]);
  });
});

describe("standingInto", () => {
  it("stands on the world's axes at no rotation", () => {
    expect(axisOf([0, 0, 0], AXIS.x)).toEqual([1, 0, 0]);
    expect(axisOf([0, 0, 0], AXIS.y)).toEqual([0, 1, 0]);
    expect(axisOf([0, 0, 0], AXIS.z)).toEqual([0, 0, 1]);
  });

  it("turns x onto y a quarter turn about z", () => {
    expect(axisOf([0, 0, 90], AXIS.x)).toEqual([0, 1, 0]);
  });

  it("turns z onto x a quarter turn about y", () => {
    expect(axisOf([0, 90, 0], AXIS.z)).toEqual([1, 0, 0]);
    expect(axisOf([0, 90, 0], AXIS.x)).toEqual([0, 0, -1]);
  });

  it("rolls about z innermost, then pitches about x", () => {
    expect(axisOf([90, 0, 90], AXIS.y)).toEqual([-1, 0, 0]);
  });

  it("adds the roll to the turn about z", () => {
    expect(axisOf([0, 0, 45], AXIS.x, 45)).toEqual([0, 1, 0]);
  });
});

describe("unscaleInto", () => {
  const scale = new Float32Array(3);

  it("takes each column's length out of the basis and reports it", () => {
    const out = new Float32Array(9);

    unscaleInto(new Float32Array([0, -2, 0, 1, 0, 0, 0, 0, 3]), 0, out, 0, scale);

    expect(rounded(out)).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(rounded(scale)).toEqual([1, 2, 3]);
  });

  it("leaves a flattened axis on the identity's own column", () => {
    const out = new Float32Array(9);

    unscaleInto(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 1]), 0, out, 0, scale);

    expect(rounded(out)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rounded(scale)).toEqual([1, 1, 1]);
  });

  it("writes over the basis it read", () => {
    const held = new Float32Array([4, 0, 0, 0, 4, 0, 0, 0, 4]);

    unscaleInto(held, 0, held, 0, scale);

    expect(rounded(held)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(rounded(scale)).toEqual([4, 4, 4]);
  });
});
