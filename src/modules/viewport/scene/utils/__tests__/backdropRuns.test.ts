import {
  Box3,
  BufferGeometry,
  Frustum,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  RawShaderMaterial,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import {
  blendTierOf,
  type MeshRun,
  runsInView,
  splitRuns,
  surfaceBlendTier,
  writeGroups,
} from "../backdropRuns";
import type { OrderedGroup } from "../sharedRenderer";

/** A run of one group whose first index is `id`, in a unit box centred on `at`. */
function run(id: number, at: [number, number, number]): MeshRun {
  const centre = new Vector3(...at);
  return {
    mesh: id,
    box: new Box3().setFromCenterAndSize(centre, new Vector3(1, 1, 1)),
    groups: [{ startIndex: id, indexCount: 3, material: 0 }],
    depth: 0,
  };
}

/** The frustum and the eye of a camera at the origin that looks down the negative z axis. */
function view(): { frustum: Frustum; eye: Vector3 } {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const projection = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return { frustum: new Frustum().setFromProjectionMatrix(projection), eye: camera.position };
}

const ids = (runs: readonly MeshRun[]) => runs.map((each) => each.groups[0]?.startIndex);

describe("runsInView", () => {
  it("returns the runs whose box is in the frustum and leaves out the others", () => {
    const { frustum, eye } = view();
    const runs = [
      run(1, [0, 0, -10]),
      run(2, [0, 0, 10]),
      run(3, [500, 0, -10]),
      run(4, [0, 0, -500]),
    ];

    expect(ids(runsInView(runs, frustum, eye, []))).toEqual([1]);
  });

  it("orders the runs in view nearest to the eye first", () => {
    const { frustum, eye } = view();
    const runs = [run(1, [0, 0, -50]), run(2, [0, 0, -5]), run(3, [0, 0, -20])];

    expect(ids(runsInView(runs, frustum, eye, []))).toEqual([2, 3, 1]);
  });

  it("keeps the given order of runs at the same distance", () => {
    const { frustum, eye } = view();
    const runs = [run(1, [1, 0, -10]), run(2, [-1, 0, -10]), run(3, [0, 1, -10])];

    expect(ids(runsInView(runs, frustum, eye, []))).toEqual([1, 2, 3]);
  });

  it("writes into the given array and replaces what it held", () => {
    const { frustum, eye } = view();
    const out = [run(9, [0, 0, -1])];

    const returned = runsInView([run(1, [0, 0, -10])], frustum, eye, out);

    expect(returned).toBe(out);
    expect(ids(out)).toEqual([1]);
  });

  it("records the distance from the eye to each run in view", () => {
    const { frustum, eye } = view();
    const near = run(1, [0, 0, -10]);

    runsInView([near], frustum, eye, []);

    expect(near.depth).toBeCloseTo(9.5);
  });
});

describe("blendTierOf", () => {
  it("puts a depth-writing blend without an alpha test or an opacity in tier 0", () => {
    /* Map453's `Jade_GroundLane_AA_MAT`, a `4TextureBlend_UVBased_baseMat` pass. */
    expect(blendTierOf({ depthWrite: true, alphaTest: null, opacity: null })).toBe(0);
    expect(blendTierOf({ depthWrite: true, alphaTest: 0, opacity: null })).toBe(0);
  });

  it("puts a depth-writing alpha-tested or faded blend in tier 1", () => {
    /* Map453's `order_ground_mix2_decalVersion3_no_shadow`, `AlphaTestValue` 0.001. */
    expect(blendTierOf({ depthWrite: true, alphaTest: 0.001, opacity: null })).toBe(1);
    expect(blendTierOf({ depthWrite: true, alphaTest: null, opacity: 0.5 })).toBe(1);
  });

  it("puts a blend without depth writes in tier 2, alpha-tested or not", () => {
    expect(blendTierOf({ depthWrite: false, alphaTest: null, opacity: null })).toBe(2);
    expect(blendTierOf({ depthWrite: false, alphaTest: 0.3, opacity: 1 })).toBe(2);
  });
});

describe("surfaceBlendTier", () => {
  it("reads depth writes from a translated program and from the slots of a stock material", () => {
    const program = new RawShaderMaterial();
    program.depthWrite = false;
    const stock = new MeshBasicMaterial();

    expect(surfaceBlendTier({ material: program, slots: null })).toBe(2);
    expect(surfaceBlendTier({ material: stock, slots: null })).toBe(0);
  });
});

describe("writeGroups", () => {
  it("writes each group's place in the list and the tier of its material", () => {
    const geometry = new BufferGeometry();
    const runs: MeshRun[] = [
      {
        mesh: 0,
        box: new Box3(),
        groups: [{ startIndex: 0, indexCount: 3, material: 1 }],
        depth: 0,
      },
      {
        mesh: 1,
        box: new Box3(),
        groups: [
          { startIndex: 3, indexCount: 6, material: 0 },
          { startIndex: 9, indexCount: 3, material: 2 },
        ],
        depth: 0,
      },
    ];

    writeGroups(geometry, runs, [0, 1]);

    const groups = geometry.groups as OrderedGroup[];
    expect(groups.map(({ start, order, tier }) => [start, order, tier])).toEqual([
      [0, 0, 1],
      [3, 1, 0],
      [9, 2, 0],
    ]);
  });
});

describe("splitRuns", () => {
  /** A run of mesh `mesh` with one group per material in `materials`, each three indices long. */
  function meshRun(mesh: number, materials: readonly number[]): MeshRun {
    return {
      mesh,
      box: new Box3(),
      groups: materials.map((material, at) => ({
        startIndex: mesh * 100 + at * 3,
        indexCount: 3,
        material,
      })),
      depth: 0,
    };
  }

  const runs = [meshRun(0, [0]), meshRun(1, [1, 2]), meshRun(2, [2]), meshRun(3, [0, 1])];

  it("leaves the dragged meshes out of the fixed runs and keeps exactly them in the dragged runs", () => {
    const { fixed, dragged } = splitRuns(runs, new Set([1, 3]));

    expect(fixed.map((each) => each.mesh)).toEqual([0, 2]);
    expect(dragged.map((each) => each.mesh)).toEqual([1, 3]);
  });

  it("returns the given runs as the fixed part outside a drag", () => {
    expect(splitRuns(runs, null)).toEqual({ fixed: runs, dragged: [] });
    expect(splitRuns(runs, new Set()).fixed).toBe(runs);
  });

  it("writes each part's groups with the tier of its material", () => {
    const tiers = [0, 1, 2] as const;
    const { fixed, dragged } = splitRuns(runs, new Set([1, 3]));
    const fixedGeometry = new BufferGeometry();
    const draggedGeometry = new BufferGeometry();

    writeGroups(fixedGeometry, fixed, [...tiers]);
    writeGroups(draggedGeometry, dragged, [...tiers]);

    const written = (geometry: BufferGeometry) =>
      (geometry.groups as OrderedGroup[]).map(({ start, materialIndex, tier }) => [
        start,
        materialIndex,
        tier,
      ]);
    expect(written(fixedGeometry)).toEqual([
      [0, 0, 0],
      [200, 2, 2],
    ]);
    expect(written(draggedGeometry)).toEqual([
      [100, 1, 1],
      [103, 2, 2],
      [300, 0, 0],
      [303, 1, 1],
    ]);
  });
});
