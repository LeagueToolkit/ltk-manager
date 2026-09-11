import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { BufferAttribute, BufferGeometry } from "three";

import { useSceneColors } from "@/modules/viewport";

import type { Driver } from "./driver";
import { placeInto, SEGMENTS, spawnFrameInto, wireframeInto } from "./emitterShape";
import { worldOf } from "./integrate";
import type { EmitterModel, SystemModel } from "./model";
import { frameOf } from "./particleRead";
import { FRAME_SLOTS } from "./pool";
import { sampleCurveInto } from "./sampleCurve";

export interface EmitterGizmoProps {
  readonly system: SystemModel;
  readonly driver: Driver;
  /** The emitter the strip has open, of the opened system. */
  readonly emitter: EmitterModel;
}

/**
 * The selected emitter's origin, its offset and its spawn shape, as a wireframe.
 *
 * The whole of it is built in the emitter's own space and placed through the frame a
 * birth is placed through, so what it draws is where the next particle lands. It is read
 * every frame, since the origin rides the rig and the offset rides the emitter's life.
 */
export function EmitterGizmo({ system, driver, emitter }: EmitterGizmoProps) {
  const colors = useSceneColors();
  const positions = useMemo(() => new Float32Array(SEGMENTS * 6), []);
  const world = useMemo(() => worldOf(system), [system]);
  const geometry = useRef<BufferGeometry>(null);
  const attribute = useRef<BufferAttribute>(null);

  useFrame(() => {
    const frame = frameOf(driver, emitter);
    spawnFrameInto(emitter, world.basis, frame.orientation, FRAME);
    STANDS.fill(0);
    sampleCurveInto(emitter.emitterPosition, frame.phase, STANDS, 0);

    const vertices = wireframeInto(emitter, STANDS, frame.phase, positions);
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      placeInto(positions, vertex * 3, FRAME, frame.origin);
    }

    geometry.current?.setDrawRange(0, vertices);
    if (attribute.current !== null) attribute.current.needsUpdate = true;
  });

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geometry}>
        <bufferAttribute ref={attribute} attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={colors.gizmo} />
    </lineSegments>
  );
}

/** The frame a birth is placed in, which `integrate.ts` calls the emitter's spawn frame. */
const FRAME = new Float32Array(FRAME_SLOTS);

/** Where `EmitterPosition` has the emitter this frame. */
const STANDS = new Float32Array(3);
