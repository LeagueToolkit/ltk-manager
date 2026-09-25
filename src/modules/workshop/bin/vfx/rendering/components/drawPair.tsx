import { type RefObject, useEffect, useRef } from "react";
import {
  type BufferGeometry,
  type LineSegments,
  Mesh,
  type Object3D,
  type ShaderMaterial,
} from "three";

import { passTwin } from "@/modules/viewport";

import type { ParticleProgram } from "../hooks/useParticlePrograms";
import { useWire, type Wire, WIRE_ORDER } from "../state/wire";
import { useDrawLayer } from "../utils/frame";

/** The solid and its edge twin one draw path mounts, and the wire mode they draw under. */
export interface DrawPair<T extends Object3D> {
  readonly solid: RefObject<T | null>;
  readonly twin: RefObject<T | null>;
  readonly wire: Wire;
}

/** Own `material`'s lifetime and both objects' layers, "The viewer" in docs/ux/BIN_EDITOR.md. */
export function useDrawPair<T extends Object3D>(
  material: ShaderMaterial,
  distorting: boolean,
): DrawPair<T> {
  useEffect(() => () => material.dispose(), [material]);
  const solid = useRef<T>(null);
  const twin = useRef<T>(null);
  useDrawLayer(distorting, solid);
  const wire = useWire(material);
  useDrawLayer(false, twin);
  return { solid, twin, wire };
}

interface DrawPairProps {
  readonly pair: DrawPair<Mesh | LineSegments>;
  readonly geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly rank: number;
  /** The geometry the twin draws as line segments, and the solid's own as a wireframe mesh where unset. */
  readonly edges?: BufferGeometry;
}

/** The solid one draw path mounts, and its edge twin under the run's wireframe mode. */
export function DrawPair({ pair, geometry, material, rank, edges }: DrawPairProps) {
  return (
    <>
      <mesh
        ref={pair.solid as RefObject<Mesh | null>}
        geometry={geometry}
        material={material}
        visible={pair.wire.shaded}
        renderOrder={rank}
        frustumCulled={false}
      />
      {pair.wire.material !== null && edges === undefined && (
        <mesh
          ref={pair.twin as RefObject<Mesh | null>}
          geometry={geometry}
          material={pair.wire.material}
          renderOrder={rank + WIRE_ORDER}
          frustumCulled={false}
        />
      )}
      {pair.wire.material !== null && edges !== undefined && (
        <lineSegments
          ref={pair.twin as RefObject<LineSegments | null>}
          geometry={edges}
          material={pair.wire.material}
          renderOrder={rank + WIRE_ORDER}
          frustumCulled={false}
        />
      )}
    </>
  );
}

/**
 * Show both objects of `pair` only while they draw something.
 *
 * three binds an object's program and uploads its uniforms before it finds a draw of zero
 * instances, so an emitter hidden, culled or empty this frame is taken out of the render list.
 */
export function showPair<T extends Object3D>(pair: DrawPair<T>, drawing: boolean): void {
  const solid = pair.solid.current;
  if (solid !== null) solid.visible = drawing && pair.wire.shaded;
  const twin = pair.twin.current;
  if (twin !== null) twin.visible = drawing;
}

/**
 * `programs` drawn on `solid`: the first pass on the solid and each later pass on a twin under
 * it, each writing its engine buffers before it draws. The caller swaps the solid's material.
 */
export function useProgramDraw(
  solid: RefObject<Object3D | null>,
  programs: readonly ParticleProgram[],
): void {
  const first = programs[0] ?? null;

  useEffect(() => {
    const mesh = solid.current;
    if (!(mesh instanceof Mesh) || first === null) return;

    mesh.onBeforeRender = first.draw;
    const twins = programs.slice(1).map((later, at) => {
      const twin = passTwin(mesh, at + 1);
      twin.material = later.material;
      twin.onBeforeRender = later.draw;
      twin.layers.mask = mesh.layers.mask;
      mesh.add(twin);
      return twin;
    });
    return () => {
      mesh.onBeforeRender = noDraw;
      for (const twin of twins) mesh.remove(twin);
    };
  }, [solid, first, programs]);
}

/** The `onBeforeRender` of a mesh with nothing to write before it draws. */
export function noDraw(): void {}
