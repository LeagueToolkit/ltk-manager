import { m } from "@/i18n";

import { nameHash } from "../../../shared/utils/binHash";
import type { SketchKind } from "./primitiveSketch";

/** The emitter field that holds the primitive. */
export const PRIMITIVE_FIELD = nameHash("primitive");

/** A heading of the primitive picker, which groups the classes by what they draw. */
export type PrimitiveFamily = "quad" | "line" | "trail" | "mesh" | "other";

/** One class deriving from `VfxLegacyPrimitiveBase`, in the words the picker uses for it. */
export interface Primitive {
  readonly name: string;
  /** `0x` and eight hex digits. */
  readonly hash: string;
  readonly family: PrimitiveFamily;
  /** What the section's sketch draws for it. */
  readonly sketch: SketchKind;
  readonly label: () => string;
  readonly description: () => string;
}

function primitive(
  name: string,
  family: PrimitiveFamily,
  sketch: SketchKind,
  label: () => string,
  description: () => string,
): Primitive {
  return { name, hash: nameHash(name), family, sketch, label, description };
}

/** The primitive an emitter naming none draws. */
export const DEFAULT_PRIMITIVE = primitive(
  "VfxPrimitiveCameraQuad",
  "quad",
  "cameraQuad",
  m.workshop_bin_vfx_primitive_camera_quad_label,
  m.workshop_bin_vfx_primitive_camera_quad_description,
);

/** Every concrete primitive class, in the order the picker lists them. */
export const PRIMITIVES: readonly Primitive[] = [
  DEFAULT_PRIMITIVE,
  primitive(
    "VfxPrimitiveCameraUnitQuad",
    "quad",
    "cameraQuad",
    m.workshop_bin_vfx_primitive_camera_unit_quad_label,
    m.workshop_bin_vfx_primitive_camera_unit_quad_description,
  ),
  primitive(
    "VfxPrimitiveArbitraryQuad",
    "quad",
    "arbitraryQuad",
    m.workshop_bin_vfx_primitive_arbitrary_quad_label,
    m.workshop_bin_vfx_primitive_arbitrary_quad_description,
  ),
  primitive(
    "VfxPrimitiveRay",
    "line",
    "ray",
    m.workshop_bin_vfx_primitive_ray_label,
    m.workshop_bin_vfx_primitive_ray_description,
  ),
  primitive(
    "VfxPrimitiveBeam",
    "line",
    "beam",
    m.workshop_bin_vfx_primitive_beam_label,
    m.workshop_bin_vfx_primitive_beam_description,
  ),
  primitive(
    "VfxPrimitiveCameraSegmentBeam",
    "line",
    "segmentBeam",
    m.workshop_bin_vfx_primitive_camera_segment_beam_label,
    m.workshop_bin_vfx_primitive_camera_segment_beam_description,
  ),
  primitive(
    "VfxPrimitiveCameraTrail",
    "trail",
    "cameraTrail",
    m.workshop_bin_vfx_primitive_camera_trail_label,
    m.workshop_bin_vfx_primitive_camera_trail_description,
  ),
  primitive(
    "VfxPrimitiveArbitraryTrail",
    "trail",
    "arbitraryTrail",
    m.workshop_bin_vfx_primitive_arbitrary_trail_label,
    m.workshop_bin_vfx_primitive_arbitrary_trail_description,
  ),
  primitive(
    "VfxPrimitiveMesh",
    "mesh",
    "mesh",
    m.workshop_bin_vfx_primitive_mesh_label,
    m.workshop_bin_vfx_primitive_mesh_description,
  ),
  primitive(
    "VfxPrimitiveAttachedMesh",
    "mesh",
    "attachedMesh",
    m.workshop_bin_vfx_primitive_attached_mesh_label,
    m.workshop_bin_vfx_primitive_attached_mesh_description,
  ),
  primitive(
    "VfxPrimitivePlanarProjection",
    "other",
    "projection",
    m.workshop_bin_vfx_primitive_planar_projection_label,
    m.workshop_bin_vfx_primitive_planar_projection_description,
  ),
  primitive(
    "VfxPrimitiveNonRenderable",
    "other",
    "none",
    m.workshop_bin_vfx_primitive_non_renderable_label,
    m.workshop_bin_vfx_primitive_non_renderable_description,
  ),
];

/** The picker's headings, in the order it draws them. */
export const PRIMITIVE_FAMILIES: readonly {
  readonly family: PrimitiveFamily;
  readonly label: () => string;
}[] = [
  { family: "quad", label: m.workshop_bin_vfx_primitive_family_quad_label },
  { family: "line", label: m.workshop_bin_vfx_primitive_family_line_label },
  { family: "trail", label: m.workshop_bin_vfx_primitive_family_trail_label },
  { family: "mesh", label: m.workshop_bin_vfx_primitive_family_mesh_label },
  { family: "other", label: m.workshop_bin_vfx_primitive_family_other_label },
];

const BY_HASH: ReadonlyMap<string, Primitive> = new Map(
  PRIMITIVES.map((each) => [each.hash, each]),
);

/** The primitive a class hash names, and undefined for a class the picker does not list. */
export function primitiveOf(classHash: string): Primitive | undefined {
  return BY_HASH.get(classHash.toLowerCase());
}
