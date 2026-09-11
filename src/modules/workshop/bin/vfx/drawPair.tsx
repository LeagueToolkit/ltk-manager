import { type RefObject, useEffect, useRef } from "react";
import type { BufferGeometry, LineSegments, Mesh, Object3D, ShaderMaterial } from "three";

import { useDrawLayer } from "./frame";
import { useWire, type Wire, WIRE_ORDER } from "./wire";

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
