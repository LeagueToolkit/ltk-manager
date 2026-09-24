import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  IntType,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type RawShaderMaterial,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  type Texture,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
} from "three";

import { LOCAL_FLOATS, type Pose } from "../../animation/evaluation/pose";
import type { SceneClock } from "../../animation/state/clock";
import { drawnRanges, type MeshGeometry, type MeshRange } from "../../assets/parsing/meshBuffer";
import type { SkeletonModel } from "../../assets/parsing/skeletonBuffer";
import { EngineEnvironment } from "../../hexshade/engineEnvironment";
import type { SubmeshProgram } from "../../hexshade/programMaterial";
import { type HeldValue, ProgramMaterials } from "../../hexshade/programMaterials";
import { useCharacterLight } from "../../scene/state/characterLightContext";
import { useViewMode } from "../../scene/state/viewModeContext";
import { drawsSolids, type Surface, surfaceOf } from "../../scene/utils/viewMode";
import { AXIS_SIGN } from "../../scene/utils/world";
import { useEdgeTwin } from "../hooks/useEdgeTwin";
import { type CharacterSkin, CharacterSkinContext } from "../state/characterSkin";
import { tintFloats, vertexTints } from "../utils/jointTint";
import { gridLitMaterial, lightFrom, lightGridUniforms } from "../utils/lightGridShading";
import {
  type FallbackColors,
  applyBinding,
  lit,
  type SubmeshBinding,
  type SubmeshMaterial,
} from "../utils/submeshBinding";
import { scrollAt } from "../utils/uvScroll";

export interface CharacterProps {
  readonly mesh: MeshGeometry;
  readonly pose: Pose;
  /** The time the pose is sampled at, which whoever owns the scene advances. */
  readonly clock: SceneClock;
  /** What a submesh draws with, by its name. */
  readonly bindingOf: (submesh: string) => SubmeshBinding;
  /**
   * The game's own shader a submesh draws with, by its name, and null to draw it with
   * the stock material `bindingOf` names.
   */
  readonly programOf?: (submesh: string) => SubmeshProgram | null;
  /** A value a material's control holds, drawn in place of its program's own until let go. */
  readonly held?: HeldValue | null;
  /** What a submesh no texture or no material reaches is drawn in. */
  readonly colors: FallbackColors;
  /** The submeshes the character is drawn without, matched without regard to case. */
  readonly hidden: readonly string[];
  /** `skinScale`, which the whole character is drawn at. */
  readonly scale: number;
  /** `selfIllumination`, added to the character's ambient light. */
  readonly selfIllumination?: number;
  /** The submesh drawn at full strength while every other one dims, and null to dim none. */
  readonly highlighted?: string | null;
  /** A mask's weight per joint slot, which dims every vertex it does not weigh, and null to dim none. */
  readonly jointWeights?: ArrayLike<number> | null;
  /** A click on the viewport, with the submesh it landed on and null where it missed them all. */
  readonly onSubmeshPick?: (submesh: string | null) => void;
  /** What the character wears, which reaches its skin through `useCharacterSkin`. */
  readonly children?: ReactNode;
}

/** How much of its colour a submesh keeps while another one is highlighted. */
const DIMMED = 0.3;

/** What a submesh binds to without its textures: the flat untextured colour, lit. */
const UNTEXTURED: SubmeshBinding = { material: null, base: null, texture: null };

/** What a hidden submesh drawn by a translated program binds to, which draws nothing. */
const HIDDEN = new MeshBasicMaterial({ visible: false });

/** How far a press may travel, in pixels, and still read as a click rather than a camera drag. */
const CLICK_SLOP = 4;

/** Each input a translated vertex shader declares, and the stock attribute it is. */
const PROGRAM_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["a_POSITION", "position"],
  ["a_NORMAL", "normal"],
  ["a_TEXCOORD", "uv"],
  ["a_BLENDWEIGHT", "skinWeight"],
  ["a_COLOR", "color"],
];

/**
 * One skinned mesh on its skeleton, posed at the clock's time.
 *
 * The bones stand in the skeleton's influence order, so a vertex's skin index names its
 * bone as the `.skn` wrote it and no index is rewritten (ADR-0035). The files hold the
 * engine's space, as a particle pool does, so the character crosses the mirrored axis of
 * world.ts as the pool's particles do.
 */
export function Character({
  mesh,
  pose,
  clock,
  bindingOf,
  programOf,
  held = null,
  colors,
  hidden,
  scale,
  selfIllumination = 0,
  highlighted = null,
  jointWeights = null,
  onSubmeshPick,
  children,
}: CharacterProps) {
  const { skeleton, parents } = pose;
  const rig = useMemo(() => buildRig(skeleton, parents), [skeleton, parents]);
  const drawn = useMemo(() => buildGeometry(mesh, rig), [mesh, rig]);
  const skin = useMemo<CharacterSkin>(
    () => ({ geometry: drawn.geometry, skeleton: rig.skeleton, ranges: drawn.ranges, hidden }),
    [drawn, rig, hidden],
  );
  const ambient = useMemo(() => lightGridUniforms(), []);
  const shaded = useMemo<readonly ShadingModels[]>(
    () =>
      drawn.ranges.map(() => ({
        lit: gridLitMaterial(ambient),
        unlit: new MeshBasicMaterial({ side: DoubleSide, vertexColors: true }),
      })),
    [drawn, ambient],
  );
  /* A map scene draws dozens of characters. */
  const environment = useMemo(() => new EngineEnvironment("uniform"), []);
  const { grid: lightGrid, sun } = useCharacterLight();
  useLayoutEffect(() => {
    environment.grid = lightGrid;
    environment.light = sun;
    environment.selfIllumination = selfIllumination;
    ambient.selfIllumination.value = selfIllumination;
  }, [environment, ambient, lightGrid, sun, selfIllumination]);
  const view = useViewMode();
  const surface = surfaceOf(view.mode);
  const skinned = useMemo(() => {
    const bound: Material[] = shaded.map((models) => models.lit);
    const made = new SkinnedMesh(drawn.geometry, bound);
    /* The bounds are the bind pose's, which an animated pose leaves. */
    made.frustumCulled = false;
    /* An identity bind keeps the inverse bind matrices the skeleton carries, where no
       matrix at all would have three compute its own from the pose it stands in. */
    made.bind(rig.skeleton, new Matrix4());
    made.onBeforeRender = (renderer, _scene, camera, _geometry, material) => {
      environment.write(renderer, camera, made, clock.time);
      environment.draw(material);
    };
    return made;
  }, [drawn, shaded, rig, environment, clock]);

  /* The bones move onto the mesh here rather than in its memo, because a memo React runs
     twice would move them onto the copy it throws away. */
  useLayoutEffect(() => {
    skinned.add(...rig.roots);
    return () => {
      skinned.remove(...rig.roots);
    };
  }, [skinned, rig]);

  const scrolling = useRef<readonly Scrolling[]>([]);
  const programs = useMemo(() => new ProgramMaterials(environment), [environment]);
  useLayoutEffect(() => programs.hold(held), [programs, held]);
  useLayoutEffect(() => {
    scrolling.current = bind(skinned, shaded, drawn.ranges, {
      bindingOf,
      programOf,
      programs,
      colors,
      hidden,
      highlighted,
      surface,
    });
  }, [
    skinned,
    shaded,
    drawn,
    bindingOf,
    programOf,
    programs,
    colors,
    hidden,
    highlighted,
    surface,
  ]);
  useLayoutEffect(() => {
    skinned.visible = drawsSolids(view.mode);
  }, [skinned, view.mode]);
  const edges = useEdgeTwin(
    skinned,
    rig.skeleton,
    drawn.ranges,
    hidden,
    view.edges,
    view.edgeColour,
  );
  useSubmeshPick(skinned, drawn.ranges, hidden, onSubmeshPick);

  useLayoutEffect(() => {
    const color = drawn.geometry.getAttribute("color");
    vertexTints(
      drawn.geometry.getAttribute("skinIndex").array,
      drawn.geometry.getAttribute("skinWeight").array,
      skeleton.influences,
      jointWeights,
      color.array as Float32Array,
    );
    color.needsUpdate = true;
  }, [drawn, skeleton, jointWeights]);

  useEffect(() => () => drawn.geometry.dispose(), [drawn]);
  useEffect(
    () => () => {
      for (const models of shaded) {
        models.lit.dispose();
        models.unlit.dispose();
      }
    },
    [shaded],
  );
  useEffect(() => () => rig.skeleton.dispose(), [rig]);
  useEffect(
    () => () => {
      programs.dispose();
      environment.dispose();
    },
    [programs, environment],
  );

  const locals = useMemo(() => new Float32Array(rig.bones.length * LOCAL_FLOATS), [rig]);
  const centre = useMemo(() => new Vector3(), []);
  useFrame(() => {
    /* The game lights a character by the cell under the centre of its bounds. */
    centre.copy(drawn.centre).applyMatrix4(skinned.matrixWorld);
    lightFrom(lightGrid, centre.x, centre.z, ambient);
    pose.localsInto(clock.time, locals);
    rig.bones.forEach((bone, slot) => {
      const at = slot * LOCAL_FLOATS;
      bone.position.fromArray(locals, at);
      bone.quaternion.fromArray(locals, at + 3);
      bone.scale.fromArray(locals, at + 7);
    });
    /* Read off the clock rather than summed over the frames: the texture is the one every
       placement of this skin draws, so a sum advances it once per placement (ADR-0035). */
    for (const { map, scroll } of scrolling.current) {
      map.offset.set(scrollAt(scroll[0], clock.time), scrollAt(scroll[1], clock.time));
    }
  });

  return (
    <>
      <primitive
        object={skinned}
        scale={[AXIS_SIGN[0] * scale, AXIS_SIGN[1] * scale, AXIS_SIGN[2] * scale]}
      />
      {edges !== null && (
        <primitive
          object={edges}
          scale={[AXIS_SIGN[0] * scale, AXIS_SIGN[1] * scale, AXIS_SIGN[2] * scale]}
        />
      )}
      <CharacterSkinContext value={skin}>{children}</CharacterSkinContext>
    </>
  );
}

/** Every joint as a bone under its parent, and the skeleton the skin binds to. */
interface Rig {
  readonly bones: readonly Bone[];
  readonly roots: readonly Bone[];
  readonly skeleton: Skeleton;
}

function buildRig(skeleton: SkeletonModel, parents: Int32Array): Rig {
  const { joints, influences } = skeleton;
  const bones = joints.map((joint) => {
    const bone = new Bone();
    bone.name = joint.name;
    bone.position.fromArray(joint.translation);
    bone.quaternion.fromArray(joint.rotation);
    bone.scale.fromArray(joint.scale);
    return bone;
  });

  const roots: Bone[] = [];
  parents.forEach((parent, slot) => {
    if (parent < 0) roots.push(bones[slot]);
    else bones[parent].add(bones[slot]);
  });

  const bound = new Skeleton(
    Array.from(influences, (slot) => bones[slot]),
    Array.from(influences, (slot) => new Matrix4().fromArray(joints[slot].inverseBind)),
  );
  return { bones, roots, skeleton: bound };
}

/** What a submesh's material is bound from. */
interface Bind {
  readonly bindingOf: (submesh: string) => SubmeshBinding;
  readonly programOf: ((submesh: string) => SubmeshProgram | null) | undefined;
  /** The program materials made so far, one per material and permutation. */
  readonly programs: ProgramMaterials;
  readonly colors: FallbackColors;
  readonly hidden: readonly string[];
  readonly highlighted: string | null;
  /** What every submesh draws with, and a program only under `material`. */
  readonly surface: Surface;
}

/** One material per shading model a submesh may draw under, kept for its lifetime. */
interface ShadingModels {
  readonly lit: MeshLambertMaterial;
  readonly unlit: MeshBasicMaterial;
}

/** A map the frame advances, in tiles per second. */
interface Scrolling {
  readonly map: Texture;
  readonly scroll: readonly [number, number];
}

/**
 * Each submesh bound to its material under the shading model the binding calls for, and
 * to none where the skin hides it. Every submesh but a highlighted one dims. Answers the
 * maps that scroll.
 *
 * A submesh with a translated program draws under it instead, one material per program
 * for the program's life, with whatever textures have arrived bound on every pass here.
 * A program material neither dims nor scrolls, since the shader owns its colour.
 */
function bind(
  skinned: SkinnedMesh,
  shaded: readonly ShadingModels[],
  ranges: readonly MeshRange[],
  { bindingOf, programOf, programs, colors, hidden, highlighted, surface }: Bind,
): readonly Scrolling[] {
  const skip = new Set(hidden.map((name) => name.toLowerCase()));
  const picked = highlighted?.toLowerCase() ?? null;
  const scrolling: Scrolling[] = [];
  const bound = skinned.material as Material[];
  const used = new Set<RawShaderMaterial>();
  ranges.forEach((range, at) => {
    const program = surface === "material" ? (programOf?.(range.name) ?? null) : null;
    if (program !== null) {
      const material = programs.acquire(program);
      used.add(material);
      /* Every submesh of one material shares its program material, so a hidden one swaps
         in a material of its own rather than hiding the rest. */
      bound[at] = skip.has(range.name.toLowerCase()) ? HIDDEN : material;
      return;
    }
    const binding = surface === "untextured" ? UNTEXTURED : bindingOf(range.name);
    const material: SubmeshMaterial =
      surface !== "unlit" && lit(binding) ? shaded[at].lit : shaded[at].unlit;
    bound[at] = material;
    material.visible = !skip.has(range.name.toLowerCase());
    const scroll = applyBinding(material, binding, colors);
    if (scroll !== null && material.map !== null) scrolling.push({ map: material.map, scroll });
    if (picked !== null && range.name.toLowerCase() !== picked) {
      material.color.multiplyScalar(DIMMED);
    }
  });
  programs.retain(used);
  return scrolling;
}

/**
 * Report which submesh a click on the canvas lands on.
 *
 * The ray is cast on the click alone rather than through the renderer's pointer events,
 * which would skin every vertex of the character on each move of the pointer.
 */
function useSubmeshPick(
  target: SkinnedMesh,
  ranges: readonly MeshRange[],
  hidden: readonly string[],
  onPick: ((submesh: string | null) => void) | undefined,
): void {
  /* The element the fibre listens on, since a shared renderer's canvas is drawn into by
     every viewport sharing it. */
  const element = useThree(
    (state) => (state.events.connected as HTMLElement | undefined) ?? state.gl.domElement,
  );
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (onPick === undefined) return;
    const skip = new Set(hidden.map((name) => name.toLowerCase()));
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let pressed: { x: number; y: number } | null = null;

    const press = (event: PointerEvent) => {
      pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const release = (event: PointerEvent) => {
      if (pressed === null) return;
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      pressed = null;
      if (moved > CLICK_SLOP) return;

      const box = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        -((event.clientY - box.top) / box.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(target, false).find((each) => {
        const range = ranges[each.face?.materialIndex ?? -1];
        return range !== undefined && !skip.has(range.name.toLowerCase());
      });
      onPick(hit === undefined ? null : (ranges[hit.face?.materialIndex ?? -1]?.name ?? null));
    };

    element.addEventListener("pointerdown", press);
    element.addEventListener("pointerup", release);
    return () => {
      element.removeEventListener("pointerdown", press);
      element.removeEventListener("pointerup", release);
    };
  }, [element, camera, target, ranges, hidden, onPick]);
}

/**
 * The mesh's buffers, with one draw group per submesh.
 *
 * A hidden submesh keeps its group, so an attached mesh sharing the geometry can draw one
 * the character is drawn without.
 */
interface Drawn {
  readonly geometry: BufferGeometry;
  readonly ranges: readonly MeshRange[];
  /** The middle of the bind pose's bounds, in the mesh's own space. */
  readonly centre: Vector3;
}

function buildGeometry(mesh: MeshGeometry, rig: Rig): Drawn {
  const geometry = new BufferGeometry();
  const vertices = mesh.positions.length / 3;
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  if (mesh.uvs !== null) geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  if (mesh.normals !== null) geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  /* A lit material with no normals draws black, so a mesh without them gets flat ones. */
  else geometry.computeVertexNormals();
  const joints = skinIndices(mesh, rig);
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute(
    "skinWeight",
    new BufferAttribute(mesh.skinWeights ?? boundToFirst(vertices), 4),
  );
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  /* Full colour until a mask weighs the joints, which the character's effect writes. */
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Float32Array(tintFloats(vertices)).fill(1), 3),
  );
  nameForPrograms(geometry, joints);

  const ranges = drawnRanges(mesh, []);
  ranges.forEach((range, at) => geometry.addGroup(range.startIndex, range.indexCount, at));

  geometry.computeBoundingBox();
  const centre = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();

  return { geometry, ranges, centre };
}

/**
 * The same buffers under the names a translated vertex shader declares its inputs by,
 * `a_` and the D3D semantic, so a program material binds them without a copy.
 *
 * `BLENDINDICES` is a `uvec4` input, which three feeds through an integer pointer only
 * from an attribute typed so, and the stock skinning reads the same joints as floats,
 * so the joints alone are a second attribute over the same array.
 */
function nameForPrograms(geometry: BufferGeometry, joints: Uint16Array): void {
  for (const [name, of] of PROGRAM_ATTRIBUTES) {
    const attribute = geometry.getAttribute(of);
    if (attribute !== undefined) geometry.setAttribute(name, attribute);
  }
  const indices = new Uint16BufferAttribute(joints, 4);
  indices.gpuType = IntType;
  geometry.setAttribute("a_BLENDINDICES", indices);
}

/**
 * Each vertex's shader joints, with any past the skeleton's influences on the first.
 *
 * A skin index past the table reads a bone texture row nothing wrote.
 */
function skinIndices(mesh: MeshGeometry, rig: Rig): Uint16Array {
  const count = rig.skeleton.bones.length;
  const held = new Uint16Array(mesh.skinIndices ?? new Uint8Array((mesh.positions.length / 3) * 4));
  for (let at = 0; at < held.length; at += 1) {
    if (held[at] >= count) held[at] = 0;
  }
  return held;
}

/** Weights binding every vertex wholly to its first shader joint. */
function boundToFirst(vertices: number): Float32Array {
  const weights = new Float32Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex += 1) weights[vertex * 4] = 1;
  return weights;
}
