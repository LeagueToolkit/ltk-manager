import { describe, expect, it } from "vitest";

import { FORWARD } from "@/modules/viewport";

import { identityInto, yawInto } from "../basis";
import {
  ADDRESS_MODE,
  BLEND_MODE,
  COLOR_LOOKUP,
  DRAG_MOTION,
  type DragMotion,
  LINGER_TYPE,
  QUAD_TYPE,
  STENCIL_MODE,
  TRAIL_MODE,
  TRAIL_SMOOTHING,
  UV_MODE,
} from "../enums";
import {
  createEmitterStates,
  type EmitterState,
  stepEmitters,
  type SystemStep,
} from "../integrate";
import {
  type EmitterModel,
  type ErosionModel,
  type FieldsModel,
  type LegacySimpleModel,
  plainUvLayer,
  POINT_SHAPE,
  type TrailModel,
  type UvLayer,
  type ValueCurve,
} from "../model";
import {
  age01,
  appearance,
  type DrawFrame,
  drawnPlace,
  drawnPlaceInto,
  erosionDrive,
  legacyRoll,
  spinOf,
  standingFrameInto,
  stretchOf,
} from "../particleRead";
import { createPool, FRAME_SLOTS, type Pool, spawn, UV, uvAt } from "../pool";
import { type Motion, originAt, type Point } from "../rig";
import { Rng } from "../Rng";
import { sampleCurveInto } from "../sampleCurve";
import { fixedRateStepper } from "../stepper";
import { ROTATION_RATE } from "../systemModel";

/** A system the rig neither turns nor transforms, which most of a draw reads against. */
const UNTURNED = identityInto(new Float32Array(FRAME_SLOTS));

const AT_ORIGIN: DrawFrame = {
  now: 0,
  phase: 0,
  origin: [0, 0, 0],
  orientation: UNTURNED,
  worldAcceleration: new Float32Array(3),
};

function flat(...constant: number[]): ValueCurve {
  return { constant, keys: [], tables: [] };
}

function keyed(...keys: [number, ...number[]][]): ValueCurve {
  return {
    constant: [0],
    keys: keys.map(([time, ...values]) => ({ time, values })),
    tables: [],
  };
}

function emitterOf(over: Partial<EmitterModel> = {}): EmitterModel {
  return {
    index: 0,
    simple: false,
    listIndex: 0,
    name: "spark",
    disabled: false,
    rate: flat(0),
    particleLifetime: flat(100),
    lifetime: null,
    timeBeforeFirstEmission: 0,
    singleParticle: false,
    sharedRandom: false,
    birthVelocity: flat(0, 0, 0),
    acceleration: flat(0, 0, 0),
    drag: flat(0, 0, 0),
    birthDrag: flat(0, 0, 0),
    velocity: flat(0, 0, 0),
    worldAcceleration: flat(0, 0, 0),
    birthOrbitalVelocity: flat(0, 0, 0),
    bindWeight: flat(0),
    emitterPosition: flat(0, 0, 0),
    emitterSpace: false,
    shape: POINT_SHAPE,
    rotationOverride: [0, 0, 0],
    scaleOverride: [1, 1, 1],
    translationOverride: [0, 0, 0],
    localOrientation: true,
    particleLocalOrientation: false,
    uniformScale: false,
    particleLinger: 0,
    emitterLinger: 0,
    lingerType: LINGER_TYPE.maxLifetimeAfterEmitterDies,
    linger: null,
    palette: null,
    erosion: null,
    distortion: null,
    reflection: null,
    soft: null,
    lookupX: COLOR_LOOKUP.lifetime,
    lookupY: COLOR_LOOKUP.constant,
    lookupOffsets: [0, 0],
    lookupScales: [1, 1],
    colorTexture: null,
    uv: plainUvLayer(),
    uvMode: UV_MODE.default,
    multTexture: null,
    multUv: null,
    rotation0: flat(0, 0, 0),
    birthRotation0: flat(0, 0, 0),
    birthRotationalVelocity0: flat(0, 0, 0),
    birthRotationalAcceleration: flat(0, 0, 0),
    legacySimple: null,
    pivotUp: false,
    rotationEnabled: false,
    directionOriented: false,
    directionVelocityScale: 0,
    directionVelocityMinScale: 1,
    scale0: flat(1, 1, 1),
    birthScale0: flat(1, 1, 1),
    color: flat(1, 1, 1, 1),
    birthColor: flat(1, 1, 1, 1),
    texture: null,
    blendMode: BLEND_MODE.add,
    pass: 0,
    miscRenderFlags: 0,
    groundLayer: false,
    alphaRef: 0,
    quadType: QUAD_TYPE.cameraQuad,
    stencilMode: STENCIL_MODE.disabled,
    stencilRef: 0,
    primitiveClass: null,
    primitiveName: null,
    mesh: null,
    trail: null,
    beam: null,
    childSet: null,
    fields: null,
    depthBias: [0, 0],
    depthPushPull: 0,
    backfaceCull: true,
    ...over,
  };
}

interface Run {
  readonly pool: Pool;
  readonly state: EmitterState[];
  readonly emitters: readonly EmitterModel[];
  step(count?: number): void;
}

const STILL: Motion = { kind: "still" };

function run(
  emitters: readonly EmitterModel[],
  dt = 0.25,
  capacity = 256,
  seed = 1,
  motion: Motion = STILL,
  stopAt: number | null = null,
  facing: Point = FORWARD,
  dragMotion: DragMotion = DRAG_MOTION.stepped,
): Run {
  const system = { entry: null, name: null, emitters, transform: null, dragMotion, buildUpTime: 0 };
  const pool = createPool(capacity);
  const state = createEmitterStates(emitters);
  const stepper = fixedRateStepper(1 / dt);
  const rng = new Rng(seed);
  const yaw = yawInto(facing, new Float32Array(9));
  const world = identityInto(new Float32Array(9));
  let origin = originAt(motion, 0);

  return {
    pool,
    state,
    emitters,
    step(count = 1) {
      for (let frame = 0; frame < count; frame += 1) {
        for (const step of stepper.advance(dt)) {
          const now = originAt(motion, step.now);
          const moved: Point = [now[0] - origin[0], now[1] - origin[1], now[2] - origin[2]];
          const placed: SystemStep = {
            dt: step.dt,
            now: step.now,
            origin: now,
            moved,
            yaw,
            world,
            stopped: stopAt !== null && step.now >= stopAt,
          };
          stepEmitters(pool, system, placed, rng, state);
          origin = now;
        }
      }
    },
  };
}

function vec3(array: Float32Array, index: number): number[] {
  return Array.from(array.subarray(index * 3, index * 3 + 3));
}

describe("stepEmitters", () => {
  it("births a particle at the emitter origin, moving at the birth velocity", () => {
    const sim = run([emitterOf({ birthVelocity: flat(1, 2, 3) })]);
    sim.step();

    expect(sim.pool.count).toBe(1);
    expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
    expect(vec3(sim.pool.velocity, 0)).toEqual([1, 2, 3]);
  });

  it("carries a particle at its velocity once a later step moves it", () => {
    const sim = run([emitterOf({ birthVelocity: flat(1, 2, 3) })], 1);
    sim.step(3);

    expect(vec3(sim.pool.position, 0)).toEqual([2, 4, 6]);
  });

  it("adds the emitter's acceleration to the velocity before it moves the particle", () => {
    const sim = run([emitterOf({ acceleration: flat(0, -10, 0) })], 1);
    sim.step(3);

    expect(vec3(sim.pool.velocity, 0)).toEqual([0, -20, 0]);
    expect(vec3(sim.pool.position, 0)).toEqual([0, -30, 0]);
  });

  it("eases a velocity toward zero under a drag it can absorb", () => {
    const sim = run([emitterOf({ birthVelocity: flat(10, 0, 0), drag: flat(0.5, 0, 0) })], 1);
    sim.step(2);
    expect(sim.pool.velocity[0]).toBeCloseTo(5, 5);

    sim.step();
    expect(sim.pool.velocity[0]).toBeCloseTo(2.5, 5);
  });

  it("never pushes a velocity across zero, however large the drag", () => {
    const sim = run([emitterOf({ birthVelocity: flat(10, -4, 0), drag: flat(100, 100, 0) })], 1);
    sim.step(4);

    expect(sim.pool.velocity[0]).toBe(0);
    expect(sim.pool.velocity[1]).toBe(0);
  });

  it("drags the emitter's own velocity and leaves the change on the particle's", () => {
    const sim = run([emitterOf({ velocity: flat(10, 0, 0), drag: flat(0.5, 0, 0) })], 1);

    /* The drift is dragged from 10 to 5, and the particle's own velocity absorbs the 5. */
    sim.step(2);
    expect(sim.pool.velocity[0]).toBeCloseTo(-5, 5);
    expect(sim.pool.position[0]).toBeCloseTo(5, 5);

    sim.step();
    expect(sim.pool.velocity[0]).toBeCloseTo(-7.5, 5);
    expect(sim.pool.position[0]).toBeCloseTo(7.5, 5);
  });

  it("drags a particle by its birth drag where the emitter keys none", () => {
    const sim = run([emitterOf({ birthVelocity: flat(10, 0, 0), birthDrag: flat(0.5, 0, 0) })], 1);
    sim.step(2);
    expect(sim.pool.velocity[0]).toBeCloseTo(5, 5);

    sim.step();
    expect(sim.pool.velocity[0]).toBeCloseTo(2.5, 5);
  });

  it("sums the birth drag into the emitter's own, per axis", () => {
    const sim = run(
      [
        emitterOf({
          birthVelocity: flat(10, 10, 10),
          drag: flat(0.25, 0.5, 0),
          birthDrag: flat(0.25, 0, 0),
        }),
      ],
      1,
    );
    sim.step(2);

    expect(sim.pool.velocity[0]).toBeCloseTo(5, 5);
    expect(sim.pool.velocity[1]).toBeCloseTo(5, 5);
    expect(sim.pool.velocity[2]).toBeCloseTo(10, 5);
  });

  it("holds the birth drag at what the particle was born under", () => {
    const sim = run(
      [
        emitterOf({
          lifetime: 10,
          birthVelocity: flat(10, 0, 0),
          birthDrag: keyed([0, 0, 0, 0], [0.5, 0, 0, 0], [0.6, 100, 100, 100]),
        }),
      ],
      1,
    );
    sim.step(8);

    expect(vec3(sim.pool.birthDrag, 0)).toEqual([0, 0, 0]);
    expect(sim.pool.velocity[0]).toBeCloseTo(10, 5);
  });

  describe("under kAnalyticDragMotion", () => {
    const analytic = (emitters: readonly EmitterModel[], dt: number) =>
      run(emitters, dt, 256, 1, STILL, null, FORWARD, DRAG_MOTION.analytic);

    it("zeroes the birth velocity and eases out to it over the birth drag", () => {
      const sim = analytic(
        [emitterOf({ birthVelocity: flat(100, 0, 0), birthDrag: flat(4, 0, 0) })],
        0.05,
      );
      sim.step();
      expect(vec3(sim.pool.velocity, 0)).toEqual([0, 0, 0]);

      sim.step(200);
      expect(sim.pool.position[0]).toBeCloseTo(25, 3);
    });

    it("stands where the closed form puts it at an age, whatever the step", () => {
      const emitters = [emitterOf({ birthVelocity: flat(-400, 0, 0), birthDrag: flat(10, 0, 0) })];
      const eased = -40 * (1 - Math.exp(-1));

      const coarse = analytic(emitters, 0.05);
      coarse.step(1 + 2);
      const fine = analytic(emitters, 0.01);
      fine.step(1 + 10);

      expect(coarse.pool.position[0]).toBeCloseTo(eased, 3);
      expect(fine.pool.position[0]).toBeCloseTo(eased, 3);

      const stepped = run(emitters, 0.05);
      stepped.step(1 + 2);
      expect(stepped.pool.position[0]).not.toBeCloseTo(eased, 1);
    });

    it("never moves an axis no birth drag damps off its birth velocity", () => {
      const sim = analytic(
        [emitterOf({ birthVelocity: flat(100, 0, 0), drag: flat(4, 0, 0) })],
        0.05,
      );
      sim.step(20);

      expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
    });

    it("steps a negative drag rather than easing it, which overflows the closed form", () => {
      const sim = analytic([emitterOf({ drag: flat(-800, 0, 0) })], 1);
      sim.step(3);

      expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
      expect(vec3(sim.pool.velocity, 0)).toEqual([0, 0, 0]);
    });

    it("leaves the acceleration undamped", () => {
      const sim = analytic(
        [
          emitterOf({
            acceleration: flat(0, -10, 0),
            drag: flat(0, 4, 0),
            birthDrag: flat(0, 4, 0),
          }),
        ],
        1,
      );
      sim.step(3);

      expect(vec3(sim.pool.velocity, 0)).toEqual([0, -20, 0]);
      expect(vec3(sim.pool.position, 0)).toEqual([0, -30, 0]);
    });
  });

  it("retires a particle when its lifetime passes", () => {
    const sim = run([emitterOf({ particleLifetime: flat(1) })]);
    sim.step(4);
    expect(sim.pool.count).toBe(1);

    sim.step();
    expect(sim.pool.count).toBe(0);
  });

  it("emits one particle from an emitter authored at no rate", () => {
    const sim = run([emitterOf({ rate: flat(0) })]);
    sim.step(10);

    expect(sim.pool.count).toBe(1);
  });

  it("holds the first spawn until timeBeforeFirstEmission", () => {
    const sim = run([emitterOf({ rate: flat(4), timeBeforeFirstEmission: 0.5 })]);
    sim.step();
    expect(sim.pool.count).toBe(0);

    sim.step();
    expect(sim.pool.count).toBe(1);
  });

  it("emits a single-particle emitter's whole burst once and never again", () => {
    const sim = run([emitterOf({ rate: flat(5), singleParticle: true })]);
    sim.step();
    expect(sim.pool.count).toBe(5);

    sim.step(20);
    expect(sim.pool.count).toBe(5);
  });

  it("caps a step's spawns at a third of the rate plus one", () => {
    const sim = run([emitterOf({ rate: flat(100) })], 1);
    sim.step();

    expect(sim.pool.count).toBe(34);
  });

  it("holds the average rate across steps, spending the remainder a cap left behind", () => {
    const sim = run([emitterOf({ rate: flat(10) })], 0.25);
    sim.step(8);

    expect(sim.pool.count).toBe(20);
  });

  it("stops emitting once the emitter's lifetime passes, keeping what is already alive", () => {
    const sim = run([emitterOf({ rate: flat(10), lifetime: 0.5 })]);
    sim.step(2);
    const emitted = sim.pool.count;

    sim.step(10);
    expect(sim.pool.count).toBe(emitted);
    expect(emitted).toBeGreaterThan(0);
  });

  it("emits nothing from a disabled emitter, and everything from the one beside it", () => {
    const sim = run([
      emitterOf({ rate: flat(8), disabled: true }),
      emitterOf({ rate: flat(8), index: 1 }),
    ]);
    sim.step(4);

    expect(sim.pool.count).toBeGreaterThan(0);
    expect(Array.from(sim.pool.emitter.subarray(0, sim.pool.count))).not.toContain(0);
  });

  it("reads a curve driven by the emitter's life against that lifetime", () => {
    const sim = run([
      emitterOf({
        rate: flat(0),
        particleLifetime: flat(100),
        lifetime: 1,
        acceleration: keyed([0, 0, 0, 0], [1, 0, 4, 0]),
      }),
    ]);
    sim.step(3);

    expect(sim.pool.velocity[1]).toBeCloseTo(4 * 0.5 * 0.25 + 4 * 0.75 * 0.25, 4);
  });

  it("yaws a birth to the system's facing, velocity and placement alike", () => {
    const sim = run(
      [emitterOf({ birthVelocity: flat(0, 0, 10), translationOverride: [0, 0, 5] })],
      0.25,
      256,
      1,
      STILL,
      null,
      [1, 0, 0],
    );
    sim.step();

    expect(vec3(sim.pool.velocity, 0).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([
      10, 0, 0,
    ]);
    /* Born at the step's end, so a quarter second of flight lands past the offset. */
    expect(sim.pool.position[0]).toBeCloseTo(5, 4);
    expect(sim.pool.position[2]).toBeCloseTo(0, 4);
  });

  it("stands a birth on rotationOverride, scaled by scaleOverride", () => {
    const sim = run([
      emitterOf({
        birthVelocity: flat(0, 0, 10),
        rotationOverride: [0, 90, 0],
        scaleOverride: [2, 1, 1],
        shape: { kind: "point", offset: [1, 0, 0] },
      }),
    ]);
    sim.step();

    expect(vec3(sim.pool.velocity, 0).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([
      10, 0, 0,
    ]);
    /* The point's own offset is scaled along x and turned onto -z. */
    expect(sim.pool.position[0]).toBeCloseTo(0, 4);
    expect(sim.pool.position[2]).toBeCloseTo(-2, 4);
  });

  it("leaves the system's facing out of the frame where isLocalOrientation is off", () => {
    const sim = run(
      [emitterOf({ birthVelocity: flat(0, 0, 10), localOrientation: false })],
      0.25,
      256,
      1,
      STILL,
      null,
      [1, 0, 0],
    );
    sim.step();

    expect(vec3(sim.pool.velocity, 0)).toEqual([0, 0, 10]);
  });

  it("turns the emitter's acceleration and drift by the frame a particle was born in", () => {
    const sim = run(
      [emitterOf({ acceleration: flat(0, 0, 100), velocity: flat(0, 0, 4) })],
      0.25,
      256,
      1,
      STILL,
      null,
      [1, 0, 0],
    );
    sim.step(2);

    expect(sim.pool.velocity[0]).toBeCloseTo(25, 4);
    expect(sim.pool.velocity[2]).toBeCloseTo(0, 4);
    /* A quarter second at 25 plus the drift's 4, along x. */
    expect(sim.pool.position[0]).toBeCloseTo((25 + 4) * 0.25, 4);
  });

  it("replays the same pool from the same seed", () => {
    const emitters = [emitterOf({ rate: flat(30), particleLifetime: flat(0.6) })];
    const first = run(emitters, 0.05, 256, 4321);
    const second = run(emitters, 0.05, 256, 4321);
    first.step(40);
    second.step(40);

    expect(second.pool.count).toBe(first.pool.count);
    expect(Array.from(second.pool.roll)).toEqual(Array.from(first.pool.roll));
    expect(Array.from(second.pool.position)).toEqual(Array.from(first.pool.position));
    expect(Array.from(second.pool.birthTime)).toEqual(Array.from(first.pool.birthTime));
  });
});

describe("appearance", () => {
  const out = { scale: new Float32Array(3), color: new Float32Array(4) };

  function at(pool: Pool, emitter: EmitterModel, now: number) {
    appearance(pool, 0, emitter, now, out);
    return { scale: Array.from(out.scale), color: Array.from(out.color) };
  }

  it("multiplies the birth scale by the lifetime curve at the particle's age", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);
    pool.birthScale.set([2, 2, 2], 0);
    const emitter = emitterOf({ scale0: keyed([0, 1, 1, 1], [1, 3, 3, 3]) });

    expect(at(pool, emitter, 1).scale).toEqual([4, 4, 4]);
  });

  it("serves the first scale component to every axis under isUniformScale", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);
    pool.birthScale.set([20, 2, 2], 0);
    const emitter = emitterOf({ scale0: flat(1, 0.5, 0.5), uniformScale: true });

    expect(at(pool, emitter, 1).scale).toEqual([20, 20, 20]);
  });

  it("multiplies the birth colour by the lifetime curve at the particle's age", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);
    pool.birthColor.set([1, 0.5, 1, 1], 0);
    const emitter = emitterOf({ color: keyed([0, 1, 1, 1, 1], [1, 0, 0, 0, 0]) });

    expect(at(pool, emitter, 1).color).toEqual([0.5, 0.25, 0.5, 0.5]);
  });

  it("holds the curve at its end for a particle at or past its lifetime", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);
    const emitter = emitterOf({ scale0: keyed([0, 1, 1, 1], [1, 3, 3, 3]) });

    expect(at(pool, emitter, 2).scale).toEqual([3, 3, 3]);
    expect(at(pool, emitter, 9).scale).toEqual([3, 3, 3]);
  });

  it("reads the curve at its start for a particle younger than its birth", () => {
    const pool = createPool(1);
    spawn(pool, 0, 4, 2, 0);
    const emitter = emitterOf({ scale0: keyed([0, 1, 1, 1], [1, 3, 3, 3]) });

    expect(at(pool, emitter, 0).scale).toEqual([1, 1, 1]);
  });

  it("leaves the birth value alone on a channel a narrower curve does not carry", () => {
    /* A type-mismatched bin authors a `Vec3` as one float. */
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);
    pool.birthScale.set([2, 3, 4], 0);
    pool.birthColor.set([1, 1, 1, 1], 0);
    at(pool, emitterOf({ scale0: flat(5, 5, 5), color: flat(0.25, 0.25, 0.25, 0.25) }), 1);

    const narrow = emitterOf({ scale0: flat(1), color: flat(0.5) });

    expect(at(pool, narrow, 1)).toEqual({ scale: [2, 3, 4], color: [0.5, 1, 1, 1] });
  });
});

describe("rotation", () => {
  it("stands a particle at its birth rotation", () => {
    const held = run([emitterOf({ rate: flat(4), birthRotation0: flat(0, 0, 1.5) })]);

    held.step();

    expect(held.pool.rotation[2]).toBeCloseTo(1.5, 6);
  });

  it("turns a particle by rotation0 scaled to the second it is authored against", () => {
    /* `rotation0` is authored per 1/60 s and the engine multiplies by 60, so one unit
       over a quarter second is 15 radians. */
    const held = run([
      emitterOf({ rate: flat(4), rotation0: flat(0, 0, 1), rotationEnabled: true }),
    ]);

    held.step(2);

    expect(held.pool.rotation[2]).toBeCloseTo(ROTATION_RATE / 4, 4);
  });

  it("leaves a particle where it was born while rotation is off", () => {
    const held = run([emitterOf({ rate: flat(4), rotation0: flat(0, 0, 1) })]);

    held.step(4);

    expect(held.pool.rotation[2]).toBe(0);
  });

  it("carries a swapped particle's rotation with it", () => {
    const held = run([emitterOf({ rate: flat(40), birthRotation0: flat(0, 0, 2) })], 0.25, 8);

    held.step(3);

    for (let at = 0; at < held.pool.count; at += 1) {
      expect(held.pool.rotation[at * 3 + 2]).toBeCloseTo(2, 6);
    }
  });
});

describe("birth draws", () => {
  it("multiplies a probability table's draw into its channel at birth", () => {
    const sim = run([
      emitterOf({
        rate: flat(40),
        birthScale0: {
          constant: [10, 10, 10],
          keys: [],
          tables: [
            {
              channel: 1,
              single: 1,
              keys: [
                { time: 0, values: [2] },
                { time: 1, values: [4] },
              ],
            },
          ],
        },
      }),
    ]);
    sim.step();

    expect(sim.pool.count).toBeGreaterThan(2);
    const drawn = new Set<number>();
    for (let at = 0; at < sim.pool.count; at += 1) {
      expect(sim.pool.birthScale[at * 3]).toBe(10);
      expect(sim.pool.birthScale[at * 3 + 1]).toBeGreaterThanOrEqual(20);
      expect(sim.pool.birthScale[at * 3 + 1]).toBeLessThanOrEqual(40);
      drawn.add(sim.pool.birthScale[at * 3 + 1]);
    }
    expect(drawn.size).toBeGreaterThan(1);
  });

  it("draws one chance for the emitter's whole life under ParticlesShareRandomValue", () => {
    const table = {
      constant: [10, 10, 10],
      keys: [],
      tables: [
        {
          channel: 1,
          single: 1,
          keys: [
            { time: 0, values: [2] },
            { time: 1, values: [4] },
          ],
        },
      ],
    };
    const sim = run([emitterOf({ rate: flat(40), birthScale0: table, sharedRandom: true })]);
    sim.step(2);

    expect(sim.pool.count).toBeGreaterThan(2);
    const drawn = new Set<number>();
    for (let at = 0; at < sim.pool.count; at += 1) drawn.add(sim.pool.birthScale[at * 3 + 1]);
    expect(drawn.size).toBe(1);
  });

  it("turns a particle by its birth angular velocity and acceleration, rotation off or on", () => {
    const sim = run([
      emitterOf({
        birthRotationalVelocity0: flat(0, 0, 8),
        birthRotationalAcceleration: flat(0, 0, 16),
      }),
    ]);
    sim.step(3);

    /* Born at 0.25 and stepped at 0.5 and 0.75: 8 a second for half a second, plus the
       acceleration's share, which grows with the age it is read at. */
    expect(sim.pool.rotation[2]).toBeCloseTo(8 * 0.5 + 16 * (0.25 + 0.5) * 0.25, 5);
  });
});

describe("a simple emitter's legacy block", () => {
  const simple = (over: Partial<LegacySimpleModel> = {}): LegacySimpleModel => ({
    birthScale: flat(100),
    scaleBias: [1, 1],
    scale: flat(1),
    birthRotation: flat(0),
    birthRotationalVelocity: flat(0),
    rotation: flat(0),
    lockedToEmitter: false,
    hasFixedOrbit: false,
    fixedOrbitType: 1,
    orientation: 0,
    particleBind: [0, 0],
    uvScrollRate: [0, 0],
    scaleUpFromOrigin: false,
    ...over,
  });

  it("stands the one birth size on every axis, scaleBias across and up, off one draw", () => {
    const sim = run([
      emitterOf({
        rate: flat(40),
        birthScale0: flat(1, 1, 1),
        legacySimple: simple({
          scaleBias: [2, 0.5],
          birthScale: {
            constant: [100],
            keys: [],
            tables: [
              {
                channel: 0,
                single: 1,
                keys: [
                  { time: 0, values: [1] },
                  { time: 1, values: [2] },
                ],
              },
            ],
          },
        }),
      }),
    ]);
    sim.step();

    expect(sim.pool.count).toBeGreaterThan(2);
    for (let at = 0; at < sim.pool.count; at += 1) {
      const [x, y, z] = vec3(sim.pool.birthScale, at);
      expect(z).toBeGreaterThanOrEqual(100);
      expect(z).toBeLessThanOrEqual(200);
      expect(x).toBeCloseTo(z * 2, 4);
      expect(y).toBeCloseTo(z * 0.5, 4);
    }
  });

  it("reads the legacy scale over the age in scale0's place, on every axis", () => {
    const sim = run([
      emitterOf({
        particleLifetime: flat(1),
        scale0: flat(7, 7, 7),
        legacySimple: simple({ scale: keyed([0, 1], [1, 5]) }),
      }),
    ]);
    sim.step(3);

    const drawn = { scale: new Float32Array(3), color: new Float32Array(4) };
    appearance(sim.pool, 0, sim.emitters[0], 0.75, drawn);

    expect(Array.from(drawn.scale).map((v) => Math.round(v * 100) / 100)).toEqual([300, 300, 300]);
  });

  it("rolls a simple particle about the view axis at birth and over its age", () => {
    const sim = run([
      emitterOf({
        particleLifetime: flat(1),
        legacySimple: simple({
          birthRotation: flat(30),
          birthRotationalVelocity: flat(40),
          rotation: keyed([0, 0], [1, 100]),
        }),
      }),
    ]);
    sim.step(3);

    /* Born at 0.25, so two quarter-second steps of 40 a second have turned it 20. */
    expect(vec3(sim.pool.rotation, 0)).toEqual([0, 0, 50]);
    expect(legacyRoll(sim.pool, 0, sim.emitters[0], 0.75)).toBeCloseTo(50, 5);
    expect(legacyRoll(sim.pool, 0, emitterOf(), 0.75)).toBe(0);
  });

  it("spins a simple particle in whole degrees, wrapped into one turn", () => {
    const sim = run([
      emitterOf({
        particleLifetime: flat(1),
        legacySimple: simple({ birthRotation: flat(-30.7), rotation: flat(400.5) }),
      }),
    ]);
    sim.step();

    expect(spinOf(sim.pool, 0, sim.emitters[0], 0.25)).toBe(9);

    const complex = run([emitterOf({ birthRotation0: flat(30.7, 0, 0) })]);
    complex.step();
    expect(spinOf(complex.pool, 0, complex.emitters[0], 0.25)).toBeCloseTo(30.7, 5);
  });

  it("keeps all three of a mesh's rotation channels, and rounds none of them", () => {
    const mesh = run([
      emitterOf({ quadType: QUAD_TYPE.mesh, birthRotation0: flat(-30.7, 45, 90) }),
    ]);
    mesh.step();

    expect(mesh.pool.rotation[0]).toBeCloseTo(-30.7, 5);
    expect(mesh.pool.rotation[1]).toBe(45);
    expect(mesh.pool.rotation[2]).toBe(90);
  });
});

describe("the UV layers", () => {
  function layer(over: Partial<UvLayer> = {}): UvLayer {
    return { ...plainUvLayer(), ...over };
  }

  it("holds the birth ramp's own numbers apart from the integrated scroll", () => {
    const sim = run([
      emitterOf({
        uv: layer({
          birthOffset: flat(0.25, -0.5),
          birthScrollRate: flat(2, 0),
          birthRotateRate: flat(9),
        }),
      }),
    ]);
    sim.step(3);

    const slot = uvAt(0, 0);
    expect(sim.pool.uv[slot + UV.birthOffsetX]).toBeCloseTo(0.25, 6);
    expect(sim.pool.uv[slot + UV.birthOffsetY]).toBeCloseTo(-0.5, 6);
    expect(sim.pool.uv[slot + UV.birthScrollX]).toBe(2);
    expect(sim.pool.uv[slot + UV.birthRotate]).toBe(9);
    /* A ramp is read off the age at draw time, so nothing of it accumulates here. */
    expect(sim.pool.uv[slot + UV.scrollX]).toBe(0);
    expect(sim.pool.uv[slot + UV.rotate]).toBe(0);
  });

  it("accumulates an integrated scroll rate in cells a second, with no per-frame scale", () => {
    const sim = run([emitterOf({ uv: layer({ scrollRate: flat(1, 0), rotateRate: flat(3) }) })], 1);
    sim.step(2);

    /* Born on the first step, so one more step of a second has run. */
    expect(sim.pool.uv[uvAt(0, 0) + UV.scrollX]).toBeCloseTo(1, 6);
    expect(sim.pool.uv[uvAt(0, 0) + UV.rotate]).toBeCloseTo(3, 6);
  });

  it("opens a book at no phase, at the rate it plays at", () => {
    const sim = run([
      emitterOf({
        uv: layer({ book: { ...plainUvLayer().book, start: 5, rate: 12, birthRate: flat(2) } }),
      }),
    ]);
    sim.step();

    const slot = uvAt(0, 0);
    expect(sim.pool.uv[slot + UV.phase]).toBe(0);
    expect(sim.pool.uv[slot + UV.frameRate]).toBe(24);
  });

  it("draws a random start phase off the particle's own roll, fractions included", () => {
    const book = { ...plainUvLayer().book, frames: 8, randomStart: true };
    const sim = run([emitterOf({ rate: flat(40), uv: layer({ book }) })], 0.25, 32);
    sim.step(2);

    const phases = new Set<number>();
    for (let at = 0; at < sim.pool.count; at += 1) {
      phases.add(sim.pool.uv[uvAt(at, 0) + UV.phase]);
    }

    expect(sim.pool.count).toBeGreaterThan(4);
    expect(phases.size).toBeGreaterThan(1);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(8);
    }
    expect([...phases].some((phase) => phase !== Math.floor(phase))).toBe(true);
  });

  it("opens both layers on the same phase, because one counter serves both", () => {
    const book = { ...plainUvLayer().book, frames: 8, randomStart: true };
    const sim = run([emitterOf({ rate: flat(40), uv: layer({ book }), multUv: layer({ book }) })]);
    sim.step(2);

    expect(sim.pool.count).toBeGreaterThan(1);
    for (let at = 0; at < sim.pool.count; at += 1) {
      expect(sim.pool.uv[uvAt(at, 1) + UV.phase]).toBe(sim.pool.uv[uvAt(at, 0) + UV.phase]);
    }
  });

  it("keeps the second layer's ramp apart from the first's", () => {
    const sim = run([
      emitterOf({
        uv: layer({ birthOffset: flat(1, 0) }),
        multUv: layer({ birthOffset: flat(0, 2) }),
      }),
    ]);
    sim.step();

    expect(sim.pool.uv[uvAt(0, 0) + UV.birthOffsetX]).toBeCloseTo(1, 6);
    expect(sim.pool.uv[uvAt(0, 1) + UV.birthOffsetY]).toBeCloseTo(2, 6);
  });

  it("touches no second layer for an emitter carrying none", () => {
    const sim = run([emitterOf({ uv: layer({ birthOffset: flat(1, 1) }) })]);
    sim.step(3);

    expect(sim.pool.uv[uvAt(0, 1) + UV.birthOffsetX]).toBe(0);
  });

  it("carries a swapped particle's UV state with it", () => {
    const book = { ...plainUvLayer().book, frames: 8, randomStart: true };
    const sim = run([emitterOf({ rate: flat(40), uv: layer({ book }) })], 0.25, 8);
    sim.step(3);

    for (let at = 0; at < sim.pool.count; at += 1) {
      expect(sim.pool.uv[uvAt(at, 0) + UV.phase]).toBeLessThan(8);
    }
  });
});

describe("the direction stretch", () => {
  const moving = {
    birthVelocity: flat(0, 100, 0),
    directionOriented: true,
    directionVelocityScale: 0.05,
  };

  it("stretches a direction-oriented particle by its speed, held at the least stretch", () => {
    const fast = run([emitterOf(moving)], 1);
    fast.step(2);
    expect(stretchOf(fast.pool, 0, fast.emitters[0])).toBeCloseTo(5, 5);

    const held = run([emitterOf({ ...moving, directionVelocityMinScale: 8 })], 1);
    held.step(2);
    expect(stretchOf(held.pool, 0, held.emitters[0])).toBe(8);
  });

  it("leaves a particle facing no travel, and a ray, unstretched", () => {
    const still = run([emitterOf({ ...moving, birthVelocity: flat(0, 0, 0) })], 1);
    still.step(2);
    expect(stretchOf(still.pool, 0, still.emitters[0])).toBe(1);

    const ray = run([emitterOf({ ...moving, quadType: QUAD_TYPE.ray })], 1);
    ray.step(2);
    expect(stretchOf(ray.pool, 0, ray.emitters[0])).toBe(1);
  });
});

describe("particle linger", () => {
  /** One particle, born on the first quarter-second step, that would live a long time. */
  const lasting = { particleLifetime: flat(100), particleLinger: 1 };

  it("holds a max-lifetime linger until the system stops, then caps every particle", () => {
    const sim = run([emitterOf(lasting)], 0.25, 256, 1, STILL, 1);
    sim.step(3);
    expect(sim.pool.lifetime[0]).toBe(100);

    sim.step();
    expect(sim.pool.count).toBe(1);
    expect(sim.pool.lifetime[0]).toBe(1);
    expect(sim.pool.lingerFrom[0]).toBe(1);

    sim.step();
    expect(sim.pool.count).toBe(0);
  });

  it("gives a fixed-after-stops linger its seconds from the emitter's own end of emission", () => {
    const sim = run([
      emitterOf({
        ...lasting,
        lifetime: 0.5,
        lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterStops,
      }),
    ]);
    sim.step(3);

    /* Finished at 0.75, on a particle born at 0.25, so it now lives to 1.75. */
    expect(sim.pool.lifetime[0]).toBeCloseTo(1.5, 6);
    expect(sim.state[0].finishedAt).toBe(0.75);

    sim.step(3);
    expect(sim.pool.count).toBe(1);
    sim.step();
    expect(sim.pool.count).toBe(0);
  });

  it("leaves a fixed-after-dies linger waiting on a stop the emission's end is not", () => {
    const sim = run([
      emitterOf({
        ...lasting,
        lifetime: 0.5,
        lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterDies,
      }),
    ]);
    sim.step(8);

    expect(sim.pool.lifetime[0]).toBe(100);
    expect(sim.state[0].finishedAt).toBeNull();
  });

  it("waits a stop out until the system's age passes emitterLinger", () => {
    const sim = run([emitterOf({ ...lasting, emitterLinger: 2 })], 0.25, 256, 1, STILL, 1);
    sim.step(8);
    expect(sim.state[0].finishedAt).toBeNull();
    expect(sim.pool.lifetime[0]).toBe(100);

    sim.step();
    expect(sim.state[0].finishedAt).toBe(2.25);
    expect(sim.pool.lifetime[0]).toBe(1);
  });

  it("grants a stop issued past emitterLinger no wait, the age being the system's own", () => {
    const sim = run([emitterOf({ ...lasting, emitterLinger: 0.5 })], 0.25, 256, 1, STILL, 1);
    sim.step(4);

    expect(sim.state[0].finishedAt).toBe(1);
  });

  it("holds a stopped fixed-after-stops emitter to emitterLinger rather than its lifetime", () => {
    const sim = run(
      [
        emitterOf({
          ...lasting,
          lifetime: 5,
          emitterLinger: 2,
          lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterStops,
        }),
      ],
      0.25,
      256,
      1,
      STILL,
      1,
    );
    sim.step(8);
    expect(sim.state[0].finishedAt).toBeNull();

    sim.step();
    expect(sim.state[0].finishedAt).toBe(2.25);
  });

  it("stops emitting once the system stops, and drops what has no linger at once", () => {
    const sim = run([emitterOf({ rate: flat(40) })], 0.25, 256, 1, STILL, 0.5);
    sim.step();
    expect(sim.pool.count).toBe(10);

    sim.step();
    expect(sim.pool.count).toBe(0);
  });

  it("swaps in the linger colour and scale against the linger's own progress", () => {
    const sim = run(
      [
        emitterOf({
          ...lasting,
          lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterDies,
          color: flat(1, 0, 0, 1),
          linger: {
            rotation: null,
            scale: keyed([0, 4, 4, 4], [1, 2, 2, 2]),
            color: keyed([0, 1, 1, 1, 1], [1, 0, 0, 0, 0]),
            acceleration: null,
            velocity: null,
            drag: null,
          },
        }),
      ],
      0.25,
      256,
      1,
      STILL,
      0.5,
    );
    sim.step(2);

    const drawn = { scale: new Float32Array(3), color: new Float32Array(4) };
    appearance(sim.pool, 0, sim.emitters[0], 1, drawn);

    /* Stopped at 0.5 with a second of linger, so at 1.0 the linger is half through. */
    expect(drawn.color[0]).toBeCloseTo(0.5, 6);
    expect(drawn.scale[0]).toBeCloseTo(3, 6);
  });

  it("reads the emitter's own velocity as a drift, never into the particle's", () => {
    const sim = run([emitterOf({ velocity: flat(0, 10, 0) })]);
    sim.step(3);

    expect(vec3(sim.pool.position, 0)).toEqual([0, 5, 0]);
    expect(vec3(sim.pool.velocity, 0)).toEqual([0, 0, 0]);
  });
});

describe("the spawn shape", () => {
  it("births a particle on a sphere's surface and sends its velocity outward", () => {
    const sim = run([
      emitterOf({
        rate: flat(40),
        shape: { kind: "sphere", radius: 50, volume: false },
        birthVelocity: flat(100, 0, 0),
      }),
    ]);
    sim.step();

    expect(sim.pool.count).toBeGreaterThan(1);
    for (let at = 0; at < sim.pool.count; at += 1) {
      const position = vec3(sim.pool.position, at);
      const velocity = vec3(sim.pool.velocity, at);
      expect(Math.hypot(...position)).toBeCloseTo(50, 3);
      expect(Math.hypot(...velocity)).toBeCloseTo(100, 3);
      const dot = position[0] * velocity[0] + position[1] * velocity[1] + position[2] * velocity[2];
      expect(dot / (50 * 100)).toBeCloseTo(1, 4);
    }
  });

  it("turns a legacy shape's birth velocity and leaves the particle where it was born", () => {
    const sim = run([
      emitterOf({
        shape: {
          kind: "legacy",
          offset: flat(0, 0, 0),
          translation: flat(0, 0, 0),
          angles: [flat(90)],
          axes: [[0, 0, 1]],
        },
        birthVelocity: flat(100, 0, 0),
      }),
    ]);
    sim.step();

    const velocity = vec3(sim.pool.velocity, 0);
    expect(velocity[0]).toBeCloseTo(0, 4);
    expect(velocity[1]).toBeCloseTo(100, 4);
    expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
  });

  it("stacks a point shape's offset on the emitter's own", () => {
    const sim = run([
      emitterOf({
        emitterPosition: flat(0, 100, 0),
        shape: { kind: "point", offset: [0, 10, 0] },
      }),
    ]);
    sim.step();

    expect(vec3(sim.pool.position, 0)).toEqual([0, 110, 0]);
  });
});

describe("worldAcceleration", () => {
  /** A pool holding one particle at `place`, born at zero and living `lifetime` seconds. */
  function placed(place: readonly number[], lifetime: number): Pool {
    const pool = createPool(4);
    const at = spawn(pool, 0, 0, lifetime, 0);
    pool.position.set(place, (at ?? 0) * 3);
    return pool;
  }

  /** The drawn place at a frame, whose `worldAcceleration` is the emitter's at its phase. */
  function drawn(pool: Pool, emitter: EmitterModel, over: Partial<DrawFrame> = {}): number[] {
    const frame = { ...AT_ORIGIN, ...over, worldAcceleration: new Float32Array(3) };
    sampleCurveInto(emitter.worldAcceleration, frame.phase, frame.worldAcceleration, 0);
    const out = drawnPlace();
    drawnPlaceInto(pool, 0, frame, out);
    return Array.from(out.place);
  }

  it("ramps the offset from zero to the acceleration times the lifetime squared", () => {
    const pool = placed([1, 2, 3], 2);
    const emitter = emitterOf({ worldAcceleration: flat(0, -10, 0) });

    expect(drawn(pool, emitter)).toEqual([1, 2, 3]);
    expect(drawn(pool, emitter, { now: 1 })[1]).toBeCloseTo(-18, 6);
    expect(drawn(pool, emitter, { now: 2 })[1]).toBeCloseTo(-38, 6);
  });

  it("leaves the drawn position where the integrator put it for an emitter authoring none", () => {
    expect(drawn(placed([1, 2, 3], 2), emitterOf())).toEqual([1, 2, 3]);
  });

  it("reads the curve against the emitter's own life", () => {
    const emitter = emitterOf({ worldAcceleration: keyed([0, 0, 0, 0], [1, 0, -8, 0]) });
    const pool = placed([0, 0, 0], 1);

    expect(drawn(pool, emitter, { now: 1 })[1]).toBe(0);
    expect(drawn(pool, emitter, { now: 1, phase: 0.5 })[1]).toBeCloseTo(-4, 6);
  });

  it("moves the offset in one frame when the linger rewrites the lifetime", () => {
    const emitter = emitterOf({
      particleLifetime: flat(100),
      particleLinger: 1,
      worldAcceleration: flat(0, -10, 0),
      lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterStops,
      lifetime: 0.5,
    });
    const sim = run([emitter]);

    sim.step(2);
    const before = drawn(sim.pool, emitter, { now: 0.5 })[1];

    sim.step();

    /* Born at 0.25 and finished at 0.75, so the lifetime falls from 100 to 1.5, and the
       age it is read against goes from a 400th of the life to a third of it. */
    expect(before).toBeCloseTo(-250, 5);
    expect(drawn(sim.pool, emitter, { now: 0.75 })[1]).toBeCloseTo(-7.5, 5);
  });

  it("does not move the position the integrator holds", () => {
    const sim = run([emitterOf({ worldAcceleration: flat(0, -10, 0) })], 1);
    sim.step(3);

    expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
  });
});

describe("birthOrbitalVelocity", () => {
  /** One particle a quarter-turn about `+Y` from the origin, a second into its life. */
  function orbiting(): Pool {
    const pool = createPool(4);
    spawn(pool, 0, 0, 10, 0);
    pool.position.set([2, 0, 0], 0);
    pool.orbital.set([0, Math.PI / 2, 0], 0);
    return pool;
  }

  it("turns the particle's place about the system's origin, radians a second", () => {
    const pool = orbiting();
    const out = drawnPlace();

    drawnPlaceInto(pool, 0, { ...AT_ORIGIN, now: 1 }, out);

    expect(out.orbited).toBe(true);
    expect(out.place[0]).toBeCloseTo(0, 5);
    expect(out.place[2]).toBeCloseTo(-2, 5);
  });

  it("orbits about the rig's origin rather than the world's", () => {
    const pool = orbiting();
    pool.position.set([12, 0, 0], 0);
    const out = drawnPlace();

    drawnPlaceInto(pool, 0, { ...AT_ORIGIN, now: 1, origin: [10, 0, 0] }, out);

    expect(out.place[0]).toBeCloseTo(10, 5);
    expect(out.place[2]).toBeCloseTo(-2, 5);
  });

  it("stands a particle still where its emitter authors no orbit", () => {
    const pool = createPool(4);
    spawn(pool, 0, 0, 10, 0);
    pool.position.set([2, 0, 0], 0);
    const out = drawnPlace();

    drawnPlaceInto(pool, 0, { ...AT_ORIGIN, now: 1 }, out);

    expect(out.orbited).toBe(false);
    expect(Array.from(out.place)).toEqual([2, 0, 0]);
  });

  it("draws the rate at birth", () => {
    const sim = run([emitterOf({ birthOrbitalVelocity: flat(0, 2, 0) })], 1);
    sim.step();

    expect(vec3(sim.pool.orbital, 0)).toEqual([0, 2, 0]);
  });
});

describe("particleIsLocalOrientation", () => {
  /** A pool holding one particle born under `frame`. */
  function born(frame: readonly number[]): Pool {
    const pool = createPool(4);
    spawn(pool, 0, 0, 10, 0);
    pool.frame.set(frame, 0);
    return pool;
  }

  const BIRTH = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const NOW = yawInto([1, 0, 0], new Float32Array(FRAME_SLOTS));

  it("stands a particle of its own on the system's orientation as it is now", () => {
    const out = new Float32Array(FRAME_SLOTS);

    standingFrameInto(
      born(BIRTH),
      0,
      emitterOf({ particleLocalOrientation: true }),
      { ...AT_ORIGIN, orientation: NOW },
      out,
    );

    expect(Array.from(out)).toEqual(Array.from(NOW));
  });

  it("keeps every other particle on the frame it was born in", () => {
    const out = new Float32Array(FRAME_SLOTS);

    standingFrameInto(born(BIRTH), 0, emitterOf(), { ...AT_ORIGIN, orientation: NOW }, out);

    expect(Array.from(out)).toEqual(BIRTH);
  });
});

describe("the travel one particle records", () => {
  it("carries the emitter's drift where the stored velocity does not", () => {
    const sim = run([emitterOf({ velocity: flat(0, 0, 6) })], 0.5);
    sim.step(2);

    expect(vec3(sim.pool.velocity, 0)).toEqual([0, 0, 0]);
    expect(vec3(sim.pool.travel, 0)).toEqual([0, 0, 6]);
  });

  it("stands at zero for a particle born this step", () => {
    const sim = run([emitterOf({ birthVelocity: flat(0, 9, 0) })], 0.5);
    sim.step();

    expect(vec3(sim.pool.travel, 0)).toEqual([0, 0, 0]);
  });
});

describe("age01", () => {
  it("stands a particle at the end of its life once its lifetime is cut to zero", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 0, 0);

    expect(age01(pool, 0, 0)).toBe(1);
  });

  it("clamps a particle drawn past its own death", () => {
    const pool = createPool(1);
    spawn(pool, 0, 0, 2, 0);

    expect(age01(pool, 0, 1)).toBe(0.5);
    expect(age01(pool, 0, 5)).toBe(1);
  });
});

describe("erosionDrive", () => {
  const erosion: ErosionModel = {
    map: null,
    addressMode: ADDRESS_MODE.clamp,
    mixer: flat(0, 0, 0, 1),
    drive: keyed([0, 0], [1, 1]),
    lingerDrive: null,
    driveSource: 0,
    featherIn: 0.1,
    featherOut: 0.1,
    sliceWidth: 1.5,
  };

  it("reads the drive against the particle's age, and one for an emitter eroding nothing", () => {
    const sim = run([emitterOf({ particleLifetime: flat(1), erosion })]);
    sim.step(2);

    expect(erosionDrive(sim.pool, 0, sim.emitters[0], 0.5)).toBeCloseTo(0.25, 5);
    expect(erosionDrive(sim.pool, 0, emitterOf(), 0.5)).toBe(1);
  });

  it("switches to the linger drive once the emitter has finished", () => {
    const lingering = emitterOf({
      particleLifetime: flat(1),
      erosion: { ...erosion, lingerDrive: flat(0.75) },
      lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterDies,
      particleLinger: 5,
    });
    const sim = run([lingering], 0.25, 256, 1, STILL, 0.5);
    sim.step(1);
    expect(erosionDrive(sim.pool, 0, lingering, 0.25)).toBeCloseTo(0, 5);

    sim.step(2);
    expect(erosionDrive(sim.pool, 0, lingering, 0.75)).toBe(0.75);
  });
});

describe("a trail's births", () => {
  const trail: TrailModel = {
    mode: TRAIL_MODE.wake,
    smoothing: TRAIL_SMOOTHING.off,
    maxAddedPerFrame: 0,
    tiling: flat(0, 0, 0),
    cutoff: 0,
  };

  it("caps a step's spawns at mMaxAddedPerFrame", () => {
    const sim = run([emitterOf({ rate: flat(40), trail: { ...trail, maxAddedPerFrame: 3 } })]);
    sim.step();

    expect(sim.pool.count).toBe(3);
  });

  it("stamps each particle with how far the spawn point had travelled at its birth", () => {
    const flight: Motion = { kind: "path", from: [0, 0, 0], to: [100, 0, 0], speed: 100 };
    const sim = run([emitterOf({ rate: flat(4), trail })], 0.25, 256, 1, flight);
    sim.step(3);

    expect(sim.pool.count).toBe(3);
    expect(Array.from(sim.pool.odometer.subarray(0, 3))).toEqual([0, 25, 50]);
  });

  it("draws mBirthTilingSize at birth and keeps two of its three", () => {
    const sim = run([emitterOf({ trail: { ...trail, tiling: flat(500, 2, 9) } })]);
    sim.step();

    expect(Array.from(sim.pool.tiling.subarray(0, 2))).toEqual([500, 2]);
  });
});

describe("EmitterPosition", () => {
  const climbing = keyed([0, 0, 0, 0], [1, 0, 100, 0]);

  it("births a particle at the emitter's offset from the origin, in either space", () => {
    const sim = run([
      emitterOf({ emitterPosition: flat(5, 0, 0) }),
      emitterOf({ index: 1, emitterPosition: flat(0, 7, 0), emitterSpace: true }),
    ]);
    sim.step();

    expect(vec3(sim.pool.position, 0)).toEqual([5, 0, 0]);
    expect(vec3(sim.pool.position, 1)).toEqual([0, 7, 0]);
  });

  it("leaves a system-space particle where the offset stood at its birth", () => {
    const sim = run([emitterOf({ lifetime: 1, emitterPosition: climbing })], 0.25);
    sim.step(3);

    expect(vec3(sim.pool.position, 0)).toEqual([0, 25, 0]);
  });

  it("carries an emitter-space particle with the offset as it moves", () => {
    const sim = run(
      [emitterOf({ lifetime: 1, emitterPosition: climbing, emitterSpace: true })],
      0.25,
    );
    sim.step(3);

    expect(vec3(sim.pool.position, 0)).toEqual([0, 75, 0]);
  });

  it("moves an emitter-space particle by nothing under a constant offset", () => {
    const sim = run([emitterOf({ emitterPosition: flat(3, 3, 3), emitterSpace: true })]);
    sim.step(4);

    expect(vec3(sim.pool.position, 0)).toEqual([3, 3, 3]);
  });
});

describe("the rig's origin", () => {
  /* A hundred units a second along X, so a quarter-second step travels twenty-five. */
  const FLIGHT: Motion = { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 };

  /** Where each live particle stands on the axis the flight travels, in order. */
  function alongFlight(pool: Pool): number[] {
    const held: number[] = [];
    for (let at = 0; at < pool.count; at += 1) held.push(pool.position[at * 3]);
    return held.sort((first, second) => first - second);
  }

  it("births a particle where the origin stands rather than at the world origin", () => {
    const sim = run([emitterOf({ rate: flat(4) })], 0.25, 256, 1, FLIGHT);
    sim.step();

    expect(sim.pool.count).toBe(1);
    expect(vec3(sim.pool.position, 0)).toEqual([25, 0, 0]);
  });

  it("leaves a world-anchored particle behind, which is what lays a trail", () => {
    const sim = run([emitterOf({ rate: flat(4), bindWeight: flat(0) })], 0.25, 256, 1, FLIGHT);
    sim.step(3);

    expect(alongFlight(sim.pool)).toEqual([25, 50, 75]);
  });

  it("carries a fully bound particle with the origin", () => {
    const sim = run([emitterOf({ rate: flat(4), bindWeight: flat(1) })], 0.25, 256, 1, FLIGHT);
    sim.step(3);

    for (const at of alongFlight(sim.pool)) expect(at).toBeCloseTo(75, 4);
  });

  it("carries half the travel at half the weight", () => {
    const sim = run([emitterOf({ rate: flat(4), bindWeight: flat(0.5) })], 0.25, 256, 1, FLIGHT);
    sim.step(3);

    expect(alongFlight(sim.pool)).toEqual([50, 62.5, 75]);
  });

  it("moves nothing under a still rig, whatever the weight says", () => {
    const sim = run([emitterOf({ rate: flat(4), bindWeight: flat(1) })], 0.25);
    sim.step(3);

    for (let at = 0; at < sim.pool.count; at += 1) {
      expect(vec3(sim.pool.position, at)).toEqual([0, 0, 0]);
    }
  });
});

describe("force fields", () => {
  const NONE: FieldsModel = { acceleration: [], attraction: [], noise: [], drag: [], orbital: [] };

  /** One particle, born still at the origin on the first step. */
  function lone(fields: FieldsModel): EmitterModel {
    return emitterOf({ rate: flat(1), singleParticle: true, fields });
  }

  it("keeps a field's pull in the particle's velocity, so an attraction speeds it up", () => {
    const sim = run([
      lone({
        ...NONE,
        attraction: [{ position: flat(100, 0, 0), acceleration: flat(10), radius: flat(1000) }],
      }),
    ]);
    sim.step(3);

    expect(sim.pool.velocity[0]).toBeCloseTo(5, 5);
    expect(sim.pool.position[0]).toBeCloseTo(1.875, 5);
  });

  it("stands a field's position on the system, whatever turns the emitter", () => {
    const sim = run([
      emitterOf({
        rate: flat(1),
        singleParticle: true,
        rotationOverride: [0, 90, 0],
        fields: {
          ...NONE,
          attraction: [{ position: flat(100, 0, 0), acceleration: flat(10), radius: flat(1000) }],
        },
      }),
    ]);
    sim.step(2);

    expect(sim.pool.velocity[0]).toBeCloseTo(2.5, 4);
    expect(Math.abs(sim.pool.velocity[2])).toBeLessThan(1e-4);
  });

  it("carries every field by the emitter's offset under IsEmitterSpace, and by nothing else", () => {
    const pulled = (emitterSpace: boolean) =>
      emitterOf({
        rate: flat(1),
        singleParticle: true,
        emitterPosition: flat(0, 0, 50),
        emitterSpace,
        fields: {
          ...NONE,
          attraction: [{ position: flat(0, 0, 0), acceleration: flat(10), radius: flat(1000) }],
        },
      });
    const riding = run([pulled(true)]);
    const standing = run([pulled(false)]);
    riding.step(2);
    standing.step(2);

    expect(Math.hypot(...vec3(riding.pool.velocity, 0))).toBeLessThan(1e-4);
    expect(standing.pool.velocity[2]).toBeCloseTo(-2.5, 4);
  });

  const NOISE = {
    position: flat(0, 0, 0),
    axisFraction: [1, 1, 1] as [number, number, number],
    frequency: flat(10),
    radius: flat(1000),
    velocityDelta: flat(20),
  };

  it("kicks a particle along the same path on every replay of the run", () => {
    const fields: FieldsModel = { ...NONE, noise: [NOISE] };
    const first = run([lone(fields)]);
    const again = run([lone(fields)]);
    first.step(8);
    again.step(8);

    expect(vec3(first.pool.position, 0)).toEqual(vec3(again.pool.position, 0));
    expect(Math.hypot(...vec3(first.pool.position, 0))).toBeGreaterThan(0);
  });

  it("kicks a newborn on its birth step, which moves it nowhere", () => {
    const sim = run([lone({ ...NONE, noise: [NOISE] })]);
    sim.step();

    expect(Math.hypot(...vec3(sim.pool.velocity, 0))).toBeCloseTo(20, 4);
    expect(vec3(sim.pool.position, 0)).toEqual([0, 0, 0]);
  });

  it("fires a noise field of no frequency once, on the particles born with its first update", () => {
    const sim = run([
      emitterOf({ rate: flat(4), fields: { ...NONE, noise: [{ ...NOISE, frequency: flat(0) }] } }),
    ]);
    sim.step(3);

    expect(sim.pool.count).toBe(3);
    expect(Math.hypot(...vec3(sim.pool.velocity, 0))).toBeCloseTo(20, 4);
    expect(Math.hypot(...vec3(sim.pool.velocity, 1))).toBe(0);
    expect(Math.hypot(...vec3(sim.pool.velocity, 2))).toBe(0);
  });
});
