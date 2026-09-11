import {
  BufferAttribute,
  type BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
} from "three";

/** How many particles one emitter's buffers hold, which caps its share of the pool. */
export const QUADS_PER_EMITTER = 4096;

/** The instanced attributes one quad carries, each written once per frame. */
export interface QuadBuffers {
  readonly geometry: InstancedBufferGeometry;
  /** Three per quad, in the viewport's own space. */
  readonly center: InstancedBufferAttribute;
  /**
   * Three per quad: `scale0` as drawn. A quad expands its corners by half of the first
   * two, and a ray lays the second along its axis past the third.
   */
  readonly size: InstancedBufferAttribute;
  /** Four per quad, straight multiplied onto the texture's sample. */
  readonly color: InstancedBufferAttribute;
  /** One per quad: the radians a camera quad or a world-plane quad spins by. */
  readonly roll: InstancedBufferAttribute;
  /**
   * Three per quad, three of them: the columns of the basis the particle stands on, as
   * the viewport sees it, which an arbitrary quad spans and a ray lies along.
   */
  readonly basisX: InstancedBufferAttribute;
  readonly basisY: InstancedBufferAttribute;
  readonly basisZ: InstancedBufferAttribute;
  /** Three per quad: the angle and the two scales of the base layer's transform. */
  readonly uvTurn: InstancedBufferAttribute;
  /** Four per quad: the base layer's scroll, and where its cell starts. */
  readonly uvShift: InstancedBufferAttribute;
  /** The same pair again, for `textureMult`. */
  readonly uvTurnMult: InstancedBufferAttribute;
  readonly uvShiftMult: InstancedBufferAttribute;
  /**
   * Three per quad: where the colour ramp is read, in texture space, and in the third
   * lane the erosion drive, the map value its kept band opens at.
   *
   * Packed together because a vertex shader is allowed sixteen attributes and the
   * three the renderer declares count against them.
   */
  readonly lookup: InstancedBufferAttribute;
}

/**
 * The geometry one emitter draws its quads from.
 *
 * One unit quad, expanded per instance in the vertex shader, so a frame writes a set of
 * float arrays rather than a matrix per particle.
 */
export function quadBuffers(capacity: number): QuadBuffers {
  const geometry = new InstancedBufferGeometry();
  /* The corners are the same four for every quad, so they are a plain attribute and only
     the arrays below are instanced. */
  geometry.setAttribute("corner", new BufferAttribute(CORNERS, 2));
  /* three counts a wireframe's edges off `position`, which the shader never reads, so four
     empty vertices are what lets `wireMaterial` draw a quad at all. */
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array((CORNERS.length / 2) * 3), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const center = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const size = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const color = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const roll = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  const basisX = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const basisY = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const basisZ = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const uvTurn = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const uvShift = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const uvTurnMult = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const uvShiftMult = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const lookup = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const written = {
    center,
    size,
    color,
    roll,
    basisX,
    basisY,
    basisZ,
    uvTurn,
    uvShift,
    uvTurnMult,
    uvShiftMult,
    lookup,
  };
  for (const [name, attribute] of Object.entries(written)) {
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;

  return { geometry, ...written };
}

/** How many meshes one emitter draws, which caps its share of the pool. */
export const MESHES_PER_EMITTER = 512;

/** The instanced attributes one mesh emitter carries on its geometry, written once per frame. */
export interface MeshBuffers {
  readonly geometry: BufferGeometry;
  /**
   * three reads `instanceMatrix` off the geometry ahead of the mesh's own, so the solid
   * and the twin share one buffer.
   */
  readonly instanceMatrix: InstancedBufferAttribute;
  /** Four per mesh, straight multiplied onto the texture's sample. */
  readonly tint: InstancedBufferAttribute;
  /** One per mesh: the erosion drive, the map value its kept band opens at. */
  readonly erode: InstancedBufferAttribute;
  /** The two layers' transforms, as a quad carries them. */
  readonly uvTurn: InstancedBufferAttribute;
  readonly uvShift: InstancedBufferAttribute;
  readonly uvTurnMult: InstancedBufferAttribute;
  readonly uvShiftMult: InstancedBufferAttribute;
}

/**
 * The per-instance attributes a mesh emitter draws with, placed on its own geometry.
 *
 * Placed where the geometry is built rather than in the component that draws it, because
 * a render is no place to mutate a geometry: a strict-mode render runs a memo twice and
 * keeps the first result, so the attribute the frame loop wrote was not the one the
 * geometry held.
 */
export function meshBuffers(geometry: BufferGeometry): MeshBuffers {
  const count = MESHES_PER_EMITTER;
  const written = {
    instanceMatrix: new InstancedBufferAttribute(new Float32Array(count * 16), 16),
    tint: new InstancedBufferAttribute(new Float32Array(count * 4), 4),
    erode: new InstancedBufferAttribute(new Float32Array(count), 1),
    uvTurn: new InstancedBufferAttribute(new Float32Array(count * 3), 3),
    uvShift: new InstancedBufferAttribute(new Float32Array(count * 4), 4),
    uvTurnMult: new InstancedBufferAttribute(new Float32Array(count * 3), 3),
    uvShiftMult: new InstancedBufferAttribute(new Float32Array(count * 4), 4),
  };
  for (const [name, attribute] of Object.entries(written)) {
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  return { geometry, ...written };
}

/** The first `items` items of `attribute` marked for upload, which is what a frame wrote. */
export function written(attribute: BufferAttribute, items: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, items * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** The four corners of the unit quad, each an offset from its centre. */
const CORNERS = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
