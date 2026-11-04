import {
  BoxGeometry,
  DetachedBindMode,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from "three";
import { describe, expect, it } from "vitest";

import { GLOW_LAYER } from "../glowLayer";
import { glowTwins, passTwin } from "../passTwin";

describe("passTwin", () => {
  it("draws the instances of an instanced mesh", () => {
    const of = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
    of.renderOrder = 3;

    const twin = passTwin(of, 2);

    expect(twin).toBeInstanceOf(InstancedMesh);
    expect((twin as InstancedMesh).instanceMatrix).toBe(of.instanceMatrix);
    expect(twin.renderOrder).toBe(5);
  });

  it("keeps a detached skin detached", () => {
    const of = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    of.bindMode = DetachedBindMode;
    of.bind(new Skeleton([]), new Matrix4());

    const twin = passTwin(of, 1) as SkinnedMesh;

    expect(twin.bindMode).toBe(DetachedBindMode);
    expect(twin.skeleton).toBe(of.skeleton);
  });
});

describe("glowTwins", () => {
  it("returns one twin per pass, on the glow layer alone, in pass order", () => {
    const of = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    of.renderOrder = 2;

    const twins = glowTwins(of, 2);

    expect(twins.map((twin) => twin.renderOrder)).toEqual([2, 3]);
    expect(twins.every((twin) => twin.layers.mask === 1 << GLOW_LAYER)).toBe(true);
  });
});
