import { TransformControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { ArrowHelper, Group, Matrix4, Vector3 } from "three";

import { AXIS_SIGN, useSceneColors } from "@/modules/viewport";

import type { LeafEdit } from "../../tree/hooks/useLeafEdit";
import type { EmitterModel, SystemModel } from "../engine/model/model";
import { worldOf } from "../engine/simulation/integrate";
import { frameOf } from "../engine/simulation/particleRead";
import { useVfxRun } from "../playback/state/run";
import { commitForceValue, validForceValue } from "./forceEdits";
import {
  ORBIT_GUIDE_RADIUS,
  forceDirectionFrame,
  forceHandle,
  forceHandleValue,
  forceOrigin,
  forceSample,
} from "./forceGeometry";
import type { AuthoredForce } from "./forceModel";
import { previewForceValue } from "./forcePreview";

interface Props {
  system: SystemModel;
  emitter: EmitterModel;
  force: AuthoredForce;
  handle: string | null;
  edit: LeafEdit | null;
}

/** Force extents and direction, with a single undoable constant edit per drag. */
export function ForceGizmo({ system, emitter, force, handle, edit }: Props) {
  const { driver, playing, setPlaying } = useVfxRun();
  const controls = useThree((state) => state.controls);
  const colors = useSceneColors();
  const object = useMemo(() => new Group(), []);
  const sphere = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const arrow = useMemo(() => new ArrowHelper(), []);
  const transform = useRef<ComponentRef<typeof TransformControls>>(null);
  const placement = useRef({
    origin: new Vector3(),
    center: new Vector3(),
    direction: new Matrix4(),
  });
  const world = useMemo(() => worldOf(system), [system]);
  const property = forceHandle(force, handle);
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const drag = useRef<{
    time: number;
    playing: boolean;
    camera: boolean;
    saving: boolean;
    value: number[] | null;
  } | null>(null);
  const cameraEnabled = useRef(true);

  /* A pointer reports more moves than frames, and each preview replays the run, so the
     drag previews its latest value once per frame. */
  const previewFrame = useRef<{ frame: number; next: SystemModel; time: number } | null>(null);

  function preview(next: SystemModel, time: number) {
    if (previewFrame.current !== null) {
      previewFrame.current.next = next;
      previewFrame.current.time = time;
      return;
    }

    const frame = requestAnimationFrame(() => {
      const latest = previewFrame.current;
      previewFrame.current = null;
      if (latest === null) {
        return;
      }

      driver.swap(latest.next);
      driver.seek(latest.time);
    });
    previewFrame.current = { frame, next, time };
  }

  function cancelPreview() {
    if (previewFrame.current !== null) {
      cancelAnimationFrame(previewFrame.current.frame);
      previewFrame.current = null;
    }
  }

  function restore(value?: number[]) {
    const held = drag.current;
    if (held === null) {
      return;
    }

    cancelPreview();
    drag.current = null;
    transform.current?.reset();
    setGeneration((value) => value + 1);
    setSaving(false);
    driver.swap(
      value === undefined || property === null
        ? system
        : previewForceValue(system, force, property.name, value),
    );
    driver.seek(held.time);
    setPlaying(held.playing);
    if (controls !== null && "enabled" in controls) {
      controls.enabled = held.camera;
    }
  }

  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current !== null && !drag.current.saving) {
        event.stopPropagation();
        restoreRef.current();
      }
    };
    window.addEventListener("keydown", cancel, true);

    return () => {
      window.removeEventListener("keydown", cancel, true);
      restoreRef.current();
    };
  }, [system, force.key, handle]);

  useEffect(() => () => arrow.dispose(), [arrow]);

  useFrame(() => {
    if (drag.current !== null) {
      return;
    }

    if (controls !== null && "enabled" in controls) {
      cameraEnabled.current = Boolean(controls.enabled);
    }

    const frame = frameOf(driver, emitter);
    const origin = forceOrigin(emitter, frame, world.basis);
    const center = new Vector3()
      .fromArray(forceSample(force, "Position", frame.phase))
      .multiply(new Vector3(...AXIS_SIGN))
      .add(origin);
    const direction = forceDirectionFrame(force, emitter, frame);
    const radius = Math.max(0, forceSample(force, "radius", frame.phase)[0]);
    placement.current = { origin, center, direction };

    sphere.current?.position.copy(center);
    sphere.current?.scale.setScalar(radius);
    const vectorName = force.definition.kind === "orbital" ? "direction" : "acceleration";
    const vector = new Vector3()
      .fromArray(forceSample(force, vectorName, frame.phase))
      .applyMatrix4(direction);
    const length = vector.length();
    arrow.visible =
      Number.isFinite(length) &&
      length > 0 &&
      (force.definition.kind === "acceleration" || force.definition.kind === "orbital");
    arrow.position.copy(origin);
    arrow.setColor(colors.gizmo);
    if (arrow.visible) {
      arrow.setDirection(vector.clone().normalize());
      arrow.setLength(length, Math.min(length * 0.2, 12), Math.min(length * 0.1, 6));
    }

    if (ring.current !== null) {
      ring.current.visible = length > 0;
      ring.current.position.copy(origin);
      ring.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), vector.clone().normalize());
    }

    object.position.copy(center);
    if (property?.name === "radius") {
      object.position.x += radius;
    } else if (property !== null && property.name !== "Position") {
      object.position.copy(origin).add(vector);
    }
    object.updateMatrixWorld();
  });

  function change() {
    const held = drag.current;
    if (held === null || held.saving || property === null) {
      return;
    }

    const { origin, center, direction } = placement.current;
    const value = forceHandleValue(property.name, object.position, origin, center, direction);
    if (!validForceValue(property, value)) {
      return;
    }

    held.value = value;
    preview(previewForceValue(system, force, property.name, value), held.time);
    if (property.name === "radius") {
      sphere.current?.scale.setScalar(value[0]);
    } else if (property.name === "Position") {
      sphere.current?.position.copy(object.position);
    } else {
      const vector = object.position.clone().sub(origin);
      const length = vector.length();
      arrow.visible = length > 0;
      if (length > 0) {
        arrow.setDirection(vector.clone().normalize());
        arrow.setLength(length, Math.min(length * 0.2, 12), Math.min(length * 0.1, 6));
      }

      if (ring.current !== null) {
        ring.current.visible = length > 0;
        if (length > 0) {
          ring.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), vector.normalize());
        }
      }
    }
  }

  async function finish() {
    const held = drag.current;
    if (held === null || held.saving || property === null || edit === null) {
      return;
    }
    if (held.value === null) {
      restore();
      return;
    }

    held.saving = true;
    setSaving(true);
    try {
      const saved = await commitForceValue(edit, force, property, held.value);
      if (drag.current === held) {
        restore(saved ? held.value : undefined);
      }
    } catch {
      if (drag.current === held) {
        restore();
      }
    }
  }

  const radial =
    force.definition.kind === "attraction" ||
    force.definition.kind === "noise" ||
    force.definition.kind === "drag";
  return (
    <>
      {radial && (
        <group ref={sphere}>
          <mesh>
            <sphereGeometry args={[1, 24, 12]} />
            <meshBasicMaterial
              color={colors.gizmo}
              wireframe
              transparent
              opacity={0.35}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
      {force.definition.kind === "orbital" && (
        <group ref={ring}>
          <mesh>
            <torusGeometry args={[ORBIT_GUIDE_RADIUS, 0.4, 4, 48]} />
            <meshBasicMaterial color={colors.gizmo} depthTest={false} />
          </mesh>
        </group>
      )}
      <primitive object={arrow} />
      <primitive object={object} />
      {property !== null && edit !== null && (
        <TransformControls
          key={generation}
          ref={transform}
          enabled={!saving}
          object={object}
          mode="translate"
          space="world"
          showY={property.name !== "radius"}
          showZ={property.name !== "radius"}
          onMouseDown={() => {
            if (
              drag.current !== null ||
              Math.abs(placement.current.direction.determinant()) < 1e-8
            ) {
              return;
            }

            drag.current = {
              time: driver.phase,
              playing,
              camera: cameraEnabled.current,
              saving: false,
              value: null,
            };
            setPlaying(false);
          }}
          onObjectChange={change}
          onMouseUp={() => {
            void finish();
          }}
        />
      )}
    </>
  );
}
