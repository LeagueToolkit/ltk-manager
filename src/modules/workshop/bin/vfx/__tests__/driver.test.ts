import { describe, expect, it } from "vitest";

import { multiplyInto } from "../basis";
import { createDriver, type Driver } from "../driver";
import {
  BLEND_MODE,
  COLOR_LOOKUP,
  DRAG_MOTION,
  LINGER_TYPE,
  QUAD_TYPE,
  STENCIL_MODE,
  UV_MODE,
} from "../enums";
import {
  type ChildSetModel,
  type EmitterModel,
  plainUvLayer,
  POINT_SHAPE,
  type SystemModel,
} from "../model";
import type { Pool } from "../pool";
import { type Joints, STAND_HEIGHT } from "../rig";

function constant(...values: number[]) {
  return { constant: values, keys: [], tables: [] };
}

function emitter(over: Partial<EmitterModel> = {}): EmitterModel {
  return {
    index: 0,
    simple: false,
    listIndex: 0,
    name: "smoke",
    disabled: false,
    rate: constant(20),
    particleLifetime: constant(1),
    lifetime: null,
    timeBeforeFirstEmission: 0,
    singleParticle: false,
    sharedRandom: false,
    birthVelocity: constant(0, 100, 0),
    acceleration: constant(0, -50, 0),
    drag: constant(0, 0, 0),
    birthDrag: constant(0, 0, 0),
    velocity: constant(0, 0, 0),
    worldAcceleration: constant(0, 0, 0),
    birthOrbitalVelocity: constant(0, 0, 0),
    bindWeight: constant(0),
    emitterPosition: constant(0, 0, 0),
    emitterSpace: false,
    shape: POINT_SHAPE,
    rotationOverride: [0, 0, 0],
    scaleOverride: [1, 1, 1],
    translationOverride: [0, 0, 0],
    localOrientation: true,
    particleLocalOrientation: false,
    uniformScale: false,
    particleLinger: 0,
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
    rotation0: constant(0, 0, 0),
    birthRotation0: constant(0, 0, 0),
    birthRotationalVelocity0: constant(0, 0, 0),
    birthRotationalAcceleration: constant(0, 0, 0),
    legacySimple: null,
    pivotUp: false,
    rotationEnabled: false,
    directionOriented: false,
    scale0: constant(1, 1, 1),
    birthScale0: constant(10, 10, 10),
    color: constant(1, 1, 1, 1),
    birthColor: constant(1, 1, 1, 1),
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

function system(...emitters: EmitterModel[]): SystemModel {
  return { entry: "0x1", name: null, emitters, transform: null, dragMotion: DRAG_MOTION.stepped };
}

/** A pool as a value two runs are compared by, which is the live range and nothing past it. */
function snapshot(pool: Pool) {
  return {
    count: pool.count,
    position: [...pool.position.subarray(0, pool.count * 3)],
    velocity: [...pool.velocity.subarray(0, pool.count * 3)],
    birthTime: [...pool.birthTime.subarray(0, pool.count)],
  };
}

/** Every column of a pool over its live range, which is the whole of what a run produced. */
function rows(pool: Pool) {
  const columns: Record<string, number[]> = {};
  for (const [name, held] of Object.entries(pool)) {
    if (typeof held === "number") continue;
    const column = held as Int32Array | Uint32Array | Float32Array;
    columns[name] = [...column.subarray(0, pool.count * (column.length / pool.capacity))];
  }
  return { count: pool.count, born: pool.born, columns };
}

/** A run as a value: its pool, its clock, the children under `paths` and the births log. */
function stood(driver: Driver, ...paths: string[]) {
  return {
    pool: rows(driver.pool),
    time: driver.time,
    elapsed: driver.elapsed,
    births: driver.births().map((birth) => ({ ...birth })),
    children: paths.map((path) => driver.sources(path).map((child) => rows(child.pool))),
  };
}

function driverFor(model: SystemModel, seed: number) {
  const driver = createDriver(seed);
  driver.swap(model);
  return driver;
}

function run(model: SystemModel, seed: number, frames: number) {
  const driver = driverFor(model, seed);
  for (let at = 0; at < frames; at += 1) driver.advance(1 / 60);
  return driver;
}

describe("createDriver", () => {
  it("puts two runs of one seed in the same place", () => {
    const model = system(emitter());

    expect(snapshot(run(model, 7, 90).pool)).toEqual(snapshot(run(model, 7, 90).pool));
  });

  it("puts two seeds in the same place while nothing draws from the stream", () => {
    /* T0 draws once per particle and reads no probability table, so a system whose
       values are all constants is the same run under any seed. The draw order is what
       the later tiers hang their own rolls on. */
    const model = system(emitter());

    expect(snapshot(run(model, 1, 60).pool)).toEqual(snapshot(run(model, 2, 60).pool));
  });

  it("reaches a time by advancing from zero, whatever the frames were", () => {
    const driver = driverFor(system(emitter()), 3);

    driver.seek(1);

    expect(driver.time).toBeCloseTo(1, 5);
    expect(driver.pool.count).toBeGreaterThan(0);
  });

  it("puts a seek and the frames it replays in the same place", () => {
    const model = system(emitter());
    const seeked = driverFor(model, 3);
    seeked.seek(0.5);

    expect(snapshot(seeked.pool)).toEqual(snapshot(run(model, 3, 30).pool));
  });

  it("puts a seek and the frames it replays in the same place through a noise field", () => {
    const model = system(
      emitter({
        fields: {
          acceleration: [],
          attraction: [],
          drag: [],
          orbital: [],
          noise: [
            {
              position: constant(0, 0, 0),
              axisFraction: [1, 1, 1],
              frequency: constant(10),
              radius: constant(10000),
              velocityDelta: constant(20),
            },
          ],
        },
      }),
    );
    const seeked = driverFor(model, 3);
    seeked.seek(0.5);

    expect(snapshot(seeked.pool)).toEqual(snapshot(run(model, 3, 30).pool));
  });

  it("empties the pool on a restart", () => {
    const driver = run(system(emitter()), 3, 60);
    expect(driver.pool.count).toBeGreaterThan(0);

    driver.restart();

    expect(driver.pool.count).toBe(0);
    expect(driver.time).toBe(0);
  });

  it("keeps the live particles when an edit swaps the definition", () => {
    const driver = run(system(emitter()), 3, 60);
    const before = snapshot(driver.pool);
    expect(before.count).toBeGreaterThan(0);

    driver.swap(system(emitter({ birthColor: constant(1, 0, 0, 1) })));

    expect(snapshot(driver.pool)).toEqual(before);
    expect(driver.time).toBeGreaterThan(0);
  });

  it("carries an edit to the spawn frame and the first emission into the next batch", () => {
    const turned = { rotationOverride: [0, 90, 0] as [number, number, number] };
    const driver = run(system(emitter({ birthVelocity: constant(100, 0, 0), ...turned })), 3, 30);

    expect(driver.pool.count).toBeGreaterThan(0);
    expect(driver.pool.velocity[2]).toBeCloseTo(-100, 3);

    driver.swap(system(emitter({ birthVelocity: constant(100, 0, 0) })));
    const born = driver.pool.count;
    driver.advance(1 / 60);

    expect(driver.pool.count).toBeGreaterThan(born);
    expect(driver.pool.velocity[born * 3]).toBeCloseTo(100, 3);
    expect(driver.pool.velocity[born * 3 + 2]).toBeCloseTo(0, 3);
  });

  it("starts over when an edit adds or removes an emitter", () => {
    const driver = run(system(emitter()), 3, 60);
    expect(driver.pool.count).toBeGreaterThan(0);

    driver.swap(system(emitter(), emitter({ index: 1, listIndex: 1, name: "spark" })));

    expect(driver.pool.count).toBe(0);
  });

  it("starts over when an edit replaces one emitter of the same count", () => {
    const spark = emitter({ index: 1, listIndex: 1, name: "spark" });
    const driver = run(system(emitter(), spark), 3, 60);
    expect(driver.pool.count).toBeGreaterThan(0);

    driver.swap(system(emitter(), emitter({ index: 1, listIndex: 1, name: "ember" })));

    expect(driver.pool.count).toBe(0);
  });

  it("starts over when an emitter moves between the two lists", () => {
    const driver = run(system(emitter()), 3, 60);
    expect(driver.pool.count).toBeGreaterThan(0);

    driver.swap(system(emitter({ simple: true })));

    expect(driver.pool.count).toBe(0);
  });

  it("holds the phase when an edit shortens a looping run", () => {
    /* A still rig's run is the system's own span, which an edit to a lifetime moves. */
    const driver = driverFor(system(emitter({ lifetime: 2, particleLifetime: constant(1) })), 3);
    driver.steer({ motion: { kind: "still" }, life: "loop", height: 0 });
    for (let at = 0; at < 150; at += 1) driver.advance(1 / 60);

    const alive = driver.pool.count;
    expect(alive).toBeGreaterThan(1);

    driver.swap(system(emitter({ lifetime: 0.5, particleLifetime: constant(1) })));
    driver.advance(1 / 60);

    /* A replay empties the pool and starts the shortened emitter over, so the newest
       particle would postdate the edit rather than predate it. */
    const newest = Math.max(...driver.pool.birthTime.subarray(0, driver.pool.count));

    expect(driver.pool.count).toBeGreaterThan(1);
    expect(newest).toBeLessThan(2.5);
  });

  it("holds room for the particles a system of several emitters spawns", () => {
    expect(createDriver(1).pool.capacity).toBeGreaterThan(1000);
  });
});

describe("child sets", () => {
  /* A linger as long as the lifetime, so a stopped child plays its particles out. */
  const ember: Partial<EmitterModel> = {
    name: "ember",
    rate: constant(30),
    particleLifetime: constant(0.5),
    particleLinger: 0.5,
    birthVelocity: constant(0, 0, 0),
    acceleration: constant(0, 0, 0),
  };
  const embers = system(emitter(ember));

  function childSet(over: Partial<ChildSetModel> = {}): ChildSetModel {
    return {
      children: [embers],
      bones: [],
      probability: constant(0),
      onDeath: false,
      inheritance: null,
      ...over,
    };
  }

  /** One particle at the start, living a second and rising at 100 a second. */
  function parent(over: Partial<EmitterModel> = {}): EmitterModel {
    return emitter({
      rate: constant(1),
      lifetime: 0.1,
      particleLifetime: constant(1),
      birthVelocity: constant(0, 100, 0),
      acceleration: constant(0, 0, 0),
      childSet: childSet(),
      ...over,
    });
  }

  it("spawns a system of its own for a particle born", () => {
    const driver = run(system(parent()), 3, 30);
    const children = driver.sources("0.0");

    expect(children).toHaveLength(1);
    expect(children[0].pool.count).toBeGreaterThan(0);
  });

  it("carries the child with the particle it rides", () => {
    const driver = run(system(parent()), 3, 30);
    const [child] = driver.sources("0.0");

    expect(driver.pool.count).toBe(1);
    expect(child.origin[1]).toBeCloseTo(driver.pool.position[1], 3);
    expect(child.origin[1]).toBeGreaterThan(STAND_HEIGHT + 40);
  });

  it("stops a child where its particle died, and reaps it once it has played out", () => {
    const driver = run(system(parent()), 3, 66);
    const [child] = driver.sources("0.0");
    expect(driver.pool.count).toBe(0);
    const left = child.origin[1];
    const alive = child.pool.count;

    for (let at = 0; at < 12; at += 1) driver.advance(1 / 60);
    expect(child.origin[1]).toBe(left);
    expect(child.pool.count).toBeLessThan(alive);

    for (let at = 0; at < 60; at += 1) driver.advance(1 / 60);
    expect(driver.sources("0.0")).toHaveLength(0);
  });

  it("cuts a stopped child's particles at once where its emitters grant no linger", () => {
    const bare = system(emitter({ ...ember, particleLinger: 0 }));
    const driver = run(system(parent({ childSet: childSet({ children: [bare] }) })), 3, 66);

    expect(driver.pool.count).toBe(0);
    expect(driver.sources("0.0")).toHaveLength(0);
  });

  it("spawns a death child where the particle died, and none while it lives", () => {
    const driver = run(system(parent({ childSet: childSet({ onDeath: true }) })), 3, 30);
    expect(driver.sources("0.0")).toHaveLength(0);

    for (let at = 0; at < 36; at += 1) driver.advance(1 / 60);
    const [child] = driver.sources("0.0");
    expect(child.origin[1]).toBeGreaterThan(STAND_HEIGHT + 90);

    const where = child.origin[1];
    for (let at = 0; at < 12; at += 1) driver.advance(1 / 60);
    expect(child.origin[1]).toBe(where);
    expect(child.pool.count).toBeGreaterThan(0);
  });

  it("turns a child with the particle it rides, and only by its frame under 0x2", () => {
    /* A quarter turn about z sends the particle's own x onto the world's y. */
    const turned = { birthRotation0: constant(0, 0, 90) };
    const plain = run(system(parent(turned)), 3, 30);
    const framed = run(
      system(
        parent({
          ...turned,
          childSet: childSet({ inheritance: { mode: 0x2, offset: constant(0, 0, 0) } }),
        }),
      ),
      3,
      30,
    );

    expect(plain.sources("0.0")[0].orientation[3]).toBeCloseTo(1, 5);
    expect(framed.sources("0.0")[0].orientation[3]).toBeCloseTo(0, 5);
  });

  it("adds RelativeOffset turned by the particle, and on the world's axes under 0x1", () => {
    const turned = { birthRotation0: constant(0, 0, 90) };
    const offset = (mode: number) =>
      run(
        system(
          parent({
            ...turned,
            childSet: childSet({ inheritance: { mode, offset: constant(10, 0, 0) } }),
          }),
        ),
        3,
        30,
      );

    const local = offset(0);
    const world = offset(0x1);

    expect(local.sources("0.0")[0].origin[0]).toBeCloseTo(0, 3);
    expect(local.sources("0.0")[0].origin[1]).toBeCloseTo(local.pool.position[1] + 10, 3);
    expect(world.sources("0.0")[0].origin[0]).toBeCloseTo(10, 3);
    expect(world.sources("0.0")[0].origin[1]).toBeCloseTo(world.pool.position[1], 3);
  });

  it("turns RelativeOffset by the particle even where 0x2 drops its turn from the child", () => {
    const driver = run(
      system(
        parent({
          birthRotation0: constant(0, 0, 90),
          childSet: childSet({ inheritance: { mode: 0x2, offset: constant(10, 0, 0) } }),
        }),
      ),
      3,
      30,
    );
    const [child] = driver.sources("0.0");

    expect(child.origin[0]).toBeCloseTo(0, 3);
    expect(child.origin[1]).toBeCloseTo(driver.pool.position[1] + 10, 3);
  });

  it("carries an edit to the inheritance to a child already live", () => {
    const offsetBy = (x: number) =>
      childSet({ inheritance: { mode: 0x1, offset: constant(x, 0, 0) } });
    const driver = run(system(parent({ childSet: offsetBy(0) })), 3, 30);
    const [child] = driver.sources("0.0");

    driver.swap(system(parent({ childSet: offsetBy(10) })));
    driver.advance(1 / 60);

    expect(driver.sources("0.0")).toEqual([child]);
    expect(child.origin[0]).toBeCloseTo(10, 3);
  });

  it("spawns nothing for a set naming bones while the rig carries no joints", () => {
    const driver = run(system(parent({ childSet: childSet({ bones: ["R_Hand"] }) })), 3, 30);

    expect(driver.sources("0.0")).toHaveLength(0);
  });

  it("empties the children with the pool on a restart", () => {
    const driver = run(system(parent()), 3, 30);
    const children = driver.sources("0.0");
    expect(children).toHaveLength(1);

    driver.restart();

    expect(children).toHaveLength(0);
  });

  it("puts a child in the same place whether its run was played or sought", () => {
    const played = run(system(parent()), 5, 45);
    const sought = driverFor(system(parent()), 5);
    sought.seek(0.75);

    const [left] = played.sources("0.0");
    const [right] = sought.sources("0.0");
    expect(snapshot(right.pool)).toEqual(snapshot(left.pool));
  });

  it("keeps a child across an edit that keeps its shape, and drops it across one that does not", () => {
    const driver = run(system(parent()), 3, 30);
    const [child] = driver.sources("0.0");

    driver.swap(system(parent({ birthColor: constant(1, 0, 0, 1) })));
    expect(driver.sources("0.0")).toEqual([child]);

    driver.swap(system(parent({ childSet: childSet({ children: [system()] }) })));
    expect(driver.sources("0.0")).toHaveLength(0);
  });

  it("nests a child's own children, and stops nesting past the cap", () => {
    let nested = embers;
    for (let depth = 0; depth < 6; depth += 1)
      nested = system(parent({ childSet: childSet({ children: [nested] }) }));
    const driver = run(nested, 3, 30);

    expect(driver.sources("0.0/0.0")).toHaveLength(1);
    expect(driver.sources(["0.0", "0.0", "0.0", "0.0", "0.0"].join("/"))).toHaveLength(0);
  });

  describe("on bones", () => {
    /** A joint standing still at `(x, y, z)`, turned by the identity. */
    function anchorAt(x: number, y: number, z: number) {
      return {
        originAt: () => [x, y, z] as const,
        basisInto: (_time: number, out: Float32Array) => {
          out.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
          return out;
        },
      };
    }

    /** `model` run with `joints` bound before any particle spawns, so bone children reach it. */
    function boneRun(model: SystemModel, seed: number, frames: number, joints: Joints) {
      const driver = driverFor(model, seed);
      driver.steer({ motion: { kind: "still" }, life: "once", height: STAND_HEIGHT, joints });
      for (let at = 0; at < frames; at += 1) driver.advance(1 / 60);
      return driver;
    }

    it("spawns one child per bone, each under its own path", () => {
      const driver = boneRun(
        system(
          parent({
            childSet: childSet({ bones: ["R_Hand", "L_Hand"], children: [embers, embers] }),
          }),
        ),
        3,
        30,
        () => anchorAt(0, 0, 0),
      );

      expect(driver.sources("0.0")).toHaveLength(1);
      expect(driver.sources("0.1")).toHaveLength(1);
    });

    it("places a bone child at its joint, re-rooted at the particle's place and turn", () => {
      const turned = { birthRotation0: constant(0, 0, 90) };
      const driver = boneRun(
        system(
          parent({ ...turned, childSet: childSet({ bones: ["R_Hand"], children: [embers] }) }),
        ),
        3,
        30,
        () => anchorAt(10, 0, 0),
      );

      const [child] = driver.sources("0.0");
      expect(child.origin[0]).toBeCloseTo(0, 3);
      expect(child.origin[1]).toBeCloseTo(driver.pool.position[1] + 10, 3);
    });

    it("turns a bone child by the particle's own turn times the joint's basis", () => {
      const turned = { birthRotation0: constant(0, 0, 90) };
      const rotated = new Float32Array([1, 0, 0, 0, 0, -1, 0, 1, 0]);
      const rotatedAnchor = {
        originAt: () => [0, 0, 0] as const,
        basisInto: (_time: number, out: Float32Array) => {
          out.set(rotated);
          return out;
        },
      };
      const model = system(
        parent({ ...turned, childSet: childSet({ bones: ["R_Hand"], children: [embers] }) }),
      );

      const plain = boneRun(model, 3, 30, () => anchorAt(0, 0, 0));
      const particleTurn = plain.sources("0.0")[0].orientation;
      const expected = new Float32Array(9);
      multiplyInto(particleTurn, rotated, expected);

      const turnedDriver = boneRun(model, 3, 30, () => rotatedAnchor);
      expect([...turnedDriver.sources("0.0")[0].orientation]).toEqual([...expected]);
    });

    it("spawns none where a bone set names fewer bones than children", () => {
      const driver = boneRun(
        system(parent({ childSet: childSet({ bones: ["R_Hand"], children: [embers, embers] }) })),
        3,
        30,
        () => anchorAt(0, 0, 0),
      );

      expect(driver.sources("0.0")).toHaveLength(0);
      expect(driver.sources("0.1")).toHaveLength(0);
    });

    it("skips only the child whose bone the lookup lacks", () => {
      const driver = boneRun(
        system(
          parent({
            childSet: childSet({ bones: ["R_Hand", "L_Hand"], children: [embers, embers] }),
          }),
        ),
        3,
        30,
        (name: string) => (name === "R_Hand" ? anchorAt(10, 0, 0) : null),
      );

      expect(driver.sources("0.0")).toHaveLength(1);
      expect(driver.sources("0.1")).toHaveLength(0);
    });

    it("follows a carried bone child's joint as time moves", () => {
      const walking = {
        originAt: (time: number) => [time * 100, 0, 0] as const,
        basisInto: (_time: number, out: Float32Array) => {
          out.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
          return out;
        },
      };
      const driver = boneRun(
        system(parent({ childSet: childSet({ bones: ["R_Hand"], children: [embers] }) })),
        3,
        30,
        () => walking,
      );
      const [child] = driver.sources("0.0");
      const before = child.origin[0];

      for (let at = 0; at < 6; at += 1) driver.advance(1 / 60);

      expect(child.origin[0]).toBeGreaterThan(before);
    });
  });
});

describe("the rig", () => {
  /* An emitter that ends, so a run has a length the system's own span can be read off. */
  const brief = emitter({ lifetime: 0.5, particleLifetime: constant(0.25) });

  /** How far along X the live particles reach, which is where the origin has been. */
  function reach(pool: Pool): number {
    let most = 0;
    for (let at = 0; at < pool.count; at += 1) most = Math.max(most, pool.position[at * 3]);
    return most;
  }

  it("leaves the origin at zero until a rig moves it", () => {
    const driver = run(system(emitter()), 3, 60);

    expect(reach(driver.pool)).toBe(0);
  });

  it("births along the path once a flying rig is bound", () => {
    const driver = driverFor(system(emitter()), 3);
    driver.steer({
      motion: { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 },
      life: "once",
      height: 0,
    });

    for (let at = 0; at < 60; at += 1) driver.advance(1 / 60);

    expect(reach(driver.pool)).toBeGreaterThan(50);
  });

  it("holds the phase when a parameter is tuned, so a drag does not pin the run", () => {
    const flight = { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 } as const;
    const driver = driverFor(system(emitter()), 3);
    driver.steer({ motion: flight, life: "once", height: 0 });
    for (let at = 0; at < 60; at += 1) driver.advance(1 / 60);

    const flown = reach(driver.pool);
    driver.steer({ motion: { ...flight, speed: 200 }, life: "once", height: 0 });
    for (let at = 0; at < 6; at += 1) driver.advance(1 / 60);

    /* Pinning the run would put the next births back at the launch point, leaving the
       reach where the first second of flight had already carried it. */
    expect(reach(driver.pool)).toBeGreaterThan(flown);
  });

  it("holds the phase across a tune that shortens a looping run", () => {
    /* A `once` rig's phase is the clock, so only a looping one can wrap. */
    const flight = { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 } as const;
    const driver = driverFor(system(emitter()), 3);
    driver.steer({ motion: flight, life: "loop", height: 0 });
    for (let at = 0; at < 360; at += 1) driver.advance(1 / 60);

    const alive = driver.pool.count;
    expect(alive).toBeGreaterThan(1);

    driver.steer({ motion: { ...flight, speed: 200 }, life: "loop", height: 0 });
    driver.advance(1 / 60);

    expect(driver.pool.count).toBeGreaterThanOrEqual(alive);
  });

  it("stops the system where the rig says, so nothing is born past it", () => {
    const driver = driverFor(system(emitter()), 3);
    driver.steer({ motion: { kind: "still" }, life: "once", height: 0, stopAt: 0.5 });

    for (let at = 0; at < 30; at += 1) driver.advance(1 / 60);
    const before = driver.pool.count;
    expect(before).toBeGreaterThan(0);

    for (let at = 0; at < 30; at += 1) driver.advance(1 / 60);
    expect(driver.pool.count).toBe(0);
  });

  it("stops a path rig where it lands, lets the linger play out, then flies again", () => {
    const driver = driverFor(system(emitter({ rate: constant(60), particleLinger: 0.5 })), 3);
    driver.steer({
      motion: { kind: "path", from: [0, 0, 0], to: [100, 0, 0], speed: 100 },
      life: "loop",
      height: 0,
    });

    for (let at = 0; at < 30; at += 1) driver.advance(1 / 60);
    expect(driver.pool.count).toBeGreaterThan(0);
    expect(driver.elapsed).toBeCloseTo(0.5, 3);

    /* Landed at one second, so the linger caps every lifetime at half a second: the
       pool thins as the earlier births run out, and nothing new is born. */
    for (let at = 0; at < 42; at += 1) driver.advance(1 / 60);
    expect(driver.origin[0]).toBeCloseTo(100, 3);
    const lingering = driver.pool.count;
    expect(lingering).toBeGreaterThan(0);
    for (let at = 0; at < 12; at += 1) driver.advance(1 / 60);
    expect(driver.pool.count).toBeLessThan(lingering);

    /* The run is the flight plus the linger, so the next flight starts at 1.5 seconds. */
    for (let at = 0; at < 10; at += 1) driver.advance(1 / 60);
    expect(driver.elapsed).toBeCloseTo(94 / 60 - 1.5, 3);
    expect(driver.origin[0]).toBeCloseTo((94 / 60 - 1.5) * 100, 2);
  });

  it("flies a path rig on its Y, so a birth along Y flies with it and Z hangs down", () => {
    const driver = driverFor(system(emitter({ birthVelocity: constant(0, 100, 0) })), 3);
    driver.steer({
      motion: { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 },
      life: "once",
      height: 0,
    });
    driver.advance(1 / 60);

    expect(driver.pool.count).toBeGreaterThan(0);
    expect(driver.pool.velocity[0]).toBeCloseTo(100, 3);
    expect(driver.pool.velocity[1]).toBeCloseTo(0, 3);
    expect(driver.pool.velocity[2]).toBeCloseTo(0, 3);

    const lifted = driverFor(system(emitter({ birthVelocity: constant(0, 0, -100) })), 3);
    lifted.steer({
      motion: { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 },
      life: "once",
      height: 0,
    });
    lifted.advance(1 / 60);
    expect(lifted.pool.velocity[1]).toBeCloseTo(100, 3);
  });

  describe("on a bone", () => {
    /** An anchor walking a hundred units a second along `x`, turned a quarter about up. */
    const walker = {
      originAt: (time: number) => [time * 100, 0, 0] as const,
      basisInto: (_time: number, out: Float32Array) => {
        out.set([0, 0, 1, 0, 1, 0, -1, 0, 0]);
        return out;
      },
    };
    const bone = {
      motion: { kind: "bone", anchor: walker, target: null },
      life: "once",
      height: 0,
    } as const;

    it("births where the anchor has walked", () => {
      const driver = driverFor(system(emitter({ birthVelocity: constant(0, 0, 0) })), 3);
      driver.steer(bone);
      for (let at = 0; at < 60; at += 1) driver.advance(1 / 60);

      expect(reach(driver.pool)).toBeGreaterThan(90);
      expect(driver.origin[0]).toBeCloseTo(100, 3);
    });

    it("turns the system by the anchor's whole basis", () => {
      const driver = driverFor(system(emitter({ birthVelocity: constant(0, 0, 100) })), 3);
      driver.steer(bone);
      driver.advance(1 / 60);

      expect([...driver.orientation]).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
      expect(driver.pool.count).toBeGreaterThan(0);
      expect(driver.pool.velocity[0]).toBeCloseTo(100, 3);
      expect(driver.pool.velocity[2]).toBeCloseTo(0, 3);
    });

    it("puts a seek and the frames it replays in the same place", () => {
      const model = system(emitter());
      const played = driverFor(model, 3);
      played.steer(bone);
      for (let at = 0; at < 30; at += 1) played.advance(1 / 60);

      const sought = driverFor(model, 3);
      sought.steer(bone);
      sought.seek(0.5);

      expect(snapshot(sought.pool)).toEqual(snapshot(played.pool));
    });
  });

  it("places everything under the definition's own transform, outermost", () => {
    const model: SystemModel = {
      ...system(emitter({ birthVelocity: constant(0, 0, 0) })),
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 500, 0, 0, 1],
    };
    const driver = run(model, 3, 1);

    expect(driver.pool.count).toBeGreaterThan(0);
    expect(driver.pool.position[0]).toBeCloseTo(500, 3);
    expect(driver.origin).toEqual([500, STAND_HEIGHT, 0]);
  });

  it("puts the run back to its start when the motion itself changes", () => {
    const driver = run(system(emitter()), 3, 60);
    expect(driver.pool.count).toBeGreaterThan(0);

    driver.steer({ motion: { kind: "orbit", radius: 100, period: 2 }, life: "once", height: 0 });

    expect(driver.pool.count).toBe(0);
    expect(driver.time).toBe(0);
  });

  it("keeps the particles already in the air when only the lifecycle changes", () => {
    const driver = run(system(emitter()), 3, 60);
    const before = snapshot(driver.pool);
    expect(before.count).toBeGreaterThan(0);

    driver.steer({ motion: { kind: "still" }, life: "loop", height: 0 });

    expect(snapshot(driver.pool)).toEqual(before);
    expect(driver.time).toBeGreaterThan(0);
  });

  /* `brief` plays out inside a second, so 1.3s is past the end of a first run and
     inside a second one that a looping rig has started. */
  const PAST_ONE_RUN = { seconds: 1.3, frames: 78 };

  it("plays a run through and leaves it finished under a rig that does not loop", () => {
    const driver = driverFor(system(brief), 3);
    driver.steer({ motion: { kind: "still" }, life: "once", height: 0 });

    for (let at = 0; at < PAST_ONE_RUN.frames; at += 1) driver.advance(1 / 60);

    expect(driver.pool.count).toBe(0);
  });

  it("starts the effect over under a looping rig", () => {
    const driver = driverFor(system(brief), 3);
    driver.steer({ motion: { kind: "still" }, life: "loop", height: 0 });

    for (let at = 0; at < PAST_ONE_RUN.frames; at += 1) driver.advance(1 / 60);

    expect(driver.pool.count).toBeGreaterThan(0);
  });

  it("replays a loop the same way a seek reaches it", () => {
    const rig = { motion: { kind: "still" }, life: "loop", height: 0 } as const;

    const played = driverFor(system(brief), 5);
    played.steer(rig);
    for (let at = 0; at < PAST_ONE_RUN.frames; at += 1) played.advance(1 / 60);

    const sought = driverFor(system(brief), 5);
    sought.steer(rig);
    sought.seek(PAST_ONE_RUN.seconds);

    expect(sought.pool.count).toBeGreaterThan(0);
    expect(snapshot(sought.pool)).toEqual(snapshot(played.pool));
  });

  it("wraps a loop on the clock rather than on when the rig was bound", () => {
    const rig = { motion: { kind: "still" }, life: "loop", height: 0 } as const;

    /* Bound 1.5s in, off the beat of `brief`'s own one-second run, so a rig counting
       from where it was bound would wrap half a run away from where the clock does. */
    const played = driverFor(system(brief), 5);
    for (let at = 0; at < 90; at += 1) played.advance(1 / 60);
    played.steer(rig);
    for (let at = 0; at < 60; at += 1) played.advance(1 / 60);

    const sought = driverFor(system(brief), 5);
    sought.steer(rig);
    sought.seek(2.5);

    expect(played.pool.count).toBeGreaterThan(0);
    expect(snapshot(played.pool)).toEqual(snapshot(sought.pool));
  });
});

describe("checkpoints", () => {
  /** A child system whose particles play out on their own. */
  const embers = system(
    emitter({
      name: "ember",
      rate: constant(30),
      particleLifetime: constant(0.5),
      particleLinger: 0.5,
      birthVelocity: constant(0, 0, 0),
      acceleration: constant(0, 0, 0),
    }),
  );

  function childSet(over: Partial<ChildSetModel> = {}): ChildSetModel {
    return {
      children: [embers],
      bones: [],
      probability: constant(0),
      onDeath: false,
      inheritance: null,
      ...over,
    };
  }

  /** One particle at the start, living a second, carrying a child system of its own. */
  function parent(over: Partial<EmitterModel> = {}): EmitterModel {
    return emitter({
      rate: constant(1),
      lifetime: 0.1,
      particleLifetime: constant(1),
      birthVelocity: constant(0, 100, 0),
      acceleration: constant(0, 0, 0),
      childSet: childSet(),
      ...over,
    });
  }

  /** An emitter that plays out inside the shortest run a rig loops on. */
  const brief = emitter({ lifetime: 0.3, particleLifetime: constant(0.2) });

  const LOOPING = { motion: { kind: "still" }, life: "loop", height: 0 } as const;

  it("puts a seek through a checkpoint where a seek from zero puts it", () => {
    const model = system(emitter());
    const straight = driverFor(model, 7);
    straight.seek(0.42);

    const through = driverFor(model, 7);
    through.seek(1);
    through.seek(0.42);

    expect(stood(through)).toEqual(stood(straight));
  });

  it("starts a seek at the checkpoint rather than replaying the run from zero", () => {
    const driver = driverFor(system(emitter()), 7);
    driver.seek(1);
    const late = driver.histogram.counts(0)[55];
    expect(late).toBeGreaterThan(0);

    driver.seek(0.42);

    /* A rewind clears the lanes, and a restore leaves the bins past the checkpoint. */
    expect(driver.histogram.counts(0)[55]).toBe(late);
  });

  it("puts a seek through a checkpoint where a seek from zero puts it across a loop wrap", () => {
    const straight = driverFor(system(brief), 5);
    straight.steer(LOOPING);
    straight.seek(1.3);

    const through = driverFor(system(brief), 5);
    through.steer(LOOPING);
    through.seek(2);
    through.seek(1.3);

    expect(straight.pool.count).toBeGreaterThan(0);
    expect(stood(through)).toEqual(stood(straight));
  });

  it("puts a seek through a checkpoint where a seek from zero puts it across a death spawn", () => {
    const model = system(parent({ childSet: childSet({ onDeath: true }) }));
    const straight = driverFor(model, 5);
    straight.seek(0.9);

    const through = driverFor(model, 5);
    through.seek(2);
    through.seek(0.9);
    expect(stood(through, "0.0")).toEqual(stood(straight, "0.0"));

    /* The particle dies past the checkpoint, off the state the checkpoint carried over. */
    for (let at = 0; at < 30; at += 1) {
      straight.advance(1 / 60);
      through.advance(1 / 60);
    }

    expect(through.sources("0.0")).toHaveLength(1);
    expect(stood(through, "0.0")).toEqual(stood(straight, "0.0"));
  });

  it("drops the checkpoints when an edit swaps the definition", () => {
    const first = system(emitter({ birthVelocity: constant(0, 100, 0) }));
    const next = system(emitter({ birthVelocity: constant(100, 0, 0) }));
    const edited = driverFor(first, 7);
    edited.seek(1);
    edited.swap(next);
    edited.seek(0.42);

    const fresh = driverFor(next, 7);
    fresh.seek(0.42);

    expect(stood(edited)).toEqual(stood(fresh));
  });

  it("drops the checkpoints when the rig is tuned", () => {
    const flight = { kind: "path", from: [0, 0, 0], to: [1000, 0, 0], speed: 100 } as const;
    const quick = { motion: { ...flight, speed: 400 }, life: "once", height: 0 } as const;
    const model = system(emitter());

    const steered = driverFor(model, 7);
    steered.steer({ motion: flight, life: "once", height: 0 });
    steered.seek(1);
    steered.steer(quick);
    steered.seek(0.42);

    const fresh = driverFor(model, 7);
    fresh.steer(quick);
    fresh.seek(0.42);

    expect(stood(steered)).toEqual(stood(fresh));
  });
});

describe("the lanes' histogram", () => {
  it("counts the live particles at the bin each step lands in", () => {
    const driver = driverFor(system(emitter()), 7);
    driver.seek(1);
    const { histogram } = driver;

    expect(histogram.bin).toBeCloseTo(1 / 60, 10);
    expect(histogram.bins).toBe(360);
    expect(histogram.counts(0)).toHaveLength(histogram.bins);
    /* A step is binned on the phase it ends at, which a second of 60 steps lands at bin 60. */
    expect(histogram.reached).toBe(60);
    expect(histogram.counts(0)[30]).toBeGreaterThan(0);
    expect(histogram.counts(0)[histogram.reached]).toBe(driver.pool.count);
    expect(histogram.counts(0)[histogram.reached + 1]).toBe(0);
  });

  it("follows the clock with the bin it has reached, and starts the pass over on a wrap", () => {
    const brief = emitter({ lifetime: 0.3, particleLifetime: constant(0.2) });
    const driver = driverFor(system(brief), 5);
    driver.steer({ motion: { kind: "still" }, life: "loop", height: 0 });

    driver.seek(0.9);
    expect(driver.histogram.bins).toBe(60);
    expect(driver.histogram.reached).toBeGreaterThan(50);

    driver.seek(1.05);
    expect(driver.histogram.reached).toBeLessThan(5);
  });

  it("clears the lanes when an edit swaps the definition", () => {
    const driver = driverFor(system(emitter()), 7);
    driver.seek(1);
    expect(driver.histogram.counts(0)[59]).toBeGreaterThan(0);

    driver.swap(system(emitter({ lifetime: 0.5 })));

    expect(driver.histogram.counts(0)[59]).toBe(0);
    expect(driver.histogram.reached).toBe(-1);
  });
});

describe("the births log", () => {
  const embers = system(emitter({ name: "ember", rate: constant(30) }));

  /** One particle carrying a child system, which the log names once it spawns. */
  const parent = emitter({
    rate: constant(1),
    lifetime: 0.1,
    particleLifetime: constant(1),
    childSet: {
      children: [embers],
      bones: [],
      probability: constant(0),
      onDeath: false,
      inheritance: null,
    },
  });

  it("names the child a run spawned, and empties on a restart", () => {
    const driver = driverFor(system(parent), 5);
    driver.seek(0.5);

    expect(driver.births()).toHaveLength(1);
    const [birth] = driver.births();
    expect(birth.path).toBe("0.0");
    expect(birth.emitter).toBe(0);
    expect(birth.slot).toBe(0);
    expect(birth.depth).toBe(1);
    expect(birth.bornAt).toBeGreaterThan(0);
    expect(birth.bornAt).toBeLessThan(0.1);

    driver.restart();

    expect(driver.births()).toHaveLength(0);
  });

  it("starts the log over on a loop wrap", () => {
    const driver = driverFor(system(parent), 5);
    driver.steer({ motion: { kind: "still" }, life: "loop", height: 0 });

    driver.seek(0.5);
    expect(driver.births()).toHaveLength(1);

    driver.seek(1.5);
    expect(driver.births()).toHaveLength(1);
  });
});
