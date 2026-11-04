import { describe, expect, it } from "vitest";

import { BufferError } from "../../utils/bufferReader";
import {
  applyOverlays,
  cellAt,
  cellCenter,
  cellCoords,
  cellIndex,
  type NavGridOverlay,
  readNavGridBuffer,
  readNavGridFile,
  readNavGridOverlayBuffer,
  regionTagIndex,
  sampledHeightAt,
} from "../navGridBuffer";

const GRASS = 0x0001;
const WALL = 0x0002;

/** Writes little-endian values in order into a buffer of `size` bytes. */
function writer(size: number) {
  const bytes = new ArrayBuffer(size);
  const view = new DataView(bytes);
  let at = 0;

  const step = (width: number, write: (at: number) => void) => {
    write(at);
    at += width;
  };

  return {
    bytes,
    u16: (value: number) => step(2, (offset) => view.setUint16(offset, value, true)),
    u32: (value: number) => step(4, (offset) => view.setUint32(offset, value, true)),
    i32: (value: number) => step(4, (offset) => view.setInt32(offset, value, true)),
    f32: (value: number) => step(4, (offset) => view.setFloat32(offset, value, true)),
    pad: () => {
      at = Math.ceil(at / 4) * 4;
    },
    get at() {
      return at;
    },
  };
}

/**
 * Writes the `LTKN` buffer of the `ltk_navgrid` test grid, off the layout of section 4 of
 * `docs/plans/navgrid-guides.md`.
 *
 * Min (0, 0, 0), max (100, 0, 50), cells 50 units wide and 1.5 high, 3 x 2 samples 50 units
 * apart with sample `(i, j)` at height `i + 3 * j`. Cell `i` has flags `[0x0442, 0x8001][i % 2]`
 * and region tags `0x87654321 + i`. Group `g` is named `g + 1` and its tag `t` is named
 * `g * 100 + t`. Hand-written rather than shared with the reader, so that the two can disagree.
 */
function writeGrid(xCells: number, yCells: number): ArrayBuffer {
  const cells = xCells * yCells;
  const flagBytes = Math.ceil(cells / 2) * 4;
  const out = writer(604 + flagBytes + cells * 8 + 6 * 4);

  [0x4e4b544c, 1, xCells, yCells].forEach(out.u32);
  [50, 0, 0, 0, 100, 0, 50].forEach(out.f32);
  [3, 2].forEach(out.u32);
  [50, 50].forEach(out.f32);
  for (let group = 0; group < 8; group += 1) {
    out.u32(group + 1);
  }
  for (let group = 0; group < 8; group += 1) {
    for (let tag = 0; tag < 16; tag += 1) {
      out.u32(group * 100 + tag);
    }
  }

  for (let cell = 0; cell < cells; cell += 1) {
    out.u16([0x0442, 0x8001][cell % 2]);
  }
  out.pad();
  for (let cell = 0; cell < cells; cell += 1) {
    out.u32(0x87654321 + cell);
  }
  for (let cell = 0; cell < cells; cell += 1) {
    out.f32(1.5);
  }
  for (let sample = 0; sample < 6; sample += 1) {
    out.f32(sample);
  }

  expect(out.at).toBe(out.bytes.byteLength);
  return out.bytes;
}

/** One rectangle of an `LTKO` buffer. */
interface WrittenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  values: number[];
}

/** Writes an `LTKO` buffer of `kind` 1 (flags) or 2 (region tags), off section 4 of the plan. */
function writeOverlay(kind: 1 | 2, rects: WrittenRect[]): ArrayBuffer {
  const valueBytes = (count: number) => (kind === 1 ? Math.ceil(count / 2) * 4 : count * 4);
  const size = 16 + rects.reduce((sum, rect) => sum + 16 + valueBytes(rect.values.length), 0);
  const out = writer(size);

  [0x4f4b544c, 1, kind, rects.length].forEach(out.u32);
  for (const rect of rects) {
    out.i32(rect.x);
    out.i32(rect.y);
    out.u32(rect.width);
    out.u32(rect.height);
    rect.values.forEach(kind === 1 ? out.u16 : out.u32);
    out.pad();
  }

  expect(out.at).toBe(size);
  return out.bytes;
}

/** Returns a flag overlay of `rects`, each value array taken as it is. */
function flagOverlay(...rects: WrittenRect[]): NavGridOverlay {
  return {
    kind: "flags",
    rects: rects.map((rect) => ({ ...rect, values: Uint16Array.from(rect.values) })),
  };
}

describe("readNavGridBuffer", () => {
  it("reads the header and every block", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(grid).toMatchObject({
      xCells: 2,
      yCells: 1,
      cellSize: 50,
      min: [0, 0, 0],
      max: [100, 0, 50],
      xSamples: 3,
      ySamples: 2,
      xSpacing: 50,
      ySpacing: 50,
    });
    expect(grid.groupNames[7]).toBe(8);
    expect(grid.tagNames[7 * 16 + 15]).toBe(715);
    expect(Array.from(grid.flags)).toEqual([0x0442, 0x8001]);
    expect(Array.from(grid.regionTags)).toEqual([0x87654321, 0x87654322]);
    expect(Array.from(grid.heights)).toEqual([1.5, 1.5]);
    expect(Array.from(grid.samples)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reads the blocks after the padding if the flag count is odd", () => {
    const grid = readNavGridBuffer(writeGrid(3, 1));

    expect(Array.from(grid.flags)).toEqual([0x0442, 0x8001, 0x0442]);
    expect(Array.from(grid.regionTags)).toEqual([0x87654321, 0x87654322, 0x87654323]);
    expect(Array.from(grid.samples)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("returns views over the received bytes", () => {
    const bytes = writeGrid(2, 1);
    const grid = readNavGridBuffer(bytes);

    expect(grid.flags.buffer).toBe(bytes);
    expect(grid.samples.buffer).toBe(bytes);
  });

  it("throws if the buffer is shorter than its counts", () => {
    const bytes = writeGrid(2, 1);

    expect(() => readNavGridBuffer(bytes.slice(0, bytes.byteLength - 4))).toThrow(BufferError);
  });

  it("throws if the magic is not LTKN", () => {
    const bytes = writeGrid(2, 1);
    new DataView(bytes).setUint32(0, 0x4f4b544c, true);

    expect(() => readNavGridBuffer(bytes)).toThrow("Not a navigation grid buffer: 0x4f4b544c");
  });

  it("throws if the version is not 1", () => {
    const bytes = writeGrid(2, 1);
    new DataView(bytes).setUint32(4, 2, true);

    expect(() => readNavGridBuffer(bytes)).toThrow(BufferError);
  });
});

describe("readNavGridOverlayBuffer", () => {
  it("reads flag rectangles after the padding of an odd value count", () => {
    const overlay = readNavGridOverlayBuffer(
      writeOverlay(1, [
        { x: -1, y: 0, width: 1, height: 1, values: [7] },
        { x: 1, y: 2, width: 2, height: 1, values: [3, 4] },
      ]),
    );

    expect(overlay.kind).toBe("flags");
    expect(overlay.rects.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
      [-1, 0, 1, 1],
      [1, 2, 2, 1],
    ]);
    expect(overlay.rects[0].values).toBeInstanceOf(Uint16Array);
    expect(Array.from(overlay.rects[0].values)).toEqual([7]);
    expect(Array.from(overlay.rects[1].values)).toEqual([3, 4]);
  });

  it("reads region tag rectangles", () => {
    const overlay = readNavGridOverlayBuffer(
      writeOverlay(2, [{ x: 1, y: 0, width: 2, height: 1, values: [0xdeadbeef, 1] }]),
    );

    expect(overlay.kind).toBe("regions");
    expect(overlay.rects[0].values).toBeInstanceOf(Uint32Array);
    expect(Array.from(overlay.rects[0].values)).toEqual([0xdeadbeef, 1]);
  });

  it("reads no rectangles if the overlay has none", () => {
    expect(readNavGridOverlayBuffer(writeOverlay(2, []))).toEqual({ kind: "regions", rects: [] });
  });

  it("throws if the kind is not 1 or 2", () => {
    const bytes = writeOverlay(2, []);
    new DataView(bytes).setUint32(8, 3, true);

    expect(() => readNavGridOverlayBuffer(bytes)).toThrow(BufferError);
  });

  it("throws if the magic is not LTKO", () => {
    expect(() => readNavGridOverlayBuffer(writeGrid(2, 1))).toThrow(BufferError);
  });
});

describe("readNavGridFile", () => {
  it("reads a grid or an overlay by the magic", () => {
    expect(readNavGridFile(writeGrid(2, 1)).kind).toBe("grid");
    expect(readNavGridFile(writeOverlay(1, [])).kind).toBe("overlay");
  });

  it("throws if the magic is neither LTKN nor LTKO", () => {
    const bytes = writeGrid(2, 1);
    new DataView(bytes).setUint32(0, 0x4c4b544c, true);

    expect(() => readNavGridFile(bytes)).toThrow(BufferError);
  });
});

describe("applyOverlays", () => {
  it("skips the values of a rectangle outside the grid", () => {
    const base = readNavGridBuffer(writeGrid(2, 1));
    const grid = applyOverlays(base, [
      flagOverlay(
        { x: -1, y: 0, width: 2, height: 1, values: [GRASS, WALL] },
        { x: 1, y: 0, width: 2, height: 2, values: [0, 0, 0, 0] },
      ),
    ]);

    expect(Array.from(grid.flags)).toEqual([WALL, 0]);
  });

  it("writes the later rectangle if two rectangles overlap", () => {
    const base = readNavGridBuffer(writeGrid(2, 1));
    const grid = applyOverlays(base, [
      flagOverlay({ x: 0, y: 0, width: 2, height: 1, values: [GRASS, GRASS] }),
      flagOverlay({ x: 1, y: 0, width: 1, height: 1, values: [WALL] }),
    ]);

    expect(Array.from(grid.flags)).toEqual([GRASS, WALL]);
  });

  it("skips an incomplete row and a zero width", () => {
    const base = readNavGridBuffer(writeGrid(2, 1));
    const grid = applyOverlays(base, [
      flagOverlay(
        { x: 0, y: 0, width: 0, height: 1, values: [WALL] },
        { x: 0, y: 0, width: 2, height: 1, values: [WALL] },
      ),
    ]);

    expect(Array.from(grid.flags)).toEqual([0x0442, 0x8001]);
  });

  it("replaces the region tags of the cells that a region overlay covers", () => {
    const base = readNavGridBuffer(writeGrid(2, 1));
    const grid = applyOverlays(base, [
      readNavGridOverlayBuffer(
        writeOverlay(2, [{ x: 1, y: 0, width: 1, height: 1, values: [0xdeadbeef] }]),
      ),
    ]);

    expect(Array.from(grid.regionTags)).toEqual([0x87654321, 0xdeadbeef]);
    expect(Array.from(grid.flags)).toEqual([0x0442, 0x8001]);
  });

  it("copies the flags and region tags and shares the other arrays with the base", () => {
    const base = readNavGridBuffer(writeGrid(2, 1));
    const grid = applyOverlays(base, [
      flagOverlay({ x: 0, y: 0, width: 1, height: 1, values: [WALL] }),
    ]);

    expect(Array.from(base.flags)).toEqual([0x0442, 0x8001]);
    expect(grid.flags).not.toBe(base.flags);
    expect(grid.regionTags).not.toBe(base.regionTags);
    expect(grid.heights).toBe(base.heights);
    expect(grid.samples).toBe(base.samples);
  });
});

describe("cellIndex", () => {
  it("returns the index of a cell and null if the cell is outside the grid", () => {
    const grid = readNavGridBuffer(writeGrid(2, 3));

    expect(cellIndex(grid, 1, 2)).toBe(5);
    expect(cellIndex(grid, 2, 0)).toBeNull();
    expect(cellIndex(grid, -1, 0)).toBeNull();
  });
});

describe("cellCoords", () => {
  it("returns the coordinates of an index and null if the index is outside the cells", () => {
    const grid = readNavGridBuffer(writeGrid(2, 3));

    expect(cellCoords(grid, 5)).toEqual([1, 2]);
    expect(cellCoords(grid, 6)).toBeNull();
  });
});

describe("cellCenter", () => {
  it("returns the center of a cell at the cell height", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(cellCenter(grid, 1, 0)).toEqual([75, 1.5, 25]);
  });

  it("returns null if the cell is outside the grid", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(cellCenter(grid, 2, 0)).toBeNull();
  });
});

describe("cellAt", () => {
  it("returns the cell that contains a position", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(cellAt(grid, 75, 25)).toEqual([1, 0]);
    expect(cellAt(grid, 0, 49.9)).toEqual([0, 0]);
  });

  it("returns null if the position is outside the grid or not a number", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(cellAt(grid, 100, 0)).toBeNull();
    expect(cellAt(grid, -0.1, 0)).toBeNull();
    expect(cellAt(grid, Number.NaN, 0)).toBeNull();
  });
});

describe("sampledHeightAt", () => {
  it("interpolates the samples around a position", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(sampledHeightAt(grid, 0, 0)).toBe(0);
    expect(sampledHeightAt(grid, 25, 25)).toBe(2);
    expect(sampledHeightAt(grid, 75, 0)).toBe(1.5);
  });

  it("returns the last sample if the position is at the far edge", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(sampledHeightAt(grid, 100, 50)).toBe(5);
  });

  it("returns null if the position is outside the samples or not a number", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(sampledHeightAt(grid, 100.1, 0)).toBeNull();
    expect(sampledHeightAt(grid, 0, -0.1)).toBeNull();
    expect(sampledHeightAt(grid, Number.NaN, 0)).toBeNull();
  });
});

describe("regionTagIndex", () => {
  it("returns the 4-bit tag index of a group from the low bits up", () => {
    const grid = readNavGridBuffer(writeGrid(2, 1));

    expect(regionTagIndex(grid, 1, 0)).toBe(2);
    expect(regionTagIndex(grid, 1, 7)).toBe(8);
  });
});
