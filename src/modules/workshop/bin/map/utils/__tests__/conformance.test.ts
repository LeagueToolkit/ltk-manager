import { describe, expect, it } from "vitest";

import { conformanceArgs, type ConformanceInputs, conformanceRequest } from "../conformance";

const INPUTS: ConformanceInputs = {
  document: 7,
  map: "maps/mapgeometry/map11/base_srx",
  grid: "container",
  overlays: [1, 3],
  visibility: {
    flags: 0b101,
    controllers: new Map([
      ["0x00000002", false],
      ["0x00000001", true],
    ]),
    hiddenMeshes: new Set([4]),
  },
  threshold: 20,
  geometry: { id: 2, revision: 9, dirty: true },
};

describe("conformanceRequest", () => {
  it("sends the flags and every controller state of the visibility", () => {
    expect(conformanceRequest(INPUTS).shown).toEqual({
      flags: 0b101,
      controllers: { "0x00000001": true, "0x00000002": false },
    });
  });

  it("keys the open geometry by its id and revision", () => {
    const request = conformanceRequest(INPUTS);

    expect(request.geometry).toBe(2);
    expect(request.revision).toBe(9);
  });

  it("returns null geometry and revision if no geometry is open", () => {
    const request = conformanceRequest({ ...INPUTS, geometry: null });

    expect(request.geometry).toBeNull();
    expect(request.revision).toBeNull();
  });
});

describe("conformanceArgs", () => {
  it("returns the command arguments in order without the revision", () => {
    expect(conformanceArgs(conformanceRequest(INPUTS))).toEqual([
      7,
      "maps/mapgeometry/map11/base_srx",
      "container",
      [1, 3],
      { flags: 0b101, controllers: { "0x00000001": true, "0x00000002": false } },
      20,
      2,
    ]);
  });
});
