import { describe, expect, it } from "vitest";

import { nameHash } from "../binHash";
import { fieldUnit, UNIT_FIELDS, UNIT_SUFFIX } from "../fieldUnits";

const hash = (field: string) => nameHash(field);

describe("UNIT_FIELDS", () => {
  it("names no field under two units", () => {
    const all = Object.values(UNIT_FIELDS).flat();

    expect(new Set(all).size).toBe(all.length);
  });

  it("draws each unit as the suffix a number carries", () => {
    expect(UNIT_SUFFIX.seconds()).toBe("s");
    expect(UNIT_SUFFIX.degrees()).toBe("deg");
    expect(UNIT_SUFFIX.distance()).toBe("units");
    expect(UNIT_SUFFIX.rate()).toBe("/s");
  });
});

describe("fieldUnit", () => {
  it("measures a lifetime in seconds", () => {
    expect(fieldUnit(hash("particleLifetime"))).toBe("seconds");
    expect(fieldUnit(hash("timeBeforeFirstEmission"))).toBe("seconds");
  });

  it("measures a rotation in degrees and a rate over a second", () => {
    expect(fieldUnit(hash("birthRotation0"))).toBe("degrees");
    expect(fieldUnit(hash("rate"))).toBe("rate");
    expect(fieldUnit(hash("birthVelocity"))).toBe("rate");
  });

  it("measures a position and a scale in engine units", () => {
    expect(fieldUnit(hash("EmitterPosition"))).toBe("distance");
    expect(fieldUnit(hash("birthScale0"))).toBe("distance");
    expect(fieldUnit(hash("radius"))).toBe("distance");
  });

  it("leaves a bare number alone", () => {
    expect(fieldUnit(hash("blendMode"))).toBeNull();
    expect(fieldUnit(hash("acceleration"))).toBeNull();
    expect(fieldUnit(null)).toBeNull();
  });
});
