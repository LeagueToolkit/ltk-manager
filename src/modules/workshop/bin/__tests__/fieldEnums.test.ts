import { describe, expect, it } from "vitest";

import { nameHash } from "../binHash";
import { ENUM_FIELDS, enumReading, enumText, fieldEnum } from "../fieldEnums";

const hash = (field: string) => nameHash(field);

describe("ENUM_FIELDS", () => {
  it("names a flags table for the one field that holds bits", () => {
    const flags = Object.entries(ENUM_FIELDS)
      .filter(([, held]) => held.flags)
      .map(([field]) => field);

    expect(flags).toEqual(["miscRenderFlags"]);
  });

  it("holds a table for every field it names", () => {
    for (const [field, held] of Object.entries(ENUM_FIELDS)) {
      expect(Object.keys(held.names).length, field).toBeGreaterThan(0);
    }
  });
});

describe("fieldEnum", () => {
  it("answers the table a field carries", () => {
    expect(fieldEnum(hash("blendMode"))?.names.add).toBe(0);
  });

  it("answers none for a field no table covers", () => {
    expect(fieldEnum(hash("lifetime"))).toBeNull();
  });
});

describe("enumReading", () => {
  it("reads an enum by the name the engine gives it", () => {
    expect(enumReading(hash("blendMode"), "0")).toBe("Add");
    expect(enumReading(hash("blendMode"), "4")).toBe("AlphaAdd");
    expect(enumReading(hash("stencilMode"), "2")).toBe("TestEqual");
  });

  it("reads a flags field as every bit it sets", () => {
    expect(enumReading(hash("miscRenderFlags"), "5")).toBe("DisableZBuffer, DisableFow");
  });

  it("reads a bit no table names as its own hex", () => {
    expect(enumReading(hash("miscRenderFlags"), "9")).toBe("DisableZBuffer, 0x8");
  });

  it("reads as the number itself where the table names no such value", () => {
    expect(enumReading(hash("blendMode"), "99")).toBeNull();
    expect(enumReading(hash("miscRenderFlags"), "0")).toBeNull();
  });

  it("reads as the number itself for a field with no table and for no field at all", () => {
    expect(enumReading(hash("lifetime"), "1")).toBeNull();
    expect(enumReading(null, "1")).toBeNull();
  });

  it("leaves a 64-bit integer alone, which no enum holds and no JS number carries", () => {
    expect(enumReading(hash("blendMode"), "18446744073709551615")).toBeNull();
  });
});

describe("enumText", () => {
  it("reads a choice the caller holds without a field to key it on", () => {
    expect(enumText({ names: { off: 0, on: 1 }, flags: false }, 1)).toBe("On");
  });
});
