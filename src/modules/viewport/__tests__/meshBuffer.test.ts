import { describe, expect, it } from "vitest";

import { BufferError } from "../bufferReader";
import { readMeshBuffer } from "../meshBuffer";

const MAGIC = 0x474b544c;

interface Held {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  skinIndices?: number[];
  skinWeights?: number[];
  indices: number[];
  ranges?: { name: string; startIndex: number; indexCount: number }[];
  version?: number;
  magic?: number;
}

/** The buffer `mesh.rs` writes, built here so both halves of the layout are asserted. */
function buffer(held: Held): ArrayBuffer {
  const ranges = held.ranges ?? [];
  const names = ranges.map((range) => new TextEncoder().encode(range.name));
  const vertexCount = held.positions.length / 3;
  const skinned = held.skinIndices !== undefined && held.skinWeights !== undefined;

  const bytes =
    6 * 4 +
    held.positions.length * 4 +
    (held.normals?.length ?? 0) * 4 +
    (held.uvs?.length ?? 0) * 4 +
    (held.skinIndices?.length ?? 0) +
    (held.skinWeights?.length ?? 0) * 4 +
    held.indices.length * 4 +
    names.reduce((sum, name) => sum + 12 + name.length, 0);

  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  let at = 0;
  const u32 = (value: number) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const f32 = (value: number) => {
    view.setFloat32(at, value, true);
    at += 4;
  };
  const u8 = (value: number) => {
    view.setUint8(at, value);
    at += 1;
  };

  u32(held.magic ?? MAGIC);
  u32(held.version ?? 2);
  u32((held.normals ? 1 : 0) | (held.uvs ? 2 : 0) | (skinned ? 4 : 0));
  u32(vertexCount);
  u32(held.indices.length);
  u32(ranges.length);

  for (const value of held.positions) f32(value);
  for (const value of held.normals ?? []) f32(value);
  for (const value of held.uvs ?? []) f32(value);
  for (const value of held.skinIndices ?? []) u8(value);
  for (const value of held.skinWeights ?? []) f32(value);
  for (const value of held.indices) u32(value);

  ranges.forEach((range, slot) => {
    const name = names[slot];
    u32(name.length);
    for (const byte of name) u8(byte);
    u32(range.startIndex);
    u32(range.indexCount);
  });

  return out;
}

const TRIANGLE: Held = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
};

describe("readMeshBuffer", () => {
  it("reads the positions and the indices of a mesh carrying nothing else", () => {
    const mesh = readMeshBuffer(buffer(TRIANGLE));

    expect([...mesh.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...mesh.indices]).toEqual([0, 1, 2]);
    expect(mesh.normals).toBeNull();
    expect(mesh.uvs).toBeNull();
    expect(mesh.skinIndices).toBeNull();
    expect(mesh.skinWeights).toBeNull();
    expect(mesh.ranges).toEqual([]);
  });

  it("reads the normals and the uvs the flags say are there", () => {
    const mesh = readMeshBuffer(
      buffer({
        ...TRIANGLE,
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        uvs: [0, 0, 1, 0, 0, 1],
      }),
    );

    expect([...(mesh.normals ?? [])]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...(mesh.uvs ?? [])]).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("reads a uv block written without a normal block", () => {
    const mesh = readMeshBuffer(buffer({ ...TRIANGLE, uvs: [0, 0, 1, 0, 0, 1] }));

    expect(mesh.normals).toBeNull();
    expect([...(mesh.uvs ?? [])]).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("reads each vertex's four shader joints and weights under the skin flag", () => {
    const mesh = readMeshBuffer(
      buffer({
        ...TRIANGLE,
        uvs: [0, 0, 1, 0, 0, 1],
        skinIndices: [3, 1, 0, 0, 2, 4, 6, 8, 5, 0, 0, 0],
        skinWeights: [0.75, 0.25, 0, 0, 0.5, 0.25, 0.125, 0.125, 1, 0, 0, 0],
      }),
    );

    expect([...(mesh.skinIndices ?? [])]).toEqual([3, 1, 0, 0, 2, 4, 6, 8, 5, 0, 0, 0]);
    expect([...(mesh.skinWeights ?? [])]).toEqual([
      0.75, 0.25, 0, 0, 0.5, 0.25, 0.125, 0.125, 1, 0, 0, 0,
    ]);
    expect([...mesh.indices]).toEqual([0, 1, 2]);
  });

  it("reads a version 1 buffer, which carries no skin block", () => {
    const mesh = readMeshBuffer(buffer({ ...TRIANGLE, version: 1 }));

    expect(mesh.skinIndices).toBeNull();
    expect([...mesh.indices]).toEqual([0, 1, 2]);
  });

  it("reads each submesh's name and the run of the index buffer it holds", () => {
    const mesh = readMeshBuffer(
      buffer({
        ...TRIANGLE,
        indices: [0, 1, 2, 0, 2, 1],
        ranges: [
          { name: "body", startIndex: 0, indexCount: 3 },
          { name: "glow", startIndex: 3, indexCount: 3 },
        ],
      }),
    );

    expect(mesh.ranges).toEqual([
      { name: "body", startIndex: 0, indexCount: 3 },
      { name: "glow", startIndex: 3, indexCount: 3 },
    ]);
  });

  it("reads a submesh name that is not plain ascii", () => {
    const mesh = readMeshBuffer(
      buffer({ ...TRIANGLE, ranges: [{ name: "aile_gauche_é", startIndex: 0, indexCount: 3 }] }),
    );

    expect(mesh.ranges[0].name).toBe("aile_gauche_é");
  });

  it("refuses bytes that are no geometry buffer", () => {
    expect(() => readMeshBuffer(buffer({ ...TRIANGLE, magic: 0xdeadbeef }))).toThrow(BufferError);
  });

  it("refuses a version this build does not read", () => {
    expect(() => readMeshBuffer(buffer({ ...TRIANGLE, version: 3 }))).toThrow(BufferError);
  });

  it("refuses a buffer shorter than its own header", () => {
    expect(() => readMeshBuffer(new ArrayBuffer(8))).toThrow(BufferError);
  });

  it("refuses a buffer that ends before the counts in its header", () => {
    const whole = buffer(TRIANGLE);
    const cut = whole.slice(0, whole.byteLength - 4);

    expect(() => readMeshBuffer(cut)).toThrow(BufferError);
  });
});
