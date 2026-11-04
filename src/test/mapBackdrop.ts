import { vi } from "vitest";

import type { MapController } from "@/lib/tauri";
import { type BackdropFlags, mapVisibility } from "@/modules/viewport";

/* The child is declared first, so the listed order differs from the file order. */
const CONTROLLERS: MapController[] = [
  {
    hash: "0x5e652742",
    name: null,
    rule: { kind: "child", parents: ["0x3c5b24f7"], mode: "none" },
  },
  {
    hash: "0x3c5b24f7",
    name: null,
    rule: { kind: "named", defaultVisible: false, terrain: 8, stage: 0 },
  },
  {
    hash: "0x76c50391",
    name: "Maps/Controllers/HallOfLegends",
    rule: { kind: "mutator", name: "SR_Hall_Of_Legends" },
  },
];

/** The visibility of a map with one layer, a terrain, its child and a named mutator, under layer 1. */
export function backdropFlags(over: Partial<BackdropFlags> = {}): BackdropFlags {
  const overrides = over.overrides ?? new Map<string, boolean>();
  return {
    layers: [{ index: 3, triangles: 1250 }],
    flags: 1,
    visibility: mapVisibility(CONTROLLERS, 1, overrides),
    setLayer: vi.fn(),
    controllers: CONTROLLERS,
    flagNames: new Map(),
    uses: new Map([
      [
        "0x3c5b24f7",
        { meshes: 138, materials: ["Maps/Materials/Ground_D4_DragonPit_Ocean_A_MAT"] },
      ],
    ]),
    overrides,
    setController: vi.fn(),
    customized: false,
    reset: vi.fn(),
    navGrid: null,
    ...over,
  };
}
