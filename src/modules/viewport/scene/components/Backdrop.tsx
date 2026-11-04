import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Box3,
  type BufferGeometry,
  Color,
  DoubleSide,
  Frustum,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type RawShaderMaterial,
  type Texture,
  Vector3,
} from "three";

import { useDisposable } from "@/hooks";
import type { MapBounds, MaterialPreview, MaterialProgram } from "@/lib/tauri";

import { type MapChannel, type MapGeometry, MESH_FLAG } from "../../assets/parsing/mapBuffer";
import { type MapVisibility, meshVisible } from "../../assets/utils/mapVisibility";
import { applyBinding, lit } from "../../character/utils/submeshBinding";
import {
  EngineEnvironment,
  type MeshLight,
  type MeshLights,
} from "../../hexshade/engineEnvironment";
import { bindProgramTextures, createProgramMaterial } from "../../hexshade/programMaterial";
import { programWith } from "../../hexshade/programTextures";
import { recompileIfMoved, type SubmeshMaterial } from "../../shared/utils/renderState";
import { createRetainedCache, useRetained } from "../../shared/utils/retainedCache";
import { AXIS_SIGN, STAGE_ORDER } from "../../shared/utils/space";
import { useConformanceUniforms } from "../hooks/useConformanceUniforms";
import { useNavHeights } from "../hooks/useNavHeights";
import { createMapGeometry } from "../utils/backdropGeometry";
import {
  type DrawGroup,
  type MeshDrag,
  type MeshRun,
  runsInView,
  splitRuns,
  surfaceBlendTier,
  writeGroups,
} from "../utils/backdropRuns";
import { type ConformanceGround, createConformanceMaterial } from "../utils/conformanceSurface";
import { createEdgeGeometry, edgeIndexOf, writeEdgeGroups } from "../utils/edgeGeometry";
import { type GrassTextures, grassTextureFor } from "../utils/grassTint";
import type { NavProjection } from "../utils/navProjection";
import { KEEPS_GROUP_ORDER } from "../utils/sharedRenderer";
import type { SunLight } from "../utils/sunLight";
import {
  createEdgeMaterial,
  type Edges,
  drawsSolids,
  surfaceOf,
  type ViewMode,
} from "../utils/viewMode";
import { DraggedMeshes } from "./DraggedMeshes";
import { NavProjectionMesh } from "./NavProjectionMesh";

/** A flat neutral the map's own shape reads against, where no material reaches it. */
const STONE = 0x9a958c;

/**
 * A shader that marks a place rather than covering one.
 *
 * `Indicator_Faelights` names no albedo and tints itself cyan, and the game draws no
 * solid surface for it, so a backdrop that drew it would paint the river.
 */
const INDICATOR_SHADER = /indicator/i;

const NO_TEXTURES: ReadonlyMap<string, Texture> = new Map();

/** The [`Surfaces.ofSubmesh`] value of a submesh that draws nothing. */
const NO_SURFACE = -1;

/* The buffers are 73 MiB on Summoner's Rift, so a viewport opening on a map another has
   drawn draws the buffers that one uploaded rather than uploading them again. */
const GEOMETRIES = createRetainedCache<MapGeometry, BufferGeometry>((geometry) =>
  geometry.dispose(),
);

/** One material of the array, and what it has to be rebound to when its texture lands. */
interface Bound {
  readonly material: SubmeshMaterial | RawShaderMaterial;
  /** The material's own entry path, which its texture is held under. */
  readonly path: string;
  readonly slots: MaterialPreview | null;
  /** The translated program the material draws under, and null for a stock one. */
  readonly program: MaterialProgram | null;
  /** The mesh's own `disable_backface_culling`, which outranks the material's state. */
  readonly doubleSided: boolean;
}

/** The materials of every submesh of the map, drawn or not. */
interface Surfaces {
  readonly bound: readonly Bound[];
  /** The index into `bound` for each submesh of the map. -1 if the submesh draws nothing. */
  readonly ofSubmesh: Int32Array;
}

/** The meshes that the active visibility draws, each with its draw groups and its bounds. */
interface Drawn {
  readonly runs: readonly MeshRun[];
  /** The mesh each group draws, by the group's first index. */
  readonly meshOf: ReadonlyMap<number, number>;
}

/** The groups that one backdrop last wrote into its geometry, and the view it wrote them for. */
interface Written {
  /** The runs that the last write culled and ordered. */
  fixed: readonly MeshRun[] | null;
  /** The clip transform of the geometry at the last write. */
  readonly projection: Matrix4;
  /** The value of the geometry's `userData.written` after the last write. */
  token: object | null;
  /** The runs in view at the last write, reused as the output of the next. */
  readonly runs: MeshRun[];
  /** The edge geometry that the last write reached, and null for none. */
  edges: BufferGeometry | null;
}

/** The attributes the map's line segments read. */
const EDGE_ATTRIBUTES = ["position"];

/**
 * How far past its bounds a mesh is still drawn, in engine units.
 *
 * A vertex shader that sways foliage moves vertices outside the bounds of the mesh.
 */
const CULL_MARGIN = 150;

/** The flag under which the renderer keeps the order of the groups this component writes. */
const ORDERED = { [KEEPS_GROUP_ORDER]: true };

const PROJECTION = new Matrix4();
const INVERSE = new Matrix4();
const NO_DELTA = new Matrix4();
const SEEN = new Frustum();
const EYE = new Vector3();

/** Whether a submesh drawing `slots` covers anything at all. */
function covers(slots: MaterialPreview | null | undefined): boolean {
  if (slots == null) return true;
  return slots.base !== null || !INDICATOR_SHADER.test(slots.shader ?? "");
}

/**
 * The game's own map, drawn behind whatever the scene draws.
 *
 * One `BufferGeometry` for the whole map and one group per submesh, per ADR-0044. A
 * group points at the material its submesh names, doubled where a mesh disables backface
 * culling, since a material is shared between flagged and unflagged meshes. A material
 * with a translated program draws under it, the stock one standing in where none did.
 * The edges of a wireframe mode are line segments that follow the same groups, and so does
 * the navgrid projection, a second draw of the geometry that tints it from above. During a
 * `drag` the groups leave out the dragged meshes, which `DraggedMeshes` draws at the drag's
 * transform, so the projection skips them until the drag lands.
 */
export function Backdrop({
  map,
  materials: slots,
  textures,
  programs = [],
  programTextures = NO_TEXTURES,
  lightmaps = NO_TEXTURES,
  light,
  grassTint = null,
  bounds = null,
  visibility,
  viewMode = "lit",
  edges = "none",
  edgeColour,
  conformance = null,
  navProjection = null,
  drag = null,
}: {
  readonly map: MapGeometry;
  readonly materials: readonly (MaterialPreview | null)[];
  readonly textures: ReadonlyMap<string, Texture>;
  /** One per entry of `materials`, and none while the shaders are off. */
  readonly programs?: readonly (MaterialProgram | null)[];
  /** The textures the programs sample, keyed as `programWith` reads them. */
  readonly programTextures?: ReadonlyMap<string, Texture>;
  /** The light maps the meshes name, by path. */
  readonly lightmaps?: ReadonlyMap<string, Texture>;
  /** The sun the programs light by. */
  readonly light: SunLight;
  /** The grass tints that the brush programs multiply by, picked by the active flags. */
  readonly grassTint?: GrassTextures | null;
  /** The rectangle that `TERRAIN_XFORM` maps a map-wide texture onto. */
  readonly bounds?: MapBounds | null;
  /** The active flags and controller states that select the drawn meshes. */
  readonly visibility: MapVisibility;
  readonly viewMode?: ViewMode;
  readonly edges?: Edges;
  /** What the triangle edges draw in, where any draw. */
  readonly edgeColour: Color;
  /** The navigation grid that the `conformance` surface measures the ground against. */
  readonly conformance?: ConformanceGround | null;
  /** The navigation grid cells that tint the drawn surfaces from above, and null for none. */
  readonly navProjection?: NavProjection | null;
  /** The meshes that a gizmo drag moves, and null outside a drag. */
  readonly drag?: MeshDrag | null;
}) {
  const clock = useThree((state) => state.clock);
  const held = useRef<Mesh>(null);
  const geometry = useRetained(GEOMETRIES, map, () => createMapGeometry(map));

  const colors = useMemo(() => ({ untextured: new Color(STONE), errored: new Color(STONE) }), []);
  const environment = useDisposable(() => new EngineEnvironment(), []);
  useEffect(() => {
    environment.light = light;
    environment.grassTint =
      grassTint === null ? null : grassTextureFor(grassTint, visibility.flags);
    environment.terrain = bounds;
  }, [environment, light, grassTint, visibility.flags, bounds]);

  const surface = surfaceOf(viewMode);

  const heights = useNavHeights(conformance?.grid ?? navProjection?.grid ?? null);
  const conformanceUniforms = useConformanceUniforms(conformance, heights);

  /* Built without the textures, which arrive over seconds. A material's class and a
     group's material index are fixed by the map, so a texture landing rebinds one
     material rather than rebuilding the array and re-walking 600 groups.

     Built for every submesh and not only the drawn ones. A visibility change then
     rewrites the groups and keeps the materials. Rebuilding the materials disposes the
     old ones, which deletes their shader programs and compiles every program again. */
  const surfaces = useMemo<Surfaces>(() => {
    const bound: Bound[] = [];
    const ofSubmesh = new Int32Array(map.submeshes.length).fill(NO_SURFACE);
    const byKey = new Map<string, number>();

    const indexOf = (material: number, doubleSided: boolean): number => {
      const key = `${material}:${doubleSided}`;
      const held = byKey.get(key);
      if (held !== undefined) return held;

      const named =
        surface === "untextured" || surface === "conformance" ? null : (slots[material] ?? null);
      const translated = surface === "material" ? (programs[material] ?? null) : null;
      const program = programWith(translated, NO_TEXTURES);
      const drawnWith: Bound["material"] =
        program !== null
          ? createProgramMaterial(program, environment)
          : surface === "conformance"
            ? createConformanceMaterial(conformanceUniforms)
            : surface !== "unlit" &&
                lit({ material: named, base: null, texture: null, pbr: null, emissive: null })
              ? new MeshLambertMaterial()
              : new MeshBasicMaterial();
      bound.push({
        material: drawnWith,
        path: map.materials[material] ?? "",
        slots: named,
        program: program === null ? null : translated,
        doubleSided,
      });
      byKey.set(key, bound.length - 1);
      return bound.length - 1;
    };

    for (const mesh of map.meshes) {
      const doubleSided = (mesh.flags & MESH_FLAG.cullDisabled) !== 0;
      for (let at = 0; at < mesh.submeshCount; at += 1) {
        const submesh = map.submeshes[mesh.firstSubmesh + at];
        if (submesh === undefined || !covers(slots[submesh.material])) continue;
        ofSubmesh[mesh.firstSubmesh + at] = indexOf(submesh.material, doubleSided);
      }
    }
    return { bound, ofSubmesh };
  }, [map, slots, programs, environment, surface, conformanceUniforms]);

  const drawn = useMemo<Drawn>(() => {
    const runs: MeshRun[] = [];
    const meshOf = new Map<number, number>();

    for (const [index, mesh] of map.meshes.entries()) {
      if (!meshVisible(visibility, mesh.visibility, mesh.controller)) continue;
      if (visibility.hiddenMeshes?.has(index) === true) continue;

      const groups: DrawGroup[] = [];
      for (let at = 0; at < mesh.submeshCount; at += 1) {
        const submesh = map.submeshes[mesh.firstSubmesh + at];
        const material = surfaces.ofSubmesh[mesh.firstSubmesh + at] ?? NO_SURFACE;
        if (submesh === undefined || material === NO_SURFACE) continue;

        groups.push({
          startIndex: submesh.startIndex,
          indexCount: submesh.indexCount,
          material,
        });
        meshOf.set(submesh.startIndex, index);
      }
      if (groups.length === 0) continue;

      const box = new Box3(new Vector3(...mesh.min), new Vector3(...mesh.max));
      runs.push({ mesh: index, box: box.expandByScalar(CULL_MARGIN), groups, depth: 0 });
    }
    return { runs, meshOf };
  }, [map, surfaces, visibility]);

  /* A drag of another buffer, such as the one that a committed move replaces, moves nothing. */
  const dragged = drag !== null && drag.map === map ? drag : null;
  const draggedMeshes = dragged?.meshes ?? null;
  const split = useMemo(() => splitRuns(drawn.runs, draggedMeshes), [drawn, draggedMeshes]);

  /* The light maps of each mesh, looked up per draw by the group's first index. */
  const lightsOf = useMemo(() => {
    const lightOf = (channel: MapChannel | null): MeshLight | null =>
      channel === null
        ? null
        : {
            texture: lightmaps.get(channel.texture) ?? null,
            scale: channel.scale,
            bias: channel.bias,
          };
    const lights = new Map<number, MeshLights>();
    for (const [start, at] of drawn.meshOf) {
      const mesh = map.meshes[at];
      if (mesh === undefined) continue;
      lights.set(start, {
        baked: lightOf(mesh.bakedLight),
        stationary: lightOf(mesh.stationaryLight),
      });
    }
    return lights;
  }, [drawn, map, lightmaps]);

  const bound = surfaces.bound;
  const materials = useMemo<Material[]>(() => bound.map((entry) => entry.material), [bound]);
  const tiers = useMemo(() => bound.map(surfaceBlendTier), [bound]);

  const drawsEdges = edges !== "none";
  const edgeIndex = useMemo(
    () =>
      drawsEdges
        ? edgeIndexOf(
            map.indices,
            map.positions,
            /* Every submesh, so a visibility change finds its edges written. */
            map.submeshes,
          )
        : null,
    [drawsEdges, map],
  );
  const edgeGeometry = useDisposable(
    () => (edgeIndex === null ? null : createEdgeGeometry(geometry, edgeIndex, EDGE_ATTRIBUTES)),
    [edgeIndex, geometry],
  );
  const edgeMaterial = useDisposable(
    () =>
      edges === "none" || edgeIndex === null
        ? null
        : createEdgeMaterial(edgeColour, edges, edgeIndex.spacing),
    [edges, edgeColour, edgeIndex],
  );
  /* One entry per material, so the edges draw the same groups the surfaces do. */
  const edgeMaterials = useMemo(
    () => (edgeMaterial === null ? null : bound.map(() => edgeMaterial)),
    [edgeMaterial, bound],
  );

  /* A translated program reads the frame's time, so a map drawn with one changes every frame. */
  const animated = useMemo(() => bound.some((entry) => entry.program !== null), [bound]);
  const written = useRef<Written>({
    fixed: null,
    projection: new Matrix4(),
    token: null,
    runs: [],
    edges: null,
  });

  /* The groups are the meshes in view, nearest first, so they are written again when the
     camera or the visibility changes. Another viewport of the same map shares the geometry
     and may have written its own groups, which the token shows. Written in the frame
     rather than in an effect, because a render the fibre throws away would leave the
     geometry pointing into a material array the mesh never took. */
  useFrame(({ camera, invalidate }) => {
    const mesh = held.current;
    if (mesh === null) return;

    /* The controls moved the camera earlier in this frame, and ThreeJS updates its
       matrices only as it renders. */
    camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    PROJECTION.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(
      mesh.matrixWorld,
    );

    const last = written.current;
    const stale =
      last.fixed !== split.fixed ||
      last.edges !== edgeGeometry ||
      last.token !== geometry.userData.written ||
      !last.projection.equals(PROJECTION);
    if (stale) {
      SEEN.setFromProjectionMatrix(PROJECTION);
      EYE.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(
        INVERSE.copy(mesh.matrixWorld).invert(),
      );
      writeGroups(geometry, runsInView(split.fixed, SEEN, EYE, last.runs), tiers);
      if (edgeGeometry !== null && edgeIndex !== null) {
        writeEdgeGroups(edgeGeometry, geometry.groups, edgeIndex.ranges);
      }

      last.edges = edgeGeometry;
      last.fixed = split.fixed;
      last.projection.copy(PROJECTION);
      last.token = geometry.userData.written as object;
    }

    if (animated) invalidate();
  });

  /* What each material was last bound to, so a wave of arrivals rebinds the few that
     moved rather than all 183 once a frame. Indexed by `bound`, because two entries of
     it share one entry path where a mesh disables culling. */
  const applied = useRef<(Texture | null)[]>([]);
  useEffect(() => {
    applied.current = [];
  }, [bound, colors]);

  /* The mesh's own cull flag wins over the material's `cullEnable`, which the render-flag
     remap favours, so it is written back over what the binding put there. */
  useEffect(() => {
    for (const [at, entry] of bound.entries()) {
      if (isProgram(entry.material)) continue;
      const base = textures.get(entry.path) ?? null;
      if (applied.current[at] === base) continue;
      applied.current[at] = base;
      applyBinding(
        entry.material,
        {
          material: entry.slots,
          base,
          texture: null,
          pbr: null,
          emissive: null,
        },
        colors,
      );
      if (entry.doubleSided && entry.material.side !== DoubleSide) {
        entry.material.side = DoubleSide;
        recompileIfMoved(entry.material);
      }
    }
  }, [bound, textures, colors]);

  /* A program's textures are few, so every one is rebound on each wave. */
  useEffect(() => {
    for (const entry of bound) {
      if (!isProgram(entry.material)) continue;
      const program = programWith(entry.program, programTextures);
      if (program !== null) bindProgramTextures(entry.material, program);
      if (entry.doubleSided) entry.material.side = DoubleSide;
    }
  }, [bound, programTextures]);

  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);

  return (
    <group scale={[AXIS_SIGN[0], AXIS_SIGN[1], AXIS_SIGN[2]]}>
      {/* Nothing rewinds triangles. The mirror above gives the world matrix a negative
          determinant, which ThreeJS already reads to flip its front face. */}
      <mesh
        geometry={geometry}
        material={materials}
        visible={drawsSolids(viewMode)}
        renderOrder={STAGE_ORDER}
        /* The groups are culled per map mesh in the frame, so the whole is never culled. */
        frustumCulled={false}
        userData={ORDERED}
        onBeforeRender={(renderer, _scene, camera, _geometry, material, group) => {
          if (held.current !== null) {
            environment.write(renderer, camera, held.current, clock.elapsedTime);
          }
          /* Typed as an object, and at run time the geometry group of the draw. */
          const { start } = group as unknown as { start: number };
          environment.draw(material, lightsOf.get(start) ?? null);
        }}
        ref={held}
      />
      <DraggedMeshes
        geometry={geometry}
        runs={split.dragged}
        delta={dragged?.delta ?? NO_DELTA}
        surfaces={bound}
        tiers={tiers}
        surface={surface}
        programTextures={programTextures}
        lights={lightsOf}
        environment={environment}
        solids={drawsSolids(viewMode)}
        edgeGeometry={edgeGeometry}
        edgeIndex={edgeIndex}
        edgeMaterials={edgeMaterials}
      />
      <NavProjectionMesh
        geometry={geometry}
        surfaces={bound}
        textures={textures}
        projection={navProjection}
        heights={heights}
        viewMode={viewMode}
      />
      {edgeMaterials !== null && edgeGeometry !== null && (
        <lineSegments
          geometry={edgeGeometry}
          material={edgeMaterials}
          renderOrder={STAGE_ORDER}
          frustumCulled={false}
        />
      )}
    </group>
  );
}

function isProgram(material: Bound["material"]): material is RawShaderMaterial {
  return (material as RawShaderMaterial).isRawShaderMaterial === true;
}
