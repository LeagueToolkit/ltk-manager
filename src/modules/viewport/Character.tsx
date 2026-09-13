import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  type Texture,
  Uint16BufferAttribute,
  Vector2,
} from "three";

import { type CharacterSkin, CharacterSkinContext } from "./characterSkin";
import type { SceneClock } from "./clock";
import { drawnRanges, type MeshGeometry, type MeshRange } from "./meshBuffer";
import { LOCAL_FLOATS, type Pose } from "./pose";
import type { SkeletonModel } from "./skeletonBuffer";
import { type DressColors, dressMaterial, type SubmeshDress } from "./submeshDress";
import { AXIS_SIGN } from "./world";

export interface CharacterProps {
  readonly mesh: MeshGeometry;
  readonly pose: Pose;
  /** The time the pose is sampled at, which whoever owns the scene advances. */
  readonly clock: SceneClock;
  /** What a submesh draws with, by its name. */
  readonly dressOf: (submesh: string) => SubmeshDress;
  /** What a submesh no texture or no material reaches is drawn in. */
  readonly colors: DressColors;
  /** The submeshes the character is drawn without, matched without regard to case. */
  readonly hidden: readonly string[];
  /** `skinScale`, which the whole character is drawn at. */
  readonly scale: number;
  /** The submesh drawn at full strength while every other one dims, and null to dim none. */
  readonly highlighted?: string | null;
  /** A click on the viewport, with the submesh it landed on and null where it missed them all. */
  readonly onSubmeshPick?: (submesh: string | null) => void;
  /** What the character wears, which reaches its skin through `useCharacterSkin`. */
  readonly children?: ReactNode;
}

/** How much of its colour a submesh keeps while another one is highlighted. */
const DIMMED = 0.3;

/** How far a press may travel, in pixels, and still read as a click rather than a camera drag. */
const CLICK_SLOP = 4;

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
  dressOf,
  colors,
  hidden,
  scale,
  highlighted = null,
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
  const materials = useMemo(
    () => drawn.ranges.map(() => new MeshBasicMaterial({ side: DoubleSide })),
    [drawn],
  );
  const skinned = useMemo(() => {
    const held = new SkinnedMesh(drawn.geometry, materials);
    /* The bounds are the bind pose's, which an animated pose leaves. */
    held.frustumCulled = false;
    /* An identity bind keeps the inverse bind matrices the skeleton carries, where no
       matrix at all would have three compute its own from the pose it stands in. */
    held.bind(rig.skeleton, new Matrix4());
    return held;
  }, [drawn, materials, rig]);

  /* The bones move onto the mesh here rather than in its memo, because a memo React runs
     twice would move them onto the copy it throws away. */
  useLayoutEffect(() => {
    skinned.add(...rig.roots);
    return () => {
      skinned.remove(...rig.roots);
    };
  }, [skinned, rig]);

  const scrolling = useRef<readonly Scrolling[]>([]);
  useLayoutEffect(() => {
    scrolling.current = dress(materials, drawn.ranges, { dressOf, colors, hidden, highlighted });
  }, [materials, drawn, dressOf, colors, hidden, highlighted]);
  useSubmeshPick(skinned, drawn.ranges, hidden, onSubmeshPick);

  useEffect(() => () => drawn.geometry.dispose(), [drawn]);
  useEffect(
    () => () => {
      for (const material of materials) material.dispose();
    },
    [materials],
  );
  useEffect(() => () => rig.skeleton.dispose(), [rig]);

  const locals = useMemo(() => new Float32Array(rig.bones.length * LOCAL_FLOATS), [rig]);
  useFrame((_, delta) => {
    pose.localsInto(clock.time, locals);
    rig.bones.forEach((bone, slot) => {
      const at = slot * LOCAL_FLOATS;
      bone.position.fromArray(locals, at);
      bone.quaternion.fromArray(locals, at + 3);
      bone.scale.fromArray(locals, at + 7);
    });
    for (const { map, scroll } of scrolling.current) {
      map.offset.x += scroll[0] * delta;
      map.offset.y += scroll[1] * delta;
    }
  });

  return (
    <>
      <primitive
        object={skinned}
        scale={[AXIS_SIGN[0] * scale, AXIS_SIGN[1] * scale, AXIS_SIGN[2] * scale]}
      />
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

/** What a submesh's material is dressed from. */
interface Dress {
  readonly dressOf: (submesh: string) => SubmeshDress;
  readonly colors: DressColors;
  readonly hidden: readonly string[];
  readonly highlighted: string | null;
}

/** A map the frame advances, in tiles per second. */
interface Scrolling {
  readonly map: Texture;
  readonly scroll: readonly [number, number];
}

/**
 * Each submesh's material dressed as its skin says, and not at all where the skin hides
 * it. Every submesh but a highlighted one dims. Answers the maps that scroll.
 */
function dress(
  materials: readonly MeshBasicMaterial[],
  ranges: readonly MeshRange[],
  { dressOf, colors, hidden, highlighted }: Dress,
): readonly Scrolling[] {
  const skip = new Set(hidden.map((name) => name.toLowerCase()));
  const lit = highlighted?.toLowerCase() ?? null;
  const scrolling: Scrolling[] = [];
  ranges.forEach((range, at) => {
    const material = materials[at];
    material.visible = !skip.has(range.name.toLowerCase());
    const scroll = dressMaterial(material, dressOf(range.name), colors);
    if (scroll !== null && material.map !== null) scrolling.push({ map: material.map, scroll });
    if (lit !== null && range.name.toLowerCase() !== lit) material.color.multiplyScalar(DIMMED);
  });
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
  const element = useThree((state) => state.gl.domElement);
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
}

function buildGeometry(mesh: MeshGeometry, rig: Rig): Drawn {
  const geometry = new BufferGeometry();
  const vertices = mesh.positions.length / 3;
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  if (mesh.uvs !== null) geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  if (mesh.normals !== null) geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndices(mesh, rig), 4));
  geometry.setAttribute(
    "skinWeight",
    new BufferAttribute(mesh.skinWeights ?? boundToFirst(vertices), 4),
  );
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));

  const ranges = drawnRanges(mesh, []);
  ranges.forEach((range, at) => geometry.addGroup(range.startIndex, range.indexCount, at));

  return { geometry, ranges };
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
