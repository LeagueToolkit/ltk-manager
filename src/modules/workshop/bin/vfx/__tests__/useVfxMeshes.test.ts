import { describe, expect, it } from "vitest";

import type { MeshGeometry } from "@/modules/viewport";

import { flightInto, mirrorInto, multiplyInto, standingInto } from "../basis";
import type { MeshModel } from "../model";
import { geometryOf } from "../useVfxMeshes";

/** A cone as `Ahri_Base_Sharp_Mesh.scb` is modelled: its tip at the origin, opening along `+X`. */
const CONE: MeshGeometry = {
  positions: new Float32Array([0, 0, 0, 151, 100, 0, 151, -100, 0]),
  normals: null,
  uvs: null,
  skinIndices: null,
  skinWeights: null,
  indices: new Uint32Array([0, 1, 2]),
  ranges: [],
};

const MODEL: MeshModel = {
  asset: { kind: "gameChunk", wad: "Ahri.wad.client", pathHash: "0" },
  path: null,
  submeshes: [],
  submeshesAlways: [],
  alignPitch: false,
  alignYaw: false,
  skinned: false,
};

/** The viewport's `x` of vertex `at` of `geometry`, under the row-major `turn`. */
function drawnX(turn: Float32Array, geometry: ReturnType<typeof geometryOf>, at: number): number {
  const position = geometry.getAttribute("position");
  return turn[0] * position.getX(at) + turn[1] * position.getY(at) + turn[2] * position.getZ(at);
}

describe("geometryOf", () => {
  it("opens cone_add of Ahri_Base_R_mis_02 behind the missile it rides", () => {
    const geometry = geometryOf(CONE, MODEL);

    /* The turn `Meshes` hands the instance: `birthRotation0` on the flight frame of a
       missile flying the engine's +X, mirrored whole into the viewport. */
    const turn = standingInto(new Float32Array([0, 180, -90]), 0, 0, new Float32Array(9));
    multiplyInto(flightInto([1, 0, 0], new Float32Array(9)), turn, turn);
    const drawn = new Float32Array(9);
    mirrorInto(turn, 0, drawn, 0);

    /* The flight runs to the viewport's -X, so behind the missile is +X. */
    expect(drawnX(drawn, geometry, 1)).toBeGreaterThan(0);
    expect(drawnX(drawn, geometry, 2)).toBeGreaterThan(0);
  });

  it("keeps each face facing the side it faced in the engine's space, across the mirror", () => {
    const geometry = geometryOf(CONE, MODEL);
    const position = geometry.getAttribute("position");
    const [a, b, c] = Array.from(geometry.getIndex()?.array ?? []);
    const edge = (to: number) => [
      position.getX(to) - position.getX(a),
      position.getY(to) - position.getY(a),
    ];
    const [ux, uy] = edge(b);
    const [vx, vy] = edge(c);

    /* The file's face turns toward -Z, which the mirror on X leaves where it is. */
    expect(ux * vy - uy * vx).toBeLessThan(0);
  });

  it("carries a file's own normals across the mirror", () => {
    const geometry = geometryOf(
      { ...CONE, normals: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
      MODEL,
    );

    expect(Array.from(geometry.getAttribute("normal").array)).toEqual([
      -1, 0, 0, -0, 1, 0, -0, 0, 1,
    ]);
  });
});
