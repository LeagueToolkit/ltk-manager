import { m } from "@/i18n";

import { nameHash } from "./binHash";

/** What a number a field holds is measured in. */
export type FieldUnit = "seconds" | "degrees" | "distance" | "rate";

/**
 * The fields each unit covers, by the name the class declares them under.
 *
 * "A value reads as what it means" in docs/ux/BIN_EDITOR.md. A hand table beside
 * `GROUP_FIELDS`: nothing in the file says what a float is measured in. An
 * acceleration carries none, because the square second it runs on has no suffix here.
 */
export const UNIT_FIELDS: Record<FieldUnit, readonly string[]> = {
  seconds: [
    "lifetime",
    "particleLifetime",
    "flexParticleLifetime",
    "period",
    "timeBeforeFirstEmission",
    "timeActiveDuringPeriod",
    "Linger",
    "emitterLinger",
    "particleLinger",
    "delay",
  ],
  degrees: ["birthRotation0", "rotation0", "rotationOverride", "uvRotation"],
  distance: [
    "EmitterPosition",
    "translationOverride",
    "flexOffset",
    "emitOffset",
    "birthScale0",
    "scale0",
    "scaleOverride",
    "FlexInstanceScale",
    "radius",
    "height",
    "size",
  ],
  rate: [
    "rate",
    "flexRate",
    "MaximumRateByVelocity",
    "frameRate",
    "birthFrameRate",
    "velocity",
    "birthVelocity",
    "flexBirthVelocity",
    "birthOrbitalVelocity",
    "birthRotationalVelocity0",
    "flexBirthRotationalVelocity0",
    "birthUvRotateRate",
    "birthUvScrollRate",
    "flexBirthUVScrollRate",
    "particleUVRotateRate",
    "particleUVScrollRate",
    "emitterUvScrollRate",
  ],
};

/** The suffix a unit draws after the number. */
export const UNIT_SUFFIX: Record<FieldUnit, () => string> = {
  seconds: m.workshop_bin_inspector_unit_seconds_label,
  degrees: m.workshop_bin_inspector_unit_degrees_label,
  distance: m.workshop_bin_inspector_unit_distance_label,
  rate: m.workshop_bin_inspector_unit_rate_label,
};

const BY_FIELD: ReadonlyMap<string, FieldUnit> = new Map(
  Object.entries(UNIT_FIELDS).flatMap(([unit, fields]) =>
    fields.map((field) => [nameHash(field), unit as FieldUnit] as const),
  ),
);

/** The unit the field `hash` is measured in, or null for a bare number. */
export function fieldUnit(hash: string | null): FieldUnit | null {
  if (hash === null) return null;
  return BY_FIELD.get(hash) ?? null;
}
