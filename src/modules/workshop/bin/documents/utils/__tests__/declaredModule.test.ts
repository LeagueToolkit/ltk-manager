import { describe, expect, it } from "vitest";

import type { DeclaredModuleSummary } from "@/lib/tauri";

import type { SelectedModule } from "../../state/editorFile";
import { followModuleAction, moduleSync } from "../declaredModule";

const MODULES: DeclaredModuleSummary[] = [
  { index: 0, name: null, takesKeys: true },
  { index: 1, name: "Glow", takesKeys: true },
  { index: 2, name: null, takesKeys: false },
];

const at = (index: number): SelectedModule => ({ layer: "base", kind: "index", index });

describe("moduleSync", () => {
  it("sends the stored module to a document on another one", () => {
    expect(
      moduleSync({ layer: "base", module: { kind: "auto" }, modules: MODULES }, at(1)),
    ).toEqual({
      kind: "send",
      choice: { kind: "index", index: 1 },
    });
  });

  it("stores the module a first edit made", () => {
    const selected: SelectedModule = { layer: "base", kind: "new", name: "Blue" };

    expect(
      moduleSync(
        { layer: "base", module: { kind: "index", index: 3 }, modules: MODULES },
        selected,
      ),
    ).toEqual({ kind: "store", selected: at(3) });
  });

  it("drops a stored module the layer no longer holds as an entries module", () => {
    const declared = { layer: "base", module: { kind: "auto" } as const, modules: MODULES };

    expect(moduleSync(declared, at(2))).toEqual({ kind: "store", selected: null });
    expect(moduleSync(declared, at(7))).toEqual({ kind: "store", selected: null });
  });

  it("reads a module stored for another layer as automatic", () => {
    const declared = { layer: "chroma", module: { kind: "auto" } as const, modules: MODULES };

    expect(moduleSync(declared, at(1))).toEqual({ kind: "none" });
  });
});

describe("followModuleAction", () => {
  it("follows a moved module and the ones it passes", () => {
    const move = { kind: "move", module: 0, to: 2 } as const;

    expect(followModuleAction(at(0), move, false)).toEqual(at(2));
    expect(followModuleAction(at(1), move, false)).toEqual(at(0));
    expect(followModuleAction(at(3), move, false)).toEqual(at(3));
  });

  it("forgets a removed module and shifts the ones after it", () => {
    const remove = { kind: "remove", module: 1 } as const;

    expect(followModuleAction(at(1), remove, false)).toBeNull();
    expect(followModuleAction(at(2), remove, false)).toEqual(at(1));
    expect(followModuleAction(at(0), remove, false)).toEqual(at(0));
  });

  it("shifts only where a key move emptied its source", () => {
    const move = { kind: "moveKeys", module: 0, entry: "A", path: "q", to: 2 } as const;

    expect(followModuleAction(at(2), move, true)).toEqual(at(1));
    expect(followModuleAction(at(2), move, false)).toEqual(at(2));
  });
});
