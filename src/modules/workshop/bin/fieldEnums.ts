import { nameHash } from "./binHash";
import {
  ADDRESS_MODE,
  BLEND_MODE,
  COLOR_LOOKUP,
  FIXED_ORBIT,
  LINGER_TYPE,
  MISC_RENDER_FLAG,
  SIMPLE_ORIENTATION,
  STENCIL_MODE,
  TRAIL_MODE,
  TRAIL_SMOOTHING,
  UV_MODE,
} from "./vfx/enums";

/** One engine enum as a row reads it: the names it holds, and whether they are bits. */
export interface FieldEnum {
  /** The table `enums.ts` holds, each name against the number the file writes. */
  readonly names: Readonly<Record<string, number>>;
  /** The value sets bits of the table rather than naming one of its entries. */
  readonly flags: boolean;
}

function choice(names: Readonly<Record<string, number>>): FieldEnum {
  return { names, flags: false };
}

function bits(names: Readonly<Record<string, number>>): FieldEnum {
  return { names, flags: true };
}

/**
 * The enum each field carries, by the name the class declares it under.
 *
 * "A value reads as what it means" in docs/ux/BIN_EDITOR.md. A hand table beside
 * `GROUP_FIELDS`, because the schema types these as integers and says no more. `mMode`
 * and `Mode` carry a table apiece and name two classes each, so neither is listed.
 */
export const ENUM_FIELDS: Readonly<Record<string, FieldEnum>> = {
  blendMode: choice(BLEND_MODE),
  stencilMode: choice(STENCIL_MODE),
  uvMode: choice(UV_MODE),
  texAddressModeBase: choice(ADDRESS_MODE),
  texAddressModeMult: choice(ADDRESS_MODE),
  PaletteTextureAddressMode: choice(ADDRESS_MODE),
  erosionMapAddressMode: choice(ADDRESS_MODE),
  colorLookUpTypeX: choice(COLOR_LOOKUP),
  colorLookUpTypeY: choice(COLOR_LOOKUP),
  particleLingerType: choice(LINGER_TYPE),
  orientation: choice(SIMPLE_ORIENTATION),
  fixedOrbitType: choice(FIXED_ORBIT),
  mTrailMode: choice(TRAIL_MODE),
  mSmoothingMode: choice(TRAIL_SMOOTHING),
  miscRenderFlags: bits(MISC_RENDER_FLAG),
};

const BY_FIELD: ReadonlyMap<string, FieldEnum> = new Map(
  Object.entries(ENUM_FIELDS).map(([field, held]) => [nameHash(field), held] as const),
);

/** The enum the field `hash` carries, or null for a field no table covers. */
export function fieldEnum(hash: string): FieldEnum | null {
  return BY_FIELD.get(hash) ?? null;
}

/**
 * `value` in the engine's own words, or null where the table does not reach it.
 *
 * A flags value reads every bit it sets, and a remainder no bit names as its own hex,
 * so a file setting a bit the table does not cover still reads as what it holds.
 */
export function enumText(held: FieldEnum, value: number): string | null {
  if (!held.flags) {
    const found = Object.entries(held.names).find(([, each]) => each === value);
    return found === undefined ? null : titleCase(found[0]);
  }

  const names: string[] = [];
  let rest = value;
  for (const [name, bit] of Object.entries(held.names)) {
    if ((value & bit) === 0) continue;
    names.push(titleCase(name));
    rest &= ~bit;
  }
  if (rest !== 0) names.push(`0x${(rest >>> 0).toString(16)}`);
  return names.length === 0 ? null : names.join(", ");
}

/** What the integer `text` reads as under the field `hash`, and null where it reads as itself. */
export function enumReading(hash: string | null, text: string): string | null {
  if (hash === null) return null;
  const held = fieldEnum(hash);
  if (held === null) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return null;
  return enumText(held, value);
}

/** A table's key as the engine spells the name, which is its own first letter raised. */
function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
