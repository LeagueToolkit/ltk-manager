import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import {
  type Camera,
  DoubleSide,
  FrontSide,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import { alongInto, mirrorInto, standingInto, unscaleInto } from "./basis";
import { fragmentTests, premultiplyInto } from "./blend";
import { type MeshBuffers, MESHES_PER_EMITTER, written } from "./buffers";
import { distorts } from "./drawKind";
import { useDrawPair } from "./drawPair";
import { meshMaterial } from "./materials";
import type { EmitterModel, MeshModel } from "./model";
import { sourcesScrollInto } from "./palette";
import {
  age01,
  appearance,
  type DrawFrame,
  drawnPlace,
  drawnPlaceInto,
  erosionDrive,
  frameOf,
  type Source,
  standingFrameInto,
} from "./particleRead";
import { FRAME_SLOTS, type Pool } from "./pool";
import { type LayerDraws, layersOf } from "./uniforms";
import type { EmitterSamplers } from "./useVfxTextures";
import { layerOf, uvDraw, uvTransformInto } from "./uvTransform";
import { WIRE_ORDER } from "./wire";

/** Scratch the frame reuses, so a draw allocates nothing per particle. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };
const UV_DRAWN = uvDraw();
const PLACE = new Matrix4();
const AT = new Vector3();
const TURN = new Quaternion();
const SPREAD = new Vector3();
const FACING = new Vector3();
const ASIDE = new Vector3();
const LIFT = new Vector3();
const ROLL = new Quaternion();
const FRAME = new Float32Array(FRAME_SLOTS);
const STANDING = new Float32Array(FRAME_SLOTS);
const STOOD = new Float32Array(FRAME_SLOTS);
const FRAME4 = new Matrix4();
const BORN_TURN = new Quaternion();

/** The scale the spawn frame carries in its columns, which stands beside the turn. */
const FRAME_SCALE = new Float32Array(3);

/** Where one particle draws, in the engine's space, before the mirror. */
const PLACED = drawnPlace();

/** The orbit's turn as the viewport sees it, which composes over a mesh's own. */
const ORBIT = new Quaternion();
const ORBIT_FRAME = new Float32Array(FRAME_SLOTS);

/** The rim, the reflection and the soft fade a mesh's shader compiles, and no ramp. */
const DRAWS: LayerDraws = { ramp: false, sheen: true, fade: true };

export interface MeshesProps {
  emitter: EmitterModel;
  /** Every system whose pool holds this emitter's particles. See `Quads`. */
  sources: readonly Source[];
  /** The emitter's own geometry, with the per-instance attributes the frame writes. */
  buffers: MeshBuffers;
  samplers: EmitterSamplers;
  /** Where the emitter falls in the system's draw order, from `drawRanks`. */
  rank: number;
  hidden: boolean;
}

/**
 * One emitter's particles, as instances of its mesh.
 *
 * A mesh takes a whole transform where a quad takes a centre and a size, so this builds
 * one matrix per particle rather than writing three arrays, and hands the fragment the
 * same two layer transforms a quad does. `AlignYawToCamera` and `AlignPitchToCamera`
 * turn that matrix toward the eye on the axis each names.
 */
export function Meshes({ emitter, sources, buffers, samplers, rank, hidden }: MeshesProps) {
  const { geometry, tint, erode } = buffers;
  const material = useMemo(
    () =>
      meshMaterial(
        emitter.blendMode,
        samplers.base,
        emitter.depthBias,
        layersOf(emitter, samplers, DRAWS),
        fragmentTests(emitter),
        emitter.backfaceCull ? FrontSide : DoubleSide,
      ),
    [emitter, samplers],
  );

  const pair = useDrawPair<InstancedMesh>(material, distorts(emitter));

  const drawn = !hidden && !emitter.disabled;

  useFrame((state) => {
    const held = pair.solid.current;
    if (held === null) return;
    /* Claimed every frame rather than once, because a change of `args` hands the ref a
       fresh mesh carrying a matrix of its own that the geometry's would shadow. */
    held.instanceMatrix = buffers.instanceMatrix;
    const twin = pair.twin.current;
    if (twin !== null) twin.instanceMatrix = buffers.instanceMatrix;

    if (!drawn) {
      held.count = 0;
      if (twin !== null) twin.count = 0;
      return;
    }

    sourcesScrollInto(emitter, sources, material.uniforms.paletteScroll.value as number[]);
    const turns = [buffers.uvTurn, buffers.uvTurnMult];
    const shifts = [buffers.uvShift, buffers.uvShiftMult];

    let instance = 0;
    for (const source of sources) {
      const pool = source.pool;
      const frame = frameOf(source, emitter);
      const time = frame.now;
      for (let at = 0; at < pool.count && instance < MESHES_PER_EMITTER; at += 1) {
        if (pool.emitter[at] !== emitter.index) continue;
        appearance(pool, at, emitter, time, DRAWN);
        premultiplyInto(emitter, DRAWN.color);

        const age = time - pool.birthTime[at];
        const through = age01(pool, at, time);
        for (let layer = 0; layer < turns.length; layer += 1) {
          const over = layerOf(emitter, layer);
          if (over === null) continue;
          uvTransformInto(pool, at, over, layer, age, through, time, UV_DRAWN);
          turns[layer].setXYZ(instance, UV_DRAWN.turn, UV_DRAWN.scaleU, UV_DRAWN.scaleV);
          shifts[layer].setXYZW(
            instance,
            UV_DRAWN.offsetU,
            UV_DRAWN.offsetV,
            UV_DRAWN.cellU,
            UV_DRAWN.cellV,
          );
        }

        drawnPlaceInto(pool, at, frame, PLACED);
        AT.set(
          PLACED.place[0] * AXIS_SIGN[0],
          PLACED.place[1] * AXIS_SIGN[1],
          PLACED.place[2] * AXIS_SIGN[2],
        );
        const stood = face(pool, at, emitter, frame, state.camera, AT);
        /* The complex mesh path scales each axis by its own component, `isUniformScale`
         having already broadcast the first over the other two where it is set. The
         spawn frame's own scale rides beside it, because `compose` takes the turn
         unscaled. */
        SPREAD.set(DRAWN.scale[0] * stood[0], DRAWN.scale[1] * stood[1], DRAWN.scale[2] * stood[2]);
        if (PLACED.orbited) {
          mirrorInto(PLACED.turn, 0, ORBIT_FRAME, 0);
          TURN.premultiply(ORBIT.setFromRotationMatrix(matrixOf(ORBIT_FRAME)));
        }

        held.setMatrixAt(instance, PLACE.compose(AT, TURN, SPREAD));
        tint.setXYZW(instance, DRAWN.color[0], DRAWN.color[1], DRAWN.color[2], DRAWN.color[3]);
        erode.setX(instance, erosionDrive(pool, at, emitter, time));
        instance += 1;
      }
    }

    held.count = instance;
    if (twin !== null) twin.count = instance;
    if (instance === 0) return;
    for (const attribute of [buffers.instanceMatrix, tint, erode, ...turns, ...shifts]) {
      written(attribute, instance);
    }
  });

  return (
    <>
      <instancedMesh
        ref={pair.solid}
        args={[geometry, material, MESHES_PER_EMITTER]}
        visible={pair.wire.shaded}
        renderOrder={rank}
        frustumCulled={false}
        dispose={null}
      />
      {pair.wire.material !== null && (
        <instancedMesh
          ref={pair.twin}
          args={[geometry, pair.wire.material, MESHES_PER_EMITTER]}
          renderOrder={rank + WIRE_ORDER}
          frustumCulled={false}
          dispose={null}
        />
      )}
    </>
  );
}

/**
 * The turn one particle's mesh takes, into `TURN`, returning the scale it stood on.
 *
 * All three rotation components reach a complex mesh, each about its own axis, and the
 * camera alignment each flag asks for comes on top of them. A direction-oriented mesh
 * aims its own `+Z` where it travels, and one that faces neither the eye nor its travel
 * stands on the frame it was born in.
 *
 * The spawn frame is the one turn a scale reaches, and the returned scale is ones for the
 * two that discard it.
 */
function face(
  pool: Pool,
  at: number,
  emitter: EmitterModel,
  frame: DrawFrame,
  camera: Camera,
  placed: Vector3,
): Float32Array {
  turnOf(standingInto(pool.rotation, at * 3, 0, STANDING), ROLL);
  FRAME_SCALE.fill(1);

  if (emitter.directionOriented) {
    /* The basis is built on the engine's own axes and mirrored whole, because a cross
       product changes sign under the mirror where a basis does not. */
    alongInto(pool.travel, at * 3, STANDING);
    turnOf(STANDING, TURN);
    return FRAME_SCALE;
  }

  const mesh = emitter.mesh;
  if (mesh !== null && (mesh.alignYaw || mesh.alignPitch) && aimed(placed, mesh, camera)) {
    /* The alignment composes over the particle's own turn, the flag that would discard it
       instead being identity for a particle whose orientation never changed. */
    TURN.multiply(ROLL);
    return FRAME_SCALE;
  }

  TURN.copy(ROLL);
  standingFrameInto(pool, at, emitter, frame, STOOD);
  mirrorInto(STOOD, 0, FRAME, 0);
  unscaleInto(FRAME, 0, FRAME, 0, FRAME_SCALE);
  TURN.premultiply(BORN_TURN.setFromRotationMatrix(matrixOf(FRAME)));
  return FRAME_SCALE;
}

/** One row-major 3x3 as the `Matrix4` a quaternion is read off, into the scratch. */
function matrixOf(basis: Float32Array): Matrix4 {
  return FRAME4.set(
    basis[0],
    basis[1],
    basis[2],
    0,
    basis[3],
    basis[4],
    basis[5],
    0,
    basis[6],
    basis[7],
    basis[8],
    0,
    0,
    0,
    0,
    1,
  );
}

/**
 * `D3DXMatrixLookAtLH` from the particle at the point each flag blends, into `TURN`.
 *
 * The eye is the particle, the up is the camera's, and the point aimed at takes its `x`
 * from the camera under `AlignYawToCamera`, its `y` under `AlignPitchToCamera` and its
 * `z` from the camera whatever either says. So yaw alone is a yaw and pitch alone is not
 * a pitch: it holds the particle's own `x` and aims across the world's `YZ`. False for a
 * degenerate aim, which leaves the particle on the turn it already has.
 */
function aimed(placed: Vector3, mesh: MeshModel, camera: Camera): boolean {
  const eye = camera.position;
  const { x, y, z } = placed;

  FACING.set((mesh.alignYaw ? eye.x : x) - x, (mesh.alignPitch ? eye.y : y) - y, eye.z - z);
  if (FACING.lengthSq() === 0) return false;

  ASIDE.crossVectors(camera.up, FACING.normalize());
  if (ASIDE.lengthSq() === 0) return false;

  LIFT.crossVectors(FACING, ASIDE.normalize());
  /* A simple mesh aims by the right-handed look-at, whose inverse is the skinned one's
     yawed half a turn about the camera's up: the forward and the right both flip and the
     up stands. So a `.scb` shows the camera its back where a `.skn` shows its front. */
  if (!mesh.skinned) {
    ASIDE.negate();
    FACING.negate();
  }
  TURN.setFromRotationMatrix(FRAME4.makeBasis(ASIDE, LIFT, FACING));
  return true;
}

/** One engine-space basis as the viewport's own turn, into `out`. */
function turnOf(basis: Float32Array, out: Quaternion): void {
  mirrorInto(basis, 0, FRAME, 0);
  out.setFromRotationMatrix(matrixOf(FRAME));
}
