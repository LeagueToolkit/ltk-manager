import { Euler, Group, Matrix4, Object3D, Quaternion, Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { MapGeometryMesh } from "@/lib/tauri";
import { AXIS_SIGN, type MapGeometry } from "@/modules/viewport";

import type { PlacedItem } from "../mapOutline";
import {
  dragDelta,
  heldMeshDrag,
  meshAnchor,
  meshId,
  meshIndexOf,
  meshPatch,
  meshTransformEdit,
  movableMeshes,
  pickMesh,
  selectionMiddle,
} from "../meshSelection";
import { movesOf, movesToLead, shownDrag } from "../placeableSpace";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mesh(index: number, min: number[], max: number[]): MapGeometryMesh {
  return {
    index,
    transform: IDENTITY as MapGeometryMesh["transform"],
    min: min as MapGeometryMesh["min"],
    max: max as MapGeometryMesh["max"],
    visibility: 255,
    controller: null,
    region: null,
    quality: 31,
    backfaceCullingDisabled: false,
    vertexCount: 3,
    materials: [],
  };
}

describe("meshIndexOf", () => {
  it("reads a mesh id and skips a placeable id", () => {
    expect(meshIndexOf(meshId(12))).toBe(12);
    expect(meshIndexOf("0x1/0x2")).toBeNull();
  });
});

describe("pickMesh", () => {
  /* Two quads facing up at heights 0 and 5, the higher one shown or not. */
  const map = {
    positions: new Float32Array([
      -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 5, -1, 1, 5, -1, 1, 5, 1, -1, 5, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    meshes: [
      { firstSubmesh: 0, submeshCount: 1, min: [-1, 0, -1], max: [1, 0, 1] },
      { firstSubmesh: 1, submeshCount: 1, min: [-1, 5, -1], max: [1, 5, 1] },
    ],
    submeshes: [
      { startIndex: 0, indexCount: 6, material: 0 },
      { startIndex: 6, indexCount: 6, material: 0 },
    ],
  } as unknown as MapGeometry;
  const down = new Ray(new Vector3(0.2, 10, 0.3), new Vector3(0, -1, 0));

  it("finds the nearest shown mesh under the ray", () => {
    expect(pickMesh(map, down, () => true)).toMatchObject({ mesh: 1, distance: 5 });
  });

  it("skips a mesh that is not shown", () => {
    const hit = pickMesh(map, down, (index) => index !== 1);

    expect(hit?.mesh).toBe(0);
    expect(hit?.point[1]).toBeCloseTo(0);
  });

  it("answers null for a ray past every mesh", () => {
    expect(pickMesh(map, new Ray(new Vector3(9, 10, 9), new Vector3(0, -1, 0)), () => true)).toBe(
      null,
    );
  });
});

describe("selectionMiddle", () => {
  it("averages the placeables' positions and the meshes' bounds middles", () => {
    const placed = { item: { position: [10, 0, 0] } } as unknown as PlacedItem;

    expect(selectionMiddle([placed], [mesh(0, [0, 0, 0], [10, 20, 0])])).toEqual([7.5, 5, 0]);
    expect(selectionMiddle([], [])).toBeNull();
  });
});

describe("meshAnchor", () => {
  it("stands the gizmo at the middle of the mesh's bounds", () => {
    expect(meshAnchor(mesh(0, [0, 0, 0], [10, 20, 30])).slice(12, 15)).toEqual([5, 10, 15]);
  });
});

describe("meshTransformEdit", () => {
  it("sets the transforms of the moved meshes and skips placeables", () => {
    expect(
      meshTransformEdit([
        { id: meshId(3), transform: IDENTITY },
        { id: "0x1/0x2", transform: IDENTITY },
      ]),
    ).toEqual({ kind: "transform", meshes: [{ mesh: 3, transform: IDENTITY }] });
    expect(meshTransformEdit([{ id: "0x1/0x2", transform: IDENTITY }])).toBeNull();
  });
});

describe("movableMeshes", () => {
  const anchored = { ...mesh(1, [0, 0, 0], [2, 2, 2]), region: "0xabc" };

  it("keeps the lead first and skips a region-anchored mesh", () => {
    const items = movableMeshes([
      mesh(4, [0, 0, 0], [2, 2, 2]),
      anchored,
      mesh(2, [0, 0, 0], [4, 0, 0]),
    ]);

    expect(items.map((each) => each.id)).toEqual([meshId(4), meshId(2)]);
    expect(items[1]?.anchor?.slice(12, 15)).toEqual([2, 0, 0]);
  });

  it("returns none if the lead is region-anchored", () => {
    expect(movableMeshes([anchored, mesh(2, [0, 0, 0], [1, 1, 1])])).toEqual([]);
    expect(movableMeshes([])).toEqual([]);
  });

  it("builds one transform edit that moves the selection with the lead", () => {
    const next = [...IDENTITY];
    next[12] = 10;

    const edit = meshTransformEdit(
      movesToLead(
        movableMeshes([mesh(0, [0, 0, 0], [1, 1, 1]), mesh(5, [0, 0, 0], [1, 1, 1])]),
        next,
      ),
    );

    expect(edit?.kind).toBe("transform");
    expect(edit?.kind === "transform" && edit.meshes.map((each) => each.mesh)).toEqual([0, 5]);
    expect(edit?.kind === "transform" && edit.meshes.map((each) => each.transform[12])).toEqual([
      10, 10,
    ]);
  });
});

describe("meshPatch", () => {
  it("copies a mesh's triangles over its own vertices alone", () => {
    const map = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9, 10, 9, 9, 9, 10, 9]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      meshes: [
        { firstSubmesh: 0, submeshCount: 1 },
        { firstSubmesh: 1, submeshCount: 1 },
      ],
      submeshes: [
        { startIndex: 0, indexCount: 3, material: 0 },
        { startIndex: 3, indexCount: 3, material: 0 },
      ],
    } as unknown as MapGeometry;

    const patch = meshPatch(map, [1]);

    expect([...patch.positions]).toEqual([9, 9, 9, 10, 9, 9, 9, 10, 9]);
    expect([...patch.indices]).toEqual([0, 1, 2]);
  });
});

describe("dragDelta", () => {
  it("is the lead's change during a drag and identity outside one", () => {
    const moved = [...IDENTITY];
    moved[12] = 100;
    const meshes = [mesh(0, [0, 0, 0], [1, 1, 1])];

    expect(dragDelta(meshes, null).elements.slice(12, 15)).toEqual([0, 0, 0]);
    expect(dragDelta(meshes, new Map([[meshId(0), moved]])).elements.slice(12, 15)).toEqual([
      100, 0, 0,
    ]);
  });

  it("draws an undone mesh move at the restored transform", () => {
    const original = mesh(0, [0, 0, 0], [1, 1, 1]);
    const [step] = movesOf(
      movableMeshes([original]),
      new Matrix4(),
      new Matrix4().makeTranslation(100, 0, 0),
    );
    if (step === undefined) throw new Error("the drag moved no mesh");
    const held = {
      transforms: new Map([[step.id, step.transform]]),
      basis: { outline: undefined, geometryRevision: 3 },
    };

    /* The commit lands as revision 4 and its undo as revision 5, which holds the original. */
    const committed = { ...original, transform: step.transform as MapGeometryMesh["transform"] };
    const dragging = shownDrag(held, held.basis);
    const landed = shownDrag(held, { outline: undefined, geometryRevision: 4 });
    const undone = shownDrag(held, { outline: undefined, geometryRevision: 5 });

    expect(dragDelta([original], dragging).equals(new Matrix4())).toBe(false);
    expect(dragDelta([committed], landed).equals(new Matrix4())).toBe(true);
    expect(dragDelta([original], undone).equals(new Matrix4())).toBe(true);
    /* The drag kept past the undo would draw the mesh at the dragged place. */
    expect(dragDelta([original], held.transforms).equals(new Matrix4())).toBe(false);
  });
});

describe("dragDelta in the backdrop's mirrored group", () => {
  it("draws a vertex of the buffer where the dragged transform puts it, applied before the mirror", () => {
    const transform = new Matrix4().compose(
      new Vector3(5, 0, 2),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 6, 0)),
      new Vector3(1, 1, 1),
    );
    const moved = new Matrix4().compose(
      new Vector3(100, 20, -50),
      new Quaternion().setFromEuler(new Euler(Math.PI / 4, 0, Math.PI / 5)),
      new Vector3(1.5, 1.5, 1.5),
    );
    const lead = {
      ...mesh(0, [0, 0, 0], [1, 1, 1]),
      transform: transform.toArray() as MapGeometryMesh["transform"],
    };
    const delta = dragDelta([lead], new Map([[meshId(0), [...moved.elements]]]));

    /* As the backdrop nests them: the mirror's group, then the copy with the delta as its matrix. */
    const mirror = new Group();
    mirror.scale.set(...AXIS_SIGN);
    const copy = new Object3D();
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(delta);
    mirror.add(copy);
    mirror.updateMatrixWorld(true);

    const local = new Vector3(1, 2, 3);
    const stored = local.clone().applyMatrix4(transform);
    const expected = local
      .clone()
      .applyMatrix4(moved)
      .multiply(new Vector3(...AXIS_SIGN));

    expect(stored.clone().applyMatrix4(copy.matrixWorld).distanceTo(expected)).toBeLessThan(1e-4);
    /* The delta applied after the mirror misses the dragged place. */
    const mirroredFirst = stored
      .clone()
      .multiply(new Vector3(...AXIS_SIGN))
      .applyMatrix4(delta);
    expect(mirroredFirst.distanceTo(expected)).toBeGreaterThan(1);
  });
});

describe("heldMeshDrag", () => {
  const drawn = { meshes: [] } as unknown as MapGeometry;
  const next = { meshes: [] } as unknown as MapGeometry;
  const moved = [...IDENTITY];
  moved[12] = 100;
  const selection = [mesh(2, [0, 0, 0], [1, 1, 1]), mesh(5, [0, 0, 0], [1, 1, 1])];
  const dragged = new Map([
    [meshId(2), moved],
    [meshId(5), moved],
    ["0x1/0x2", moved],
  ]);
  const dragging = heldMeshDrag(null, { drawn, selection, dragged, revision: 3 });

  it("returns the dragged meshes of the drawn buffer and the lead's change during a drag", () => {
    expect(dragging?.drag.map).toBe(drawn);
    expect([...(dragging?.drag.meshes ?? [])]).toEqual([2, 5]);
    expect(dragging?.drag.delta.elements.slice(12, 15)).toEqual([100, 0, 0]);
  });

  it("keeps the mesh set of the last step while it holds the same meshes", () => {
    const step = heldMeshDrag(dragging, { drawn, selection, dragged, revision: 3 });

    expect(step?.drag.meshes).toBe(dragging?.drag.meshes);
  });

  it("holds a committed drag until the buffer with the move is drawn", () => {
    const landed = heldMeshDrag(dragging, { drawn, selection, dragged: null, revision: 4 });
    const drawnMoved = heldMeshDrag(landed, { drawn: next, selection, dragged: null, revision: 4 });

    expect(landed).toBe(dragging);
    expect(drawnMoved).toBeNull();
  });

  it("drops a cancelled drag at once", () => {
    expect(heldMeshDrag(dragging, { drawn, selection, dragged: null, revision: 3 })).toBeNull();
  });

  it("returns null for a drag of placeables alone", () => {
    const placeables = new Map([["0x1/0x2", moved]]);

    expect(heldMeshDrag(null, { drawn, selection, dragged: placeables, revision: 3 })).toBeNull();
  });
});
