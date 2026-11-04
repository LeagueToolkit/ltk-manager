import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  DoubleSide,
  type Material,
  type Matrix4,
  type Mesh,
  MeshLambertMaterial,
  type RawShaderMaterial,
  type Texture,
} from "three";

import { useDisposable } from "@/hooks";
import type { MaterialProgram } from "@/lib/tauri";

import { EngineEnvironment, type MeshLights } from "../../hexshade/engineEnvironment";
import { bindProgramTextures, createProgramMaterial } from "../../hexshade/programMaterial";
import { programWith } from "../../hexshade/programTextures";
import { STAGE_ORDER } from "../../shared/utils/space";
import { createGeometryView } from "../utils/backdropGeometry";
import { type BlendTier, type MeshRun, writeGroups } from "../utils/backdropRuns";
import { type EdgeIndex, writeEdgeGroups } from "../utils/edgeGeometry";
import { KEEPS_GROUP_ORDER } from "../utils/sharedRenderer";
import type { Surface } from "../utils/viewMode";

/** The flat neutral that a dragged mesh draws in where its own surface cannot follow the drag. */
const STONE = 0x9a958c;

/** The flag under which the renderer keeps the order of the groups this component writes. */
const ORDERED = { [KEEPS_GROUP_ORDER]: true };

/** One entry of the backdrop's material array, as the dragged copy reads it. */
export interface DraggedSurface {
  readonly material: Material;
  /** The translated program the material draws under, and null for a stock one. */
  readonly program: MaterialProgram | null;
  /** The mesh's own `disable_backface_culling`, which outranks the material's state. */
  readonly doubleSided: boolean;
}

export interface DraggedMeshesProps {
  /** The backdrop's geometry, whose index and attributes the copy draws. */
  readonly geometry: BufferGeometry;
  /** The runs of the dragged meshes, and none outside a drag. */
  readonly runs: readonly MeshRun[];
  /** The drag's change, in the engine's space. */
  readonly delta: Matrix4;
  /** The backdrop's material array entries, by the `materialIndex` of its groups. */
  readonly surfaces: readonly DraggedSurface[];
  /** The tier of each entry of `surfaces`. */
  readonly tiers: readonly BlendTier[];
  readonly surface: Surface;
  /** The textures the programs sample, keyed as `programWith` reads them. */
  readonly programTextures: ReadonlyMap<string, Texture>;
  /** The light maps of each mesh, by the first index of its draw group. */
  readonly lights: ReadonlyMap<number, MeshLights>;
  /** The backdrop's environment, whose sun, grass tint and terrain the copy's programs read. */
  readonly environment: EngineEnvironment;
  /** The surfaces draw, which a wireframe view mode turns off. */
  readonly solids: boolean;
  /** The backdrop's edge lines and their index, and null where no edges draw. */
  readonly edgeGeometry: BufferGeometry | null;
  readonly edgeIndex: EdgeIndex | null;
  readonly edgeMaterials: Material[] | null;
}

/** The groups that the copy last wrote, and the geometries it wrote them into. */
interface Written {
  runs: readonly MeshRun[] | null;
  tiers: readonly BlendTier[] | null;
  view: BufferGeometry | null;
  edgeView: BufferGeometry | null;
}

/**
 * The meshes of a backdrop that a gizmo drag moves, drawn at the drag's transform.
 *
 * A second draw of the backdrop's index and attributes, whose groups hold only the dragged runs,
 * inside the backdrop's mirrored group with `delta` as its matrix. A stock material is the
 * backdrop's own. A translated program reads its clip transform from an environment of one
 * object, so the copy builds its own material of each over an environment of its own. The
 * `conformance` surface reads the stored position, so the copy draws flat in that mode. Mounted
 * for the backdrop's life, so a program compiles once rather than once per drag.
 */
export function DraggedMeshes({
  geometry,
  runs,
  delta,
  surfaces,
  tiers,
  surface,
  programTextures,
  lights,
  environment: backdrop,
  solids,
  edgeGeometry,
  edgeIndex,
  edgeMaterials,
}: DraggedMeshesProps) {
  const clock = useThree((state) => state.clock);
  const invalidate = useThree((state) => state.invalidate);
  const held = useRef<Mesh>(null);

  const view = useDisposable(() => createGeometryView(geometry), [geometry]);
  const edgeView = useDisposable(
    () => (edgeGeometry === null ? null : createGeometryView(edgeGeometry)),
    [edgeGeometry],
  );

  /* A program's environment buffers are this object's, so it draws under the `uniform` binding,
     which takes no renderer binding point. */
  const environment = useDisposable(() => new EngineEnvironment("uniform"), []);
  const programs = useDisposable(() => new DraggedPrograms(environment), [surfaces, environment]);
  const stone = useDisposable(
    () => new MeshLambertMaterial({ color: STONE, side: DoubleSide }),
    [],
  );

  const materials = useMemo(() => {
    const used = new Set(runs.flatMap((run) => run.groups.map((group) => group.material)));

    return surfaces.map((entry, at) => {
      if (!used.has(at)) return entry.material;
      if (surface === "conformance") return stone;

      return programs.materialFor(at, entry, programTextures) ?? entry.material;
    });
  }, [runs, surfaces, surface, stone, programs, programTextures]);

  useEffect(() => {
    programs.bind(surfaces, programTextures);
  }, [programs, surfaces, programTextures]);

  useEffect(() => {
    invalidate();
  }, [delta, runs, invalidate]);

  /* Written in the frame for the reason the backdrop writes its own groups there. */
  const written = useRef<Written>({ runs: null, tiers: null, view: null, edgeView: null });
  useFrame(() => {
    const last = written.current;
    const stale =
      last.runs !== runs ||
      last.tiers !== tiers ||
      last.view !== view ||
      last.edgeView !== edgeView;
    if (!stale) return;

    writeGroups(view, runs, tiers);
    if (edgeView !== null && edgeIndex !== null) {
      writeEdgeGroups(edgeView, view.groups, edgeIndex.ranges);
    }

    last.runs = runs;
    last.tiers = tiers;
    last.view = view;
    last.edgeView = edgeView;
  });

  return (
    <group matrix={delta} matrixAutoUpdate={false}>
      <mesh
        geometry={view}
        material={materials}
        visible={solids && runs.length > 0}
        renderOrder={STAGE_ORDER}
        frustumCulled={false}
        userData={ORDERED}
        onBeforeRender={(renderer, _scene, camera, _geometry, material, group) => {
          const mesh = held.current;
          if (mesh !== null) {
            environment.light = backdrop.light;
            environment.grassTint = backdrop.grassTint;
            environment.terrain = backdrop.terrain;
            environment.write(renderer, camera, mesh, clock.elapsedTime);
          }
          /* Typed as an object, and at run time the geometry group of the draw. */
          const { start } = group as unknown as { start: number };
          environment.draw(material, lights.get(start) ?? null);
        }}
        ref={held}
      />
      {edgeView !== null && edgeMaterials !== null && (
        <lineSegments
          geometry={edgeView}
          material={edgeMaterials}
          visible={runs.length > 0}
          renderOrder={STAGE_ORDER}
          frustumCulled={false}
        />
      )}
    </group>
  );
}

/** The program materials of a dragged copy, one per backdrop material, over the copy's environment. */
class DraggedPrograms {
  private readonly made = new Map<number, RawShaderMaterial>();

  constructor(private readonly environment: EngineEnvironment) {}

  /** Returns the copy's material for the entry `entry` at `at`, and null for a stock entry. */
  materialFor(
    at: number,
    entry: DraggedSurface,
    textures: ReadonlyMap<string, Texture>,
  ): RawShaderMaterial | null {
    const held = this.made.get(at);
    if (held !== undefined) return held;

    if (!isProgram(entry.material)) return null;
    const program = programWith(entry.program, textures);
    if (program === null) return null;

    const material = createProgramMaterial(program, this.environment);
    if (entry.doubleSided) material.side = DoubleSide;
    this.made.set(at, material);
    return material;
  }

  /** Binds every built material to the textures that `textures` holds for its program. */
  bind(surfaces: readonly DraggedSurface[], textures: ReadonlyMap<string, Texture>): void {
    for (const [at, material] of this.made) {
      const program = programWith(surfaces[at]?.program ?? null, textures);
      if (program !== null) bindProgramTextures(material, program);
      if (surfaces[at]?.doubleSided === true) material.side = DoubleSide;
    }
  }

  dispose(): void {
    for (const material of this.made.values()) material.dispose();
    this.made.clear();
  }
}

function isProgram(material: Material): material is RawShaderMaterial {
  return (material as RawShaderMaterial).isRawShaderMaterial === true;
}
