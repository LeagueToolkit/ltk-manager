import { describe, expect, it } from "vitest";

import type { VfxValue } from "@/lib/tauri";

import { hashOf, nameHash } from "../../../../shared/utils/binHash";
import type { EmissionSurfaceModel, EmitterModel } from "../../../engine/model/model";
import { emitterOf, flat } from "../../../engine/simulation/__tests__/emitterFixture";
import { type CheckContext, emissionChecks } from "../emissionChecks";

function struct(className: string, fields: Record<string, VfxValue> = {}): VfxValue {
  return {
    type: "struct",
    classHash: nameHash(className),
    class: className,
    object: null,
    fields: Object.entries(fields).map(([name, value]) => ({
      hash: hashOf(name),
      name,
      value,
    })),
  };
}

function path(value: string): VfxValue {
  return { type: "asset", path: value, asset: null };
}

function names(...held: string[]): VfxValue {
  return {
    type: "container",
    items: held.map((name) => ({ type: "hash", hash: nameHash(name), name })),
  };
}

/** A complex emitter with `surface` as its emission surface and the fields of `over`. */
function emitterWith(surface: VfxValue | null, over: Record<string, VfxValue> = {}): VfxValue {
  const fields = surface === null ? over : { ...over, emissionSurfaceDefinition: surface };
  return struct("VfxEmitterDefinitionData", fields);
}

function definition(parts: Record<string, VfxValue> = {}): VfxValue {
  return struct("VfxEmissionSurfaceData", parts);
}

const SKINNED = struct("VfxEmissionMeshData", {
  meshName: path("ahri.skn"),
  skeletonName: path("ahri.skl"),
});

const SURFACE: EmissionSurfaceModel = {
  kind: "mesh",
  mesh: null,
  skeleton: null,
  submeshes: [],
  joints: [],
  scale: 1,
  maxJointWeights: 4,
  useNormal: true,
};

function context(over: Partial<CheckContext> = {}): CheckContext {
  return { simple: false, emitter: undefined, bound: true, submeshes: null, joints: null, ...over };
}

function ids(node: VfxValue | null, over: Partial<CheckContext> = {}): string[] {
  return emissionChecks(node, context(over)).map((check) => check.id);
}

function timing(over: Partial<EmitterModel>): string[] {
  return ids(emitterWith(null), { emitter: emitterOf(0, { rate: flat(10), ...over }) });
}

describe("emissionChecks", () => {
  it("returns no check for an emitter with no mesh or surface and a valid window", () => {
    expect(ids(emitterWith(null), { emitter: emitterOf(0, { rate: flat(10) }) })).toEqual([]);
    expect(ids(null)).toEqual([]);
  });

  describe("timing checks", () => {
    it("warns when the end time is at or before the start delay", () => {
      expect(timing({ lifetime: 2, timeBeforeFirstEmission: 2 })).toEqual(["endsBeforeStart"]);
      expect(timing({ lifetime: 2, timeBeforeFirstEmission: 1.9 })).toEqual([]);
      expect(timing({ lifetime: null, timeBeforeFirstEmission: 50 })).toEqual([]);
    });

    it("includes the end time and the start delay in the check", () => {
      const [check] = emissionChecks(
        emitterWith(null),
        context({ emitter: emitterOf(0, { lifetime: 1, timeBeforeFirstEmission: 3 }) }),
      );

      expect(check).toMatchObject({ id: "endsBeforeStart", end: 1, start: 3 });
    });

    it("uses the end time the engine sets for a single burst", () => {
      const burst = { singleParticle: true, particleLifetime: flat(1), lifetime: null };

      expect(timing({ ...burst, timeBeforeFirstEmission: 2 })).toEqual(["endsBeforeStart"]);
      expect(timing({ ...burst, timeBeforeFirstEmission: 0.5 })).toEqual([]);
    });

    it("reports a period with no active time, and a single burst that has a period", () => {
      expect(timing({ period: { length: 2, active: 0 } })).toEqual(["neverActive"]);
      expect(timing({ period: { length: 0, active: 1 } })).toEqual(["neverActive"]);
      expect(timing({ period: { length: 2, active: null } })).toEqual([]);
      expect(timing({ singleParticle: true, period: { length: 2, active: null } })).toEqual([
        "burstWithPeriod",
      ]);
    });

    it("reports an active time with no period", () => {
      expect(timing({ period: { length: null, active: 1 } })).toEqual(["activeWithoutPeriod"]);
      expect(timing({ period: { length: null, active: 0 } })).toEqual(["neverActive"]);
    });

    it("reports the speed function's values when it replaces the rate", () => {
      const [check] = emissionChecks(
        emitterWith(null),
        context({
          emitter: emitterOf(0, { rateByVelocity: [0.5, 3], maximumRateByVelocity: 120 }),
        }),
      );

      expect(check).toEqual({
        id: "rateReplaced",
        group: "emission",
        tone: "info",
        slope: 0.5,
        base: 3,
        most: 120,
      });
    });

    it("warns for an emitter the engine drops because it has no rate", () => {
      expect(timing({ culled: "noRate" })).toEqual(["noRate"]);
    });
  });

  describe("simple emitter checks", () => {
    it("warns when a simple emitter has an emission mesh or a surface", () => {
      const mesh = emitterWith(null, { emissionMeshName: path("ring.scb") });

      expect(ids(mesh, { simple: true })).toEqual(["simpleSource"]);
      expect(ids(emitterWith(definition()), { simple: true })).toEqual(["simpleSource"]);
      expect(ids(emitterWith(null), { simple: true })).toEqual([]);
      expect(ids(mesh)).toEqual([]);
    });
  });

  describe("surface checks", () => {
    it("reports a definition that sets neither part", () => {
      expect(ids(emitterWith(definition()))).toEqual(["surfaceEmpty"]);
      expect(ids(emitterWith(definition({ EmissionSurface: SKINNED })))).toEqual([]);
    });

    it("warns when a skinned mesh lacks its mesh or skeleton name, or a skeleton surface its name", () => {
      const meshOnly = struct("VfxEmissionMeshData", { meshName: path("ahri.skn") });
      const unnamed = struct("VfxEmissionSkeletonData", { skeletonName: path("") });

      expect(ids(emitterWith(definition({ EmissionSurface: meshOnly })))).toEqual([
        "meshFilesMissing",
      ]);
      expect(ids(emitterWith(definition({ EmissionSurface: unnamed })))).toEqual([
        "skeletonFileMissing",
      ]);
    });

    it("warns when no listed submesh is in the loaded mesh, ignoring case", () => {
      const listed = struct("VfxEmissionMeshData", {
        meshName: path("ahri.skn"),
        skeletonName: path("ahri.skl"),
        Submeshes: names("Tail", "Orb"),
      });
      const node = emitterWith(definition({ EmissionSurface: listed }));

      expect(ids(node, { submeshes: ["body", "hair"] })).toEqual(["submeshesUnmatched"]);
      expect(ids(node, { submeshes: ["body", "TAIL"] })).toEqual([]);
      expect(ids(node, { submeshes: null })).toEqual([]);
    });

    it("warns when no joint of the mask is among the joints that have a parent", () => {
      const masked = struct("VfxEmissionSkeletonData", {
        skeletonName: path("ahri.skl"),
        JointMask: names("L_Hand"),
      });
      const node = emitterWith(definition({ EmissionSurface: masked }));

      expect(ids(node, { joints: ["spine"] })).toEqual(["jointsUnmatched"]);
      expect(ids(node, { joints: ["l_hand"] })).toEqual([]);
    });

    it("reports a linked mesh, a generator, and a posed surface with no host", () => {
      const linked = definition({ EmissionSurface: struct("VfxEmissionLinkedMeshData") });
      const generated = definition({
        ParticleSpawnDataGenerator: struct("NavigationGridParticleSpawnDataGenerator"),
      });

      expect(ids(emitterWith(linked), { bound: false })).toEqual(["linkedMesh"]);
      expect(ids(emitterWith(generated))).toEqual(["generator"]);
      expect(ids(emitterWith(definition({ EmissionSurface: SKINNED })), { bound: false })).toEqual([
        "noUnit",
      ]);
    });

    it("treats a definition in the layout before patch 15.22 as a skinned mesh", () => {
      const old = definition({ meshName: path("ahri.skn") });

      expect(ids(emitterWith(old))).toEqual(["meshFilesMissing"]);
    });

    it("reports a normal switch that is on while both birth vectors are zero", () => {
      const node = emitterWith(definition({ EmissionSurface: SKINNED }));
      const directed = { emissionSurface: SURFACE };

      expect(ids(node, { emitter: emitterOf(0, { rate: flat(1), ...directed }) })).toEqual([
        "stillNormals",
      ]);
      expect(
        ids(node, {
          emitter: emitterOf(0, { rate: flat(1), ...directed, birthVelocity: flat(0, 5, 0) }),
        }),
      ).toEqual([]);
      expect(
        ids(node, {
          emitter: emitterOf(0, {
            rate: flat(1),
            emissionSurface: { ...SURFACE, useNormal: false },
          }),
        }),
      ).toEqual([]);
    });
  });
});
