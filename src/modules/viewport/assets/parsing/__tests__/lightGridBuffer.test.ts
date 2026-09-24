import { describe, expect, it } from "vitest";

import { lightFrom, lightGridUniforms } from "../../../character/utils/lightGridShading";
import { BufferError } from "../../utils/bufferReader";
import { CUBE_FACES, cellAt, readLightGridBuffer } from "../lightGridBuffer";

/**
 * Writes the buffer `preview/light_grid.rs` writes, off the layout its module doc states.
 *
 * Every face of cell `c` is `r = c`, `g = face`, `b = 0`. Hand-written rather than shared
 * with the reader, so that the two can disagree.
 */
function write(width: number, height: number, scale = 1): ArrayBuffer {
  const bytes = new ArrayBuffer(32 + width * height * CUBE_FACES * 4);
  const view = new DataView(bytes);
  [0x4c4b544c, 1, width, height].forEach((word, at) => view.setUint32(at * 4, word, true));
  [1000, 2000, scale, 0.25].forEach((value, at) => view.setFloat32(16 + at * 4, value, true));
  const cells = new Uint8Array(bytes, 32);
  for (let cell = 0; cell < width * height; cell += 1) {
    for (let face = 0; face < CUBE_FACES; face += 1) {
      cells.set([cell, face, 0, 255], (cell * CUBE_FACES + face) * 4);
    }
  }
  return bytes;
}

describe("readLightGridBuffer", () => {
  it("reads the header and every cell", () => {
    const grid = readLightGridBuffer(write(4, 2));
    expect(grid).toMatchObject({
      width: 4,
      height: 2,
      extentX: 1000,
      extentZ: 2000,
    });
    expect(grid.fullBright).toBe(0.25);
    expect(grid.cells.length).toBe(4 * 2 * CUBE_FACES * 4);
  });

  it("refuses a buffer shorter than its cells", () => {
    expect(() => readLightGridBuffer(write(4, 2).slice(0, 40))).toThrow(BufferError);
  });
});

describe("cellAt", () => {
  it("picks the cell under a point and clamps one off the grid", () => {
    const grid = readLightGridBuffer(write(4, 2));
    expect(cellAt(grid, 260, 1500)).toBe(1 + 1 * 4);
    expect(cellAt(grid, -50, -50)).toBe(0);
    expect(cellAt(grid, 5000, 5000)).toBe(3 + 1 * 4);
  });
});

describe("lightFrom", () => {
  it("fills the scene's cube with the engine's X faces swapped across the mirror", () => {
    const grid = readLightGridBuffer(write(4, 2, 2));
    const uniforms = lightGridUniforms();
    /* Scene X -260 is engine X 260, the second column. */
    expect(lightFrom(grid, -260, 0, uniforms)).toBe(1);
    const cube = uniforms.cube.value;
    expect(cube[0] * 255).toBeCloseTo(2 * 1, 5);
    expect(cube[1] * 255).toBeCloseTo(2 * 1, 5);
    expect(cube[4] * 255).toBeCloseTo(0, 5);
    expect(cube[3 * 2 + 1] * 255).toBeCloseTo(2 * 2, 5);
    expect(uniforms.on.value).toBe(1);
  });

  it("turns the grid off without one", () => {
    const uniforms = lightGridUniforms();
    uniforms.on.value = 1;
    lightFrom(null, 0, 0, uniforms);
    expect(uniforms.on.value).toBe(0);
  });
});
