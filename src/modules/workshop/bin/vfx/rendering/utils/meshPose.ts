import { DataTexture, FloatType, Matrix4, RGBAFormat } from "three";

import { AXIS_SIGN, type MeshGeometry, type Pose } from "@/modules/viewport";

import { MESHES_PER_EMITTER } from "./buffers";

/** Bone matrices per particle, in the mirrored space of the mesh geometry. */
export interface MeshPose {
  readonly source: Pose;
  readonly texture: DataTexture;
  write(instance: number, time: number): void;
  /** Upload the rows of the first `instances` particles, which is all a draw of that many reads. */
  commit(instances: number): void;
}

/** The step a particle's age is rounded to, so particles of one frame share one palette. */
const POSE_STEP = 1 / 60;

/** The most rows uploaded one by one, past which one upload of the whole texture is cheaper. */
const RANGED_ROWS = 32;

/**
 * The pose palette shared by the solid, distortion and wireframe draws.
 *
 * One row per particle. A row whose rounded age another row of the frame already has is
 * copied from it rather than posed again, and a commit uploads only the rows drawn.
 */
export function meshPose(pose: Pose): MeshPose {
  const { skeleton } = pose;
  const count = Math.max(1, skeleton.influences.length);
  const rowFloats = count * 16;
  const data = new Float32Array(rowFloats * MESHES_PER_EMITTER);
  const texture = new DataTexture(data, count * 4, MESHES_PER_EMITTER, RGBAFormat, FloatType);

  const world = new Float32Array(16);
  const matrix = new Matrix4();
  const inverse = new Matrix4();
  const mirror = new Matrix4().makeScale(...AXIS_SIGN);

  /* The row each rounded age of the frame was posed into, and the age each row has. */
  const rowOf = new Map<number, number>();
  const stepOf = new Float64Array(MESHES_PER_EMITTER).fill(Number.NaN);

  function poseInto(instance: number, time: number): void {
    for (let influence = 0; influence < count; influence += 1) {
      const slot = skeleton.influences[influence];
      if (slot === undefined) {
        matrix.identity();
      } else {
        matrix.fromArray(pose.worldInto(slot, time, world));
        matrix.multiply(inverse.fromArray(skeleton.joints[slot].inverseBind));
        matrix.premultiply(mirror).multiply(mirror);
      }

      matrix.toArray(data, (instance * count + influence) * 16);
    }
  }

  return {
    source: pose,
    texture,
    write(instance, time) {
      if (instance === 0) rowOf.clear();

      const step = Math.round(time / POSE_STEP);
      const previous = stepOf[instance];
      if (rowOf.get(previous) === instance) rowOf.delete(previous);
      stepOf[instance] = step;

      const row = rowOf.get(step);
      if (row === undefined) {
        poseInto(instance, step * POSE_STEP);
        rowOf.set(step, instance);
        return;
      }
      if (row !== instance)
        data.copyWithin(instance * rowFloats, row * rowFloats, (row + 1) * rowFloats);
    },
    commit(instances) {
      if (instances <= 0) return;

      texture.clearUpdateRanges();
      if (instances <= RANGED_ROWS) {
        for (let row = 0; row < instances; row += 1)
          texture.addUpdateRange(row * rowFloats, rowFloats);
      }
      texture.needsUpdate = true;
    },
  };
}

/** Skin weights normalized over valid influences, with an identity fallback for empty rows. */
export function skinWeights(mesh: MeshGeometry, influences: number): Float32Array {
  const out = new Float32Array((mesh.positions.length / 3) * 4);

  for (let vertex = 0; vertex < out.length; vertex += 4) {
    let sum = 0;
    for (let part = 0; part < 4; part += 1) {
      const index = mesh.skinIndices?.[vertex + part] ?? influences;
      const weight = mesh.skinWeights?.[vertex + part] ?? 0;

      if (index < influences && Number.isFinite(weight) && weight > 0) {
        out[vertex + part] = weight;
        sum += weight;
      }
    }

    if (sum > 0) {
      for (let part = 0; part < 4; part += 1) {
        out[vertex + part] /= sum;
      }
    }
  }

  return out;
}
