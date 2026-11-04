import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import type { PlacedItem } from "./mapOutline";
import type { PlaceableMove } from "./placeableEdits";

/** A transform as a person types one, in the engine's space. Rotation is in degrees, XYZ. */
export interface TransformParts {
  readonly position: [number, number, number];
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
}

/** Splits `transform`, column major, into its position, rotation in degrees and scale. */
export function transformParts(transform: readonly (number | null)[]): TransformParts {
  const position = new Vector3();
  const turn = new Quaternion();
  const scale = new Vector3();
  new Matrix4().fromArray(transform.map((cell) => cell ?? 0)).decompose(position, turn, scale);
  const euler = new Euler().setFromQuaternion(turn, "XYZ");
  return {
    position: position.toArray(),
    rotation: [euler.x, euler.y, euler.z].map((angle) => MathUtils.radToDeg(angle)) as [
      number,
      number,
      number,
    ],
    scale: scale.toArray(),
  };
}

/** Joins `parts` into a column major transform. */
export function transformOf(parts: TransformParts): number[] {
  const [x, y, z] = parts.rotation.map((angle) => MathUtils.degToRad(angle));
  return new Matrix4()
    .compose(
      new Vector3(...parts.position),
      new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ")),
      new Vector3(...parts.scale),
    )
    .toArray();
}

/** The most fraction digits a transform field shows. */
const AXIS_DIGITS = 3;

/** Returns `value` as a transform field shows it, rounded to three fraction digits. A negative zero reads as 0. */
export function axisText(value: number): string {
  return String(Number(value.toFixed(AXIS_DIGITS)));
}

/** Reads the number typed into a transform field. Returns null if the text is not a finite number. */
export function parseAxis(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The viewport's mirror of the engine's space, which is its own inverse. */
const MIRROR = new Matrix4().makeScale(...AXIS_SIGN);

/**
 * `transform`, column major in the engine's space, as a matrix in the viewport's space. A null
 * cell, which is a NaN the backend read, is read as 0.
 */
export function viewportMatrix(transform: readonly (number | null)[]): Matrix4 {
  const cells = transform.map((cell) => cell ?? 0);
  return MIRROR.clone().multiply(new Matrix4().fromArray(cells)).multiply(MIRROR);
}

/** `matrix` in the viewport's space as the engine's column major `transform`. */
export function engineTransform(matrix: Matrix4): number[] {
  return MIRROR.clone().multiply(matrix).multiply(MIRROR).toArray();
}

/**
 * Returns `items` with the transform and position that `dragged` gives each of them, and
 * `items` itself where `dragged` is null.
 */
export function withDragged(
  items: readonly PlacedItem[],
  dragged: ReadonlyMap<string, readonly (number | null)[]> | null,
): readonly PlacedItem[] {
  if (dragged === null) return items;

  return items.map((placed) => {
    const transform = dragged.get(placed.id);
    if (transform === undefined) return placed;

    const item = {
      ...placed.item,
      transform: transform as PlacedItem["item"]["transform"],
      position: [transform[12] ?? 0, transform[13] ?? 0, transform[14] ?? 0] as [
        number,
        number,
        number,
      ],
    };
    return { ...placed, item };
  });
}

/** The reads that change when a gizmo edit lands, and again when it is undone or redone. */
export interface DragBasis {
  /** The placeable outline of the `.materials.bin`, compared by identity. */
  readonly outline: unknown;
  /** The revision of the open `.mapgeo`, and null while none is open. */
  readonly geometryRevision: number | null;
}

/** The transforms of a gizmo drag by selection id, and the basis of its last step. */
export interface HeldDrag {
  readonly transforms: ReadonlyMap<string, readonly (number | null)[]>;
  readonly basis: DragBasis;
}

/**
 * Returns the transforms of `held` if `basis` is the basis of its last step, else null.
 *
 * A placeable edit changes the outline and a mesh edit changes the geometry revision. Each changes
 * again on an undo or a redo, so the scene then draws the selection where the documents hold it.
 */
export function shownDrag(
  held: HeldDrag | null,
  basis: DragBasis,
): ReadonlyMap<string, readonly (number | null)[]> | null {
  if (held === null) return null;

  const same =
    held.basis.outline === basis.outline && held.basis.geometryRevision === basis.geometryRevision;
  return same ? held.transforms : null;
}

/** Something the gizmo moves: a placeable or a mesh, by its selection id. */
export interface Positioned {
  readonly id: string;
  /** Column major in the engine's space. */
  readonly transform: readonly (number | null)[];
  /**
   * Where the gizmo stands and turns around for this item as the lead, column major in the
   * engine's space. Absent, it stands at `transform`.
   */
  readonly anchor?: readonly (number | null)[];
}

/** A new transform for the item under `id`, column major in the engine's space. */
export interface Moved {
  readonly id: string;
  readonly transform: number[];
}

/**
 * Returns the transforms that carry each of `items` the way `before` became `after`, both in
 * the viewport's space, so the selection moves rigidly with the lead.
 */
export function movesOf(items: readonly Positioned[], before: Matrix4, after: Matrix4): Moved[] {
  const delta = after.clone().multiply(before.clone().invert());
  return items.map(({ id, transform }) => ({
    id,
    transform: engineTransform(delta.clone().multiply(viewportMatrix(transform))),
  }));
}

/**
 * Returns the transforms that give the lead of `items`, the first, the transform `next`, and
 * move every other item with it, as a gizmo drag does.
 */
export function movesToLead(items: readonly Positioned[], next: readonly number[]): Moved[] {
  const lead = items[0];
  if (lead === undefined) return [];

  return movesOf(items, viewportMatrix(lead.transform), viewportMatrix(next));
}

/** Returns the placeable moves of `moved`, by the chunk and key each placeable id names. */
export function placeableMoves(moved: readonly Moved[]): PlaceableMove[] {
  return moved.flatMap(({ id, transform }) => {
    const at = id.indexOf("/");
    return at < 0 ? [] : [{ chunk: id.slice(0, at), key: id.slice(at + 1), transform }];
  });
}
