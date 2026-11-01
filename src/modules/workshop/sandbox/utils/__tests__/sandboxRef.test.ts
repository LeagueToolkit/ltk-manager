import { describe, expect, it } from "vitest";

import type { SandboxRef } from "@/lib/tauri";

import { inBuildOrder, projectSandbox, withLayerChosen } from "../sandboxRef";

const ALL = ["base", "chroma", "extra"];

describe("withLayerChosen", () => {
  it("returns a subset in build order if a layer of the project is switched off", () => {
    expect(withLayerChosen(projectSandbox("p"), "p", ALL, "chroma", false)).toEqual({
      kind: "layers",
      project: "p",
      layers: ["base", "extra"],
    });
  });

  it("returns the project's sandbox if the last missing layer is switched on", () => {
    const subset: SandboxRef = { kind: "layers", project: "p", layers: ["base", "extra"] };

    expect(withLayerChosen(subset, "p", ALL, "chroma", true)).toEqual(projectSandbox("p"));
  });

  it("drops a chosen layer the project no longer holds", () => {
    const subset: SandboxRef = { kind: "layers", project: "p", layers: ["gone", "base"] };

    expect(withLayerChosen(subset, "p", ALL, "extra", true)).toEqual({
      kind: "layers",
      project: "p",
      layers: ["base", "extra"],
    });
  });
});

describe("inBuildOrder", () => {
  it("sorts base first, then by priority, then by natural name", () => {
    const layers = [
      { name: "b10", priority: 1 },
      { name: "b2", priority: 1 },
      { name: "low", priority: -1 },
      { name: "base", priority: 5 },
    ];

    expect(inBuildOrder(layers).map((layer) => layer.name)).toEqual(["base", "low", "b2", "b10"]);
  });
});
