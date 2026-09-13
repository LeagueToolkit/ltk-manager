import { describe, expect, it } from "vitest";

import type { AssetRef, VfxSystem, VfxValue } from "@/lib/tauri";

import { nameHash } from "../../binHash";
import {
  drawsAsMesh,
  drawsAsQuad,
  drawsTheAttachment,
  facesTheCamera,
  isRay,
  isUndrawn,
  isUnitQuad,
} from "../drawKind";
import {
  ADDRESS_MODE,
  BLEND_MODE,
  COLOR_LOOKUP,
  DRAG_MOTION,
  LINGER_TYPE,
  QUAD_TYPE,
  STENCIL_MODE,
  UV_MODE,
} from "../enums";
import { readVfxSystem } from "../readVfxSystem";

function struct(classHash: string, fields: Record<string, VfxValue>): VfxValue {
  return {
    type: "struct",
    classHash,
    class: null,
    object: null,
    fields: Object.entries(fields).map(([name, value]) => ({
      hash: nameHash(name),
      name,
      value,
    })),
  };
}

function number(value: number): VfxValue {
  return { type: "number", value };
}

function vector(...values: number[]): VfxValue {
  return { type: "vector", values };
}

function container(...items: VfxValue[]): VfxValue {
  return { type: "container", items };
}

/** A value class holding a constant and no curve, which is what most emitters write. */
function constantOf(value: VfxValue): VfxValue {
  return struct(nameHash("ValueFloat"), { constantValue: value, dynamics: { type: "null" } });
}

/** A value class whose curve is the two lists the sampler reads in step. */
function keyed(times: number[], values: VfxValue[]): VfxValue {
  return struct(nameHash("ValueVector3"), {
    constantValue: vector(1, 1, 1),
    dynamics: struct(nameHash("VfxAnimatedVector3fVariableData"), {
      times: container(...times.map(number)),
      values: container(...values),
    }),
  });
}

function system(emitters: VfxValue[], simple: VfxValue[] = []): VfxSystem {
  return {
    entry: "0x12345678",
    name: "particles/test",
    classHash: nameHash("VfxSystemDefinitionData"),
    class: "VfxSystemDefinitionData",
    root: struct(nameHash("VfxSystemDefinitionData"), {
      complexEmitterDefinitionData: container(...emitters),
      simpleEmitterDefinitionData: container(...simple),
    }),
  };
}

function emitter(fields: Record<string, VfxValue>): VfxValue {
  return struct(nameHash("VfxEmitterDefinitionData"), fields);
}

describe("readVfxSystem", () => {
  it("reads kAnalyticDragMotion off the system's flags, and off at their default", () => {
    const flagged = (flags: number): VfxSystem => ({
      ...system([]),
      root: struct(nameHash("VfxSystemDefinitionData"), { flags: number(flags) }),
    });

    expect(readVfxSystem(flagged(0x1d4)).dragMotion).toBe(DRAG_MOTION.analytic);
    expect(readVfxSystem(flagged(0x0c4)).dragMotion).toBe(DRAG_MOTION.stepped);
    expect(readVfxSystem(system([])).dragMotion).toBe(DRAG_MOTION.stepped);
  });

  it("reads buildUpTime off the system, and none where it is not written", () => {
    const built: VfxSystem = {
      ...system([]),
      root: struct(nameHash("VfxSystemDefinitionData"), { buildUpTime: number(5) }),
    };

    expect(readVfxSystem(built).buildUpTime).toBe(5);
    expect(readVfxSystem(system([])).buildUpTime).toBe(0);
  });

  it("reads emitterLinger and the direction stretch, at their schema defaults where unwritten", () => {
    const [bare, written] = readVfxSystem(
      system([
        emitter({}),
        emitter({
          emitterLinger: number(3),
          directionVelocityScale: number(0.005),
          directionVelocityMinScale: number(0),
        }),
      ]),
    ).emitters;

    expect([
      bare.emitterLinger,
      bare.directionVelocityScale,
      bare.directionVelocityMinScale,
    ]).toEqual([0, 0, 1]);
    expect([
      written.emitterLinger,
      written.directionVelocityScale,
      written.directionVelocityMinScale,
    ]).toEqual([3, 0.005, 0]);
  });

  it("reads the complex list before the simple one and numbers them across both", () => {
    const model = readVfxSystem(
      system(
        [emitter({ emitterName: { type: "string", value: "smoke" } })],
        [emitter({ emitterName: { type: "string", value: "spark" } })],
      ),
    );

    expect(model.emitters.map((each) => each.name)).toEqual(["smoke", "spark"]);
    expect(model.emitters.map((each) => each.index)).toEqual([0, 1]);
    expect(model.emitters.map((each) => each.simple)).toEqual([false, true]);
    expect(model.emitters.map((each) => each.listIndex)).toEqual([0, 0]);
  });

  it("takes the schema's default for a field the emitter does not write", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.rate.constant).toEqual([0]);
    expect(only.particleLifetime.constant).toEqual([3]);
    expect(only.scale0.constant).toEqual([1, 1, 1]);
    expect(only.birthColor.constant).toEqual([1, 1, 1, 1]);
    expect(only.acceleration.constant).toEqual([0, 0, 0]);
    expect(only.worldAcceleration.constant).toEqual([0, 0, 0]);
    expect(only.birthOrbitalVelocity.constant).toEqual([0, 0, 0]);
    expect(only.birthRotationalAcceleration.constant).toEqual([0, 0, 0]);
    expect(only.lifetime).toBeNull();
    expect(only.timeBeforeFirstEmission).toBe(0);
    expect(only.bindWeight.constant).toEqual([0]);
    expect(only.emitterPosition.constant).toEqual([0, 0, 0]);
    expect(only.emitterSpace).toBe(false);
    expect(only.pass).toBe(0);
    expect(only.miscRenderFlags).toBe(0);
    expect(only.alphaRef).toBeCloseTo(5 / 255, 6);
  });

  it("reads the render-state bytes, the alpha test over its own byte range", () => {
    const [only] = readVfxSystem(
      system([emitter({ pass: number(-100), miscRenderFlags: number(5), alphaRef: number(51) })]),
    ).emitters;

    expect(only.pass).toBe(-100);
    expect(only.miscRenderFlags).toBe(5);
    expect(only.alphaRef).toBeCloseTo(0.2, 6);
  });

  it("reads an alphaRef of zero as no test rather than the default", () => {
    const [only] = readVfxSystem(system([emitter({ alphaRef: number(0) })])).emitters;

    expect(only.alphaRef).toBe(0);
  });

  it("spawns on a point at the origin, with no ribbon, for an emitter naming no primitive", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.shape).toEqual({ kind: "point", offset: [0, 0, 0] });
    expect(only.trail).toBeNull();
    expect(only.beam).toBeNull();
  });

  it("lingers not at all, off no palette, for an emitter writing none of either", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.velocity.constant).toEqual([0, 0, 0]);
    expect(only.particleLinger).toBe(0);
    expect(only.lingerType).toBe(LINGER_TYPE.maxLifetimeAfterEmitterDies);
    expect(only.linger).toBeNull();
    expect(only.palette).toBeNull();
    expect(only.colorTexture).toBeNull();
    expect(only.lookupX).toBe(COLOR_LOOKUP.lifetime);
    expect(only.lookupY).toBe(COLOR_LOOKUP.constant);
    expect(only.lookupOffsets).toEqual([0, 0]);
    expect(only.lookupScales).toEqual([1, 1]);
  });

  it("reads a simple emitter's legacy block and lowers what it says about the emitter", () => {
    const [only] = readVfxSystem(
      system(
        [],
        [
          emitter({
            LegacySimple: struct(nameHash("VfxEmitterLegacySimple"), {
              birthScale: constantOf(number(105)),
              scaleBias: vector(2, 1),
              scale: constantOf(number(3)),
              birthRotation: constantOf(number(1)),
              lockedToEmitter: { type: "bool", value: true },
              uvScrollRate: vector(0.5, 0),
              scaleUpFromOrigin: { type: "bool", value: true },
              particleBind: vector(1, 1),
            }),
          }),
        ],
      ),
    ).emitters;

    expect(only.simple).toBe(true);
    expect(only.legacySimple).toMatchObject({
      birthScale: { constant: [105] },
      scaleBias: [2, 1],
      scale: { constant: [3] },
      birthRotation: { constant: [1] },
      lockedToEmitter: true,
      particleBind: [1, 1],
      fixedOrbitType: 1,
      orientation: 0,
    });
    expect(only.bindWeight.constant).toEqual([1]);
    expect(only.emitterSpace).toBe(true);
    expect(only.uv.emitterScrollRate).toEqual([0.5, 0]);
    expect(only.pivotUp).toBe(true);
  });

  it("carries no legacy block, and no lift, for a complex emitter", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.legacySimple).toBeNull();
    expect(only.pivotUp).toBe(false);
  });

  it("reads the linger block toggle by toggle, a curve only where its toggle is on", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          particleLinger: number(2.5),
          particleLingerType: number(2),
          Linger: struct(nameHash("VfxLingerDefinitionData"), {
            UseLingerScale: { type: "bool", value: true },
            LingerScale: constantOf(vector(2, 2, 2)),
            LingerRotation: constantOf(vector(0, 0, 5)),
            UseSeparateLingerColor: { type: "bool", value: true },
          }),
        }),
      ]),
    ).emitters;

    expect(only.particleLinger).toBe(2.5);
    expect(only.lingerType).toBe(LINGER_TYPE.fixedLifetimeAfterEmitterStops);
    expect(only.linger?.scale?.constant).toEqual([2, 2, 2]);
    /* Authored, but its toggle is off, so it does not replace `rotation0`. */
    expect(only.linger?.rotation).toBeNull();
    /* On, and not authored, so it reads at the schema's white. */
    expect(only.linger?.color?.constant).toEqual([1, 1, 1, 1]);
    expect(only.linger?.velocity).toBeNull();
  });

  it("reads the palette, and the colour ramp with its lookups, the palette's address mode defaulting to mirror", () => {
    const held: AssetRef = { kind: "gameChunk", wad: "Smolder.wad.client", pathHash: "0c0c0c0c" };
    const ramp: AssetRef = { kind: "gameChunk", wad: "Smolder.wad.client", pathHash: "0c0c0c0e" };
    const [only] = readVfxSystem(
      system([
        emitter({
          paletteDefinition: struct(nameHash("VfxPaletteDefinitionData"), {
            paletteTexture: { type: "asset", path: "assets/ramp.dds", asset: held },
            paletteCount: number(3),
            paletteSelector: constantOf(vector(1, 0, 0)),
          }),
          particleColorTexture: { type: "asset", path: "assets/life.dds", asset: ramp },
          colorLookUpTypeX: number(3),
          colorLookUpTypeY: number(1),
          colorLookUpScales: vector(2, 0.5),
        }),
      ]),
    ).emitters;

    expect(only.colorTexture).toEqual({ path: "assets/life.dds", asset: ramp });
    expect(only.palette?.texture).toEqual({ path: "assets/ramp.dds", asset: held });
    expect(only.palette?.count).toBe(3);
    expect(only.palette?.selector.constant).toEqual([1, 0, 0]);
    expect(only.palette?.addressMode).toBe(ADDRESS_MODE.mirror);
    expect(only.palette?.mix.constant).toEqual([0.299, 0.587, 0.114, 0]);
    expect(only.lookupX).toBe(COLOR_LOOKUP.birthRandom);
    expect(only.lookupY).toBe(COLOR_LOOKUP.lifetime);
    expect(only.lookupScales).toEqual([2, 0.5]);
  });

  it("reads the erosion, its map sampling as a mirror by default and its mixer as alpha", () => {
    const held: AssetRef = { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0d0d0d0d" };
    const [own, mapped, none] = readVfxSystem(
      system([
        emitter({
          alphaErosionDefinition: struct(nameHash("VfxAlphaErosionDefinitionData"), {
            erosionDriveCurve: keyed([0, 0.8], [number(0), number(1)]),
            erosionFeatherOut: number(0.2),
            erosionSliceWidth: number(1.7),
            erosionMapChannelMixer: constantOf(vector(1, 0, 0, 0)),
          }),
        }),
        emitter({
          alphaErosionDefinition: struct(nameHash("VfxAlphaErosionDefinitionData"), {
            erosionMapName: { type: "asset", path: "assets/shards.dds", asset: held },
            erosionMapAddressMode: number(1),
            UseLingerErosionDriveCurve: { type: "bool", value: true },
            LingerErosionDriveCurve: constantOf(number(0.5)),
          }),
        }),
        emitter({}),
      ]),
    ).emitters;

    expect(own.erosion).toMatchObject({
      map: null,
      featherIn: 0.1,
      featherOut: 0.2,
      sliceWidth: 1.7,
      lingerDrive: null,
      addressMode: ADDRESS_MODE.mirror,
    });
    expect(own.erosion?.drive.keys).toEqual([
      { time: 0, values: [0] },
      { time: 0.8, values: [1] },
    ]);
    expect(own.erosion?.mixer.constant).toEqual([1, 0, 0, 0]);

    expect(mapped.erosion?.map).toEqual({ path: "assets/shards.dds", asset: held });
    /* An authored mirror reaches the sampler as its clamp. */
    expect(mapped.erosion?.addressMode).toBe(ADDRESS_MODE.clamp);
    expect(mapped.erosion?.mixer.constant).toEqual([0, 0, 0, 1]);
    expect(mapped.erosion?.drive.constant).toEqual([1]);
    expect(mapped.erosion?.lingerDrive?.constant).toEqual([0.5]);

    expect(none.erosion).toBeNull();
  });

  it("reads the distortion, whose mode defaults to one and whose map is an asset", () => {
    const held: AssetRef = { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0e0e0e0e" };
    const [own, bare, none] = readVfxSystem(
      system([
        emitter({
          distortionDefinition: struct(nameHash("VfxDistortionDefinitionData"), {
            distortion: number(0.05),
            distortionMode: number(3),
            normalMapTexture: { type: "asset", path: "assets/warp.dds", asset: held },
          }),
        }),
        emitter({ distortionDefinition: struct(nameHash("VfxDistortionDefinitionData"), {}) }),
        emitter({}),
      ]),
    ).emitters;

    expect(own.distortion).toEqual({
      strength: 0.05,
      mode: 3,
      map: { path: "assets/warp.dds", asset: held },
    });
    expect(bare.distortion).toEqual({ strength: 0, mode: 1, map: null });
    expect(none.distortion).toBeNull();
  });

  it("reads the reflection block, its unwritten fields at the schema's defaults", () => {
    const held: AssetRef = { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0c0c0c0c" };
    const [own, bare, none] = readVfxSystem(
      system([
        emitter({
          reflectionDefinition: struct(nameHash("VfxReflectionDefinitionData"), {
            fresnel: number(0.1),
            fresnelColor: vector(0.99, 0.5, 0, 1),
            reflectionFresnel: number(0.6),
            reflectionMapTexture: {
              type: "asset",
              path: "assets/shared/particles/aatrox_cubemap.dds",
              asset: held,
            },
            reflectionOpacityDirect: number(0.3),
            reflectionOpacityGlancing: number(0.2),
          }),
        }),
        emitter({ reflectionDefinition: struct(nameHash("VfxReflectionDefinitionData"), {}) }),
        emitter({}),
      ]),
    ).emitters;

    expect(own.reflection).toEqual({
      fresnel: 0.1,
      fresnelColor: [0.99, 0.5, 0, 1],
      reflectionFresnel: 0.6,
      reflectionFresnelColor: [1, 1, 1, 1],
      opacityDirect: 0.3,
      opacityGlancing: 0.2,
      map: { path: "assets/shared/particles/aatrox_cubemap.dds", asset: held },
    });
    expect(bare.reflection).toEqual({
      fresnel: 1,
      fresnelColor: [0, 0, 0, 0],
      reflectionFresnel: 1,
      reflectionFresnelColor: [1, 1, 1, 1],
      opacityDirect: 0,
      opacityGlancing: 1,
      map: null,
    });
    expect(none.reflection).toBeNull();
  });

  it("reads the soft particle block, every field defaulting to zero", () => {
    const [own, bare, none] = readVfxSystem(
      system([
        emitter({
          softParticleParams: struct(nameHash("VfxSoftParticleDefinitionData"), {
            beginIn: number(20),
            deltaIn: number(10),
            deltaOut: number(30),
          }),
        }),
        emitter({ softParticleParams: struct(nameHash("VfxSoftParticleDefinitionData"), {}) }),
        emitter({}),
      ]),
    ).emitters;

    expect(own.soft).toEqual({ beginIn: 20, deltaIn: 10, beginOut: 0, deltaOut: 30 });
    expect(bare.soft).toEqual({ beginIn: 0, deltaIn: 0, beginOut: 0, deltaOut: 0 });
    expect(none.soft).toBeNull();
  });

  it("reads each spawn shape off the class SpawnShape holds", () => {
    const shapes = readVfxSystem(
      system([
        emitter({
          SpawnShape: struct(nameHash("VfxShapePointDoNotUse"), { emitOffset: vector(0, 10, 0) }),
        }),
        emitter({
          SpawnShape: struct(nameHash("VfxShapeBox"), { Size: vector(1, 2, 3), flags: number(1) }),
        }),
        emitter({
          SpawnShape: struct(nameHash("VfxShapeCylinder"), {
            radius: number(5),
            height: number(7),
          }),
        }),
        emitter({ SpawnShape: struct(nameHash("VfxShapeSphere"), { radius: number(9) }) }),
        emitter({
          SpawnShape: struct(nameHash("VfxShapeLegacy"), {
            emitOffset: constantOf(vector(1, 1, 1)),
            emitRotationAngles: container(constantOf(number(90))),
            emitRotationAxes: container(vector(0, 0, 1)),
          }),
        }),
        emitter({ SpawnShape: struct(nameHash("VfxShapeVolume"), {}) }),
      ]),
    ).emitters.map((each) => each.shape);

    expect(shapes[0]).toEqual({ kind: "point", offset: [0, 10, 0] });
    expect(shapes[1]).toEqual({ kind: "box", size: [1, 2, 3], volume: true });
    expect(shapes[2]).toEqual({ kind: "cylinder", radius: 5, height: 7, volume: false });
    expect(shapes[3]).toEqual({ kind: "sphere", radius: 9, volume: false });
    expect(shapes[4]).toMatchObject({
      kind: "legacy",
      offset: { constant: [1, 1, 1] },
      angles: [{ constant: [90] }],
      axes: [[0, 0, 1]],
    });
    expect(shapes[5]).toEqual({ kind: "point", offset: [0, 0, 0] });
  });

  it("reads the trail a trail primitive carries, at its defaults where it writes none", () => {
    const [camera, arbitrary] = readVfxSystem(
      system([
        emitter({
          primitive: struct(nameHash("VfxPrimitiveCameraTrail"), {
            mTrail: struct(nameHash("VfxTrailDefinitionData"), {
              mCutoff: number(50),
              mBirthTilingSize: constantOf(vector(100, 0, 0)),
              mMode: number(1),
            }),
          }),
        }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveArbitraryTrail"), {}) }),
      ]),
    ).emitters;

    expect(camera.trail).toMatchObject({ cutoff: 50, mode: 1, tiling: { constant: [100, 0, 0] } });
    expect(arbitrary.trail).toEqual({
      mode: 0,
      smoothing: 0,
      maxAddedPerFrame: 0,
      tiling: { constant: [0, 0, 0], keys: [], tables: [] },
      cutoff: 0,
    });
    expect(camera.beam).toBeNull();
  });

  it("reads the beam a beam primitive carries, and a segment beam at every default", () => {
    const [beam, segment] = readVfxSystem(
      system([
        emitter({
          primitive: struct(nameHash("VfxPrimitiveBeam"), {
            mBeam: struct(nameHash("VfxBeamDefinitionData"), {
              mSegments: number(8),
              mMode: number(1),
              mLocalSpaceTargetOffset: vector(0, 50, 0),
              mIsColorBindedWithDistance: { type: "bool", value: true },
            }),
          }),
        }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveCameraSegmentBeam"), {}) }),
      ]),
    ).emitters;

    expect(beam.beam).toMatchObject({
      segments: 8,
      mode: 1,
      targetOffset: [0, 50, 0],
      sourceOffset: [0, 0, 0],
      colorBoundToDistance: true,
    });
    expect(segment.beam).toMatchObject({ segments: 0, mode: 0 });
    expect(segment.trail).toBeNull();
  });

  it("reads where the emitter stands and which space its particles are stored in", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          EmitterPosition: constantOf(vector(1, 2, 3)),
          IsEmitterSpace: { type: "bool", value: true },
        }),
      ]),
    ).emitters;

    expect(only.emitterPosition.constant).toEqual([1, 2, 3]);
    expect(only.emitterSpace).toBe(true);
  });

  it("reads the birth rotational acceleration, whose name carries no trailing zero", () => {
    const [only] = readVfxSystem(
      system([emitter({ birthRotationalAcceleration: constantOf(vector(0, 0, 40)) })]),
    ).emitters;

    expect(only.birthRotationalAcceleration.constant).toEqual([0, 0, 40]);
  });

  it("reads the orbital velocity a particle turns about the origin at", () => {
    const [only] = readVfxSystem(
      system([emitter({ birthOrbitalVelocity: constantOf(vector(0, 1, 0)) })]),
    ).emitters;

    expect(only.birthOrbitalVelocity.constant).toEqual([0, 1, 0]);
  });

  it("reads the birth drag a particle damps by on top of the emitter's own", () => {
    const [only] = readVfxSystem(
      system([
        emitter({ drag: constantOf(vector(1, 1, 1)), birthDrag: constantOf(vector(5, 0, 5)) }),
      ]),
    ).emitters;

    expect(only.drag.constant).toEqual([1, 1, 1]);
    expect(only.birthDrag.constant).toEqual([5, 0, 5]);
  });

  it("reads the world acceleration the draw offsets a particle by", () => {
    const [only] = readVfxSystem(
      system([emitter({ worldAcceleration: constantOf(vector(0, -1800, 0)) })]),
    ).emitters;

    expect(only.worldAcceleration.constant).toEqual([0, -1800, 0]);
  });

  it("reads the bind weight a rig carries a particle by", () => {
    const [only] = readVfxSystem(system([emitter({ bindWeight: constantOf(number(1)) })])).emitters;

    expect(only.bindWeight.constant).toEqual([1]);
  });

  it("reads a constant off the value class the field holds", () => {
    const [only] = readVfxSystem(
      system([emitter({ rate: constantOf(number(12)), lifetime: number(2.5) })]),
    ).emitters;

    expect(only.rate.constant).toEqual([12]);
    expect(only.rate.keys).toEqual([]);
    expect(only.lifetime).toBe(2.5);
  });

  it("reads a curve's probability tables, one per channel slot and none for a null slot", () => {
    const table = (times: number[], values: number[]) =>
      struct(nameHash("VfxProbabilityTableData"), {
        keyTimes: container(...times.map(number)),
        keyValues: container(...values.map(number)),
      });
    const [only] = readVfxSystem(
      system([
        emitter({
          birthVelocity: struct(nameHash("ValueVector3"), {
            constantValue: vector(-400, 0, 0),
            dynamics: struct(nameHash("VfxAnimatedVector3fVariableData"), {
              probabilityTables: container(
                table([0, 1], [0, 1]),
                { type: "null" },
                table([], []),
                table([0, 0.5, 1], [2, 3]),
              ),
            }),
          }),
          rate: constantOf(number(1)),
        }),
      ]),
    ).emitters;

    expect(only.birthVelocity.tables).toEqual([
      {
        channel: 0,
        single: 1,
        keys: [
          { time: 0, values: [0] },
          { time: 1, values: [1] },
        ],
      },
      { channel: 2, single: 1, keys: [] },
      /* Lists of two lengths are worth nothing. */
      { channel: 3, single: 0, keys: [] },
    ]);
    expect(only.rate.tables).toEqual([]);
  });

  it("pairs a curve's two lists into keys and drops the tail neither reaches", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          scale0: keyed([0, 0.5, 1], [vector(1, 1, 1), vector(2, 2, 2)]),
        }),
      ]),
    ).emitters;

    expect(only.scale0.keys).toEqual([
      { time: 0, values: [1, 1, 1] },
      { time: 0.5, values: [2, 2, 2] },
    ]);
  });

  it("carries the texture's reference and the path the emitter named", () => {
    const asset: AssetRef = { kind: "gameChunk", wad: "Smolder.wad.client", pathHash: "0f0f0f0f" };
    const [only] = readVfxSystem(
      system([
        emitter({
          texture: { type: "asset", path: "assets/particle.dds", asset },
        }),
      ]),
    ).emitters;

    expect(only.texture).toEqual({ path: "assets/particle.dds", asset });
  });

  it("reads a texture the install does not ship as a path with no reference", () => {
    const [only] = readVfxSystem(
      system([emitter({ texture: { type: "asset", path: "assets/gone.dds", asset: null } })]),
    ).emitters;

    expect(only.texture).toEqual({ path: "assets/gone.dds", asset: null });
  });

  it("reads the primitive's class as its quad type", () => {
    const [ray, none] = readVfxSystem(
      system([emitter({ primitive: struct(nameHash("VfxPrimitiveRay"), {}) }), emitter({})]),
    ).emitters;

    expect(ray.quadType).toBe(QUAD_TYPE.ray);
    expect(none.quadType).toBe(QUAD_TYPE.cameraQuad);
    expect(none.primitiveClass).toBeNull();
  });

  it("reads a primitive class with no kind as undrawn rather than as a camera quad", () => {
    const classes = [
      "VfxPrimitiveLaser",
      "VfxPrimitiveRibbon",
      "VfxPrimitiveCameraSegmentSeriesBeam",
      "VfxPrimitiveNonRenderable",
    ];

    const { emitters } = readVfxSystem(
      system(classes.map((named) => emitter({ primitive: struct(nameHash(named), {}) }))),
    );

    expect(emitters.map((held) => held.quadType)).toEqual(classes.map(() => null));
    expect(emitters.map(isUndrawn)).toEqual(classes.map(() => true));
    expect(emitters.map((held) => held.primitiveClass)).toEqual(classes.map(nameHash));
  });

  it("reads the unit quad as a camera kind of its own", () => {
    const [camera, unit] = readVfxSystem(
      system([
        emitter({ primitive: struct(nameHash("VfxPrimitiveCameraQuad"), {}) }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveCameraUnitQuad"), {}) }),
      ]),
    ).emitters;

    expect(unit.quadType).toBe(QUAD_TYPE.cameraUnitQuad);
    expect([camera, unit].map(drawsAsQuad)).toEqual([true, true]);
    expect([camera, unit].map(facesTheCamera)).toEqual([true, true]);
    expect([camera, unit].map(isUnitQuad)).toEqual([false, true]);
  });

  it("reads the stencil mode and the reference a mode reads", () => {
    const held = (mode: number, ref: number) =>
      emitter({
        stencilMode: { type: "number", value: mode },
        stencilRef: { type: "number", value: ref },
      });

    const [tested, off, past] = readVfxSystem(
      system([held(3, 7), held(0, 7), held(9, 7)]),
    ).emitters;

    expect([tested.stencilMode, tested.stencilRef]).toEqual([STENCIL_MODE.testNotEqual, 7]);
    expect([off.stencilMode, off.stencilRef]).toEqual([STENCIL_MODE.disabled, 0]);
    expect(past.stencilMode).toBe(STENCIL_MODE.disabled);
    expect(readVfxSystem(system([held(4, 1)])).emitters[0].stencilMode).toBe(
      STENCIL_MODE.writeMaskIfTestNotEqual,
    );
  });

  it("falls back to the default blend mode for a byte outside the enum", () => {
    const [held, past] = readVfxSystem(
      system([emitter({ blendMode: number(1) }), emitter({ blendMode: number(99) })]),
    ).emitters;

    expect(held.blendMode).toBe(BLEND_MODE.alpha);
    expect(past.blendMode).toBe(BLEND_MODE.add);
  });

  it("draws the three quad kinds as quads and a mesh as something else", () => {
    const [camera, arbitrary, ray, mesh] = readVfxSystem(
      system([
        emitter({ primitive: struct(nameHash("VfxPrimitiveCameraQuad"), {}) }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveArbitraryQuad"), {}) }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveRay"), {}) }),
        emitter({ primitive: struct(nameHash("VfxPrimitiveMesh"), {}) }),
      ]),
    ).emitters;

    expect([camera, arbitrary, ray].map(drawsAsQuad)).toEqual([true, true, true]);
    expect(drawsAsQuad(mesh)).toBe(false);
    expect([camera, arbitrary, ray].map(facesTheCamera)).toEqual([true, false, false]);
    expect([camera, arbitrary, ray].map(isRay)).toEqual([false, false, true]);
  });

  it("reads the orientation fields an arbitrary quad stands on", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          isRotationEnabled: { type: "bool", value: true },
          isDirectionOriented: { type: "bool", value: true },
          birthRotation0: constantOf(vector(0, 0, 1.5)),
        }),
      ]),
    ).emitters;

    expect(only.rotationEnabled).toBe(true);
    expect(only.directionOriented).toBe(true);
    expect(only.birthRotation0.constant).toEqual([0, 0, 1.5]);
    expect(only.rotation0.constant).toEqual([0, 0, 0]);
  });

  it("reads one whole cell and no transform for an emitter writing no UV field", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.uv.book.divisions).toEqual([1, 1]);
    expect(only.uv.book.frames).toBe(1);
    expect(only.uv.scale.constant).toEqual([1, 1]);
    expect(only.uv.center).toEqual([0.5, 0.5]);
    expect(only.multUv).toBeNull();
    expect(only.multTexture).toBeNull();
  });

  it("reads the grid a flipbook is cut into and how it plays", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          texDiv: vector(4, 2),
          numFrames: number(8),
          startFrame: number(3),
          frameRate: number(12),
          isRandomStartFrame: { type: "bool", value: true },
        }),
      ]),
    ).emitters;

    expect(only.uv.book.divisions).toEqual([4, 2]);
    expect(only.uv.book.frames).toBe(8);
    expect(only.uv.book.start).toBe(3);
    expect(only.uv.book.rate).toBe(12);
    expect(only.uv.book.randomStart).toBe(true);
  });

  it("reads the transform's own fields, flips included", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          uvScale: constantOf(vector(2, 3)),
          uvTransformCenter: vector(0.25, 0.75),
          emitterUvScrollRate: vector(0.5, -0.5),
          TextureFlipU: { type: "bool", value: true },
          uvScrollClamp: { type: "bool", value: true },
          texAddressModeBase: number(2),
        }),
      ]),
    ).emitters;

    expect(only.uv.scale.constant).toEqual([2, 3]);
    expect(only.uv.center).toEqual([0.25, 0.75]);
    expect(only.uv.emitterScrollRate).toEqual([0.5, -0.5]);
    expect(only.uv.flipU).toBe(true);
    expect(only.uv.flipV).toBe(false);
    expect(only.uv.scrollClamp).toBe(true);
    expect(only.uv.addressMode).toBe(ADDRESS_MODE.clamp);
  });

  it("reads textureMult as a layer of its own, under its own field names", () => {
    const held: AssetRef = { kind: "gameChunk", wad: "Smolder.wad.client", pathHash: "0a0a0a0a" };
    const [only] = readVfxSystem(
      system([
        emitter({
          textureMult: struct(nameHash("VfxTextureMultDefinitionData"), {
            textureMult: { type: "asset", path: "assets/detail.dds", asset: held },
            texDivMult: vector(2, 2),
            uvScaleMult: constantOf(vector(4, 4)),
            TextureMultFilpV: { type: "bool", value: true },
          }),
        }),
      ]),
    ).emitters;

    expect(only.multTexture).toEqual({ path: "assets/detail.dds", asset: held });
    expect(only.multUv?.book.divisions).toEqual([2, 2]);
    expect(only.multUv?.scale.constant).toEqual([4, 4]);
    expect(only.multUv?.flipV).toBe(true);
    expect(only.multUv?.flipU).toBe(false);
  });

  it("gives the mult layer the base layer's book, which is the one frame counter", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          numFrames: number(6),
          frameRate: number(24),
          startFrame: number(2),
          isRandomStartFrame: { type: "bool", value: true },
          textureMult: struct(nameHash("VfxTextureMultDefinitionData"), {
            texDivMult: vector(3, 2),
            isRandomStartFrameMult: { type: "bool", value: false },
          }),
        }),
      ]),
    ).emitters;

    expect(only.multUv?.book.frames).toBe(6);
    expect(only.multUv?.book.rate).toBe(24);
    expect(only.multUv?.book.start).toBe(2);
    /* `isRandomStartFrameMult` is written and never read, so the base layer's decides. */
    expect(only.multUv?.book.randomStart).toBe(true);
    /* Its own grid, though, because `texDivMult` is a name the mult layer does carry. */
    expect(only.multUv?.book.divisions).toEqual([3, 2]);
  });

  it("falls back to the default UV mode for a byte outside the enum", () => {
    const [held, past] = readVfxSystem(
      system([emitter({ uvMode: number(3) }), emitter({ uvMode: number(42) })]),
    ).emitters;

    expect(held.uvMode).toBe(UV_MODE.localSpace);
    expect(past.uvMode).toBe(UV_MODE.default);
  });

  it("answers an empty system for a root that is no object", () => {
    const model = readVfxSystem({
      entry: "0xdeadbeef",
      name: null,
      classHash: nameHash("VfxSystemDefinitionData"),
      class: null,
      root: { type: "null" },
    });

    expect(model.entry).toBe("0xdeadbeef");
    expect(model.emitters).toEqual([]);
  });
});

describe("the mesh a primitive names", () => {
  const SKIN: AssetRef = { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0a0a0a0a" };
  const SCB: AssetRef = { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0b0b0b0b" };

  function hash(name: string): VfxValue {
    return { type: "hash", hash: nameHash(name), name };
  }

  function meshEmitter(mesh: Record<string, VfxValue>): VfxValue {
    return emitter({
      primitive: struct(nameHash("VfxPrimitiveMesh"), {
        mMesh: struct(nameHash("VfxMeshDefinitionData"), mesh),
      }),
    });
  }

  function attachedEmitter(mesh: Record<string, VfxValue>): VfxValue {
    return emitter({
      primitive: struct(nameHash("VfxPrimitiveAttachedMesh"), {
        mMesh: struct(nameHash("VfxMeshDefinitionData"), mesh),
      }),
    });
  }

  it("reads the skin of a whole pair, and both submesh lists", () => {
    const [only] = readVfxSystem(
      system([
        meshEmitter({
          mMeshName: { type: "asset", path: "assets/aatrox.skn", asset: SKIN },
          mMeshSkeletonName: { type: "asset", path: "assets/aatrox.skl", asset: null },
          mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB },
          mSubmeshesToDraw: container(hash("body")),
          mSubmeshesToDrawAlways: container(hash("cape"), hash("wings")),
        }),
      ]),
    ).emitters;

    expect(only.mesh?.asset).toEqual(SKIN);
    expect(only.mesh?.submeshes).toEqual([nameHash("body")]);
    expect(only.mesh?.submeshesAlways).toEqual([nameHash("cape"), nameHash("wings")]);
  });

  it("says which slot the geometry came out of, which is the look-at the alignment takes", () => {
    const [skin, simple] = readVfxSystem(
      system([
        meshEmitter({
          mMeshName: { type: "asset", path: "assets/blade.skn", asset: SKIN },
          mMeshSkeletonName: { type: "asset", path: "assets/blade.skl", asset: SKIN },
        }),
        meshEmitter({ mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB } }),
      ]),
    ).emitters;

    expect([skin.mesh?.skinned, simple.mesh?.skinned]).toEqual([true, false]);
  });

  it("falls to the simple mesh where the pair is not whole", () => {
    const skinAlone = meshEmitter({
      mMeshName: { type: "asset", path: "assets/aatrox.skn", asset: SKIN },
      mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB },
    });
    const skeletonEmpty = meshEmitter({
      mMeshName: { type: "asset", path: "assets/aatrox.skn", asset: SKIN },
      mMeshSkeletonName: { type: "asset", path: "DoesNotExist.skl", asset: null },
      mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB },
    });
    const skinEmpty = meshEmitter({
      mMeshName: { type: "asset", path: "assets/doesnotexist.skn", asset: SKIN },
      mMeshSkeletonName: { type: "asset", path: "assets/aatrox.skl", asset: null },
      mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB },
    });

    const drawn = readVfxSystem(system([skinAlone, skeletonEmpty, skinEmpty])).emitters;

    expect(drawn.map((each) => each.mesh?.asset)).toEqual([SCB, SCB, SCB]);
    expect(drawn[0].mesh?.submeshesAlways).toEqual([]);
  });

  it("reads no simple mesh under an extension the engine ignores, or the empty name", () => {
    const wrongExtension = meshEmitter({
      mSimpleMeshName: { type: "asset", path: "assets/blade.sco", asset: SCB },
    });
    const empty = meshEmitter({
      mSimpleMeshName: { type: "asset", path: "doesnotexist.scb", asset: SCB },
    });
    const gmesh = meshEmitter({
      mSimpleMeshName: { type: "asset", path: "assets/blade.GMESH", asset: SCB },
    });

    const drawn = readVfxSystem(system([wrongExtension, empty, gmesh])).emitters;

    expect(drawn.map((each) => each.mesh?.asset ?? null)).toEqual([null, null, SCB]);
  });

  it("leaves an attached mesh to its attachment, whether or not it names geometry", () => {
    const named: Record<string, VfxValue> = {
      mSimpleMeshName: { type: "asset", path: "assets/blade.scb", asset: SCB },
    };
    const [attached, bare, plain] = readVfxSystem(
      system([attachedEmitter(named), attachedEmitter({}), meshEmitter(named)]),
    ).emitters;

    expect(attached.quadType).toBe(QUAD_TYPE.attachedMesh);
    expect([attached, bare, plain].map(drawsAsMesh)).toEqual([false, false, true]);
    expect([attached, bare, plain].map(drawsTheAttachment)).toEqual([true, true, false]);
    expect([attached, bare, plain].map(isUndrawn)).toEqual([false, false, false]);
  });
});

describe("child particle sets", () => {
  function childSet(fields: Record<string, VfxValue>): VfxValue {
    return struct(nameHash("VfxChildParticleSetDefinitionData"), fields);
  }

  function identifier(fields: Record<string, VfxValue>): VfxValue {
    return struct(nameHash("VfxChildIdentifier"), fields);
  }

  const spark = struct(nameHash("VfxSystemDefinitionData"), {
    complexEmitterDefinitionData: container(
      emitter({ emitterName: { type: "string", value: "spark" } }),
    ),
  });

  it("reads no child set for an emitter writing none", () => {
    const [only] = readVfxSystem(system([emitter({})])).emitters;

    expect(only.childSet).toBeNull();
  });

  it("reads a child the resolver inlined as a system of its own", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(identifier({ effect: spark })),
          }),
        }),
      ]),
    ).emitters;

    expect(only.childSet?.children[0]?.emitters.map((each) => each.name)).toEqual(["spark"]);
    expect(only.childSet?.onDeath).toBe(false);
    expect(only.childSet?.bones).toEqual([]);
    expect(only.childSet?.probability.constant).toEqual([0]);
    expect(only.childSet?.inheritance).toBeNull();
  });

  it("names a child by the object its link reached", () => {
    const reached = {
      ...(spark as VfxValue & { type: "struct" }),
      object: { entry: "0x0badf00d", name: "particles/spark" },
    };
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(identifier({ effect: reached })),
          }),
        }),
      ]),
    ).emitters;

    expect(only.childSet?.children[0]?.entry).toBe("0x0badf00d");
    expect(only.childSet?.children[0]?.name).toBe("particles/spark");
  });

  it("reads a child the read could not reach as no system, keeping its place", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(
              identifier({ effect: { type: "link", hash: "0x0badf00d", name: null } }),
              identifier({ effectKey: { type: "hash", hash: "0x12345678", name: null } }),
              identifier({ effect: spark }),
            ),
          }),
        }),
      ]),
    ).emitters;

    expect(only.childSet?.children.map((each) => each?.emitters.length ?? null)).toEqual([
      null,
      null,
      1,
    ]);
  });

  it("reads a key the resolver inlined, and a link ahead of a key", () => {
    const smoke = struct(nameHash("VfxSystemDefinitionData"), {
      complexEmitterDefinitionData: container(
        emitter({ emitterName: { type: "string", value: "smoke" } }),
      ),
    });
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(
              identifier({ effectKey: spark }),
              identifier({ effect: smoke, effectKey: spark }),
            ),
          }),
        }),
      ]),
    ).emitters;

    expect(only.childSet?.children.map((each) => each?.emitters[0].name)).toEqual([
      "spark",
      "smoke",
    ]);
  });

  it("reads the death flag, the bones, the probability and the inheritance", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(identifier({ effect: spark })),
            childEmitOnDeath: { type: "bool", value: true },
            boneToSpawnAt: container({ type: "string", value: "R_Hand" }),
            childrenProbability: constantOf(number(2.5)),
            ParentInheritanceDefinition: struct(nameHash("VfxParentInheritanceParams"), {
              Mode: number(10),
              RelativeOffset: struct(nameHash("ValueVector3"), {
                constantValue: vector(1, 2, 3),
                dynamics: { type: "null" },
              }),
            }),
          }),
        }),
      ]),
    ).emitters;

    expect(only.childSet?.onDeath).toBe(true);
    expect(only.childSet?.bones).toEqual(["R_Hand"]);
    expect(only.childSet?.probability.constant).toEqual([2.5]);
    expect(only.childSet?.inheritance?.mode).toBe(10);
    expect(only.childSet?.inheritance?.offset.constant).toEqual([1, 2, 3]);
  });

  it("reads a child's own child set, so a nested system nests", () => {
    const nested = struct(nameHash("VfxSystemDefinitionData"), {
      complexEmitterDefinitionData: container(
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(identifier({ effect: spark })),
          }),
        }),
      ),
    });
    const [only] = readVfxSystem(
      system([
        emitter({
          childParticleSetDefinition: childSet({
            childrenIdentifiers: container(identifier({ effect: nested })),
          }),
        }),
      ]),
    ).emitters;

    const grandchild = only.childSet?.children[0]?.emitters[0].childSet?.children[0];
    expect(grandchild?.emitters.map((each) => each.name)).toEqual(["spark"]);
  });
});

describe("the backface cull", () => {
  it("culls unless disableBackfaceCull is written", () => {
    const [culled, kept] = readVfxSystem(
      system([emitter({}), emitter({ disableBackfaceCull: { type: "bool", value: true } })]),
    ).emitters;

    expect(culled.backfaceCull).toBe(true);
    expect(kept.backfaceCull).toBe(false);
  });
});

describe("the ground layer", () => {
  it("reads isGroundLayer, off where it is not written", () => {
    const [standing, ground] = readVfxSystem(
      system([emitter({}), emitter({ isGroundLayer: { type: "bool", value: true } })]),
    ).emitters;

    expect(standing.groundLayer).toBe(false);
    expect(ground.groundLayer).toBe(true);
  });
});

describe("the force fields", () => {
  function collection(lists: Record<string, VfxValue>): VfxValue {
    return struct(nameHash("VfxFieldCollectionDefinitionData"), lists);
  }

  it("reads each kind's own values, with the schema's defaults where a field is unwritten", () => {
    const [only] = readVfxSystem(
      system([
        emitter({
          fieldCollectionDefinition: collection({
            fieldNoiseDefinitions: container(
              struct(nameHash("VfxFieldNoiseDefinitionData"), {
                axisFraction: vector(1, 0, 1),
                frequency: constantOf(number(10)),
                radius: constantOf(number(500)),
                velocityDelta: constantOf(number(20)),
              }),
            ),
            fieldOrbitalDefinitions: container(
              struct(nameHash("VfxFieldOrbitalDefinitionData"), {}),
            ),
            fieldAccelerationDefinitions: container(
              struct(nameHash("VfxFieldAccelerationDefinitionData"), {
                acceleration: constantOf(vector(0, -500, 0)),
                isLocalSpace: { type: "bool", value: false },
              }),
            ),
          }),
        }),
      ]),
    ).emitters;

    const fields = only.fields;
    expect(fields?.noise[0].axisFraction).toEqual([1, 0, 1]);
    expect(fields?.noise[0].frequency.constant).toEqual([10]);
    expect(fields?.noise[0].radius.constant).toEqual([500]);
    expect(fields?.noise[0].velocityDelta.constant).toEqual([20]);
    expect(fields?.noise[0].position.constant).toEqual([0, 0, 0]);
    expect(fields?.orbital[0].direction.constant).toEqual([0, 1, 0]);
    expect(fields?.orbital[0].localSpace).toBe(true);
    expect(fields?.acceleration[0].acceleration.constant).toEqual([0, -500, 0]);
    expect(fields?.acceleration[0].localSpace).toBe(false);
    expect(fields?.attraction).toEqual([]);
    expect(fields?.drag).toEqual([]);
  });

  it("reads a collection holding no field, and no collection, as none", () => {
    const [empty, absent] = readVfxSystem(
      system([emitter({ fieldCollectionDefinition: collection({}) }), emitter({})]),
    ).emitters;

    expect(empty.fields).toBeNull();
    expect(absent.fields).toBeNull();
  });
});
