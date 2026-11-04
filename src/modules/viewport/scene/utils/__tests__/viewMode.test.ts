import { describe, expect, it } from "vitest";

import { drawsNavProjection, offeredViewMode, surfaceOf, viewModesOf } from "../viewMode";

describe("viewModesOf", () => {
  it("lists conformance last if the viewport has a navigation grid", () => {
    expect(viewModesOf(true)).toEqual([
      "lit",
      "unshaded",
      "untextured",
      "wireframe",
      "conformance",
    ]);
  });

  it("leaves conformance out if the viewport has no navigation grid", () => {
    expect(viewModesOf(false)).not.toContain("conformance");
  });
});

describe("offeredViewMode", () => {
  it("returns conformance if the viewport has a navigation grid", () => {
    expect(offeredViewMode("conformance", true)).toBe("conformance");
  });

  it("falls back to lit for conformance if the viewport has no navigation grid", () => {
    expect(offeredViewMode("conformance", false)).toBe("lit");
  });

  it("keeps every other mode without a navigation grid", () => {
    expect(offeredViewMode("wireframe", false)).toBe("wireframe");
  });
});

describe("drawsNavProjection", () => {
  it("draws over every mode that draws surfaces, conformance excepted", () => {
    expect(drawsNavProjection("lit")).toBe(true);
    expect(drawsNavProjection("unshaded")).toBe(true);
    expect(drawsNavProjection("untextured")).toBe(true);
    expect(drawsNavProjection("wireframe")).toBe(false);
    expect(drawsNavProjection("conformance")).toBe(false);
  });
});

describe("surfaceOf", () => {
  it("returns the conformance surface for the conformance mode", () => {
    expect(surfaceOf("conformance")).toBe("conformance");
  });
});
