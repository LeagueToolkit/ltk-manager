// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { AssetRef, BinRow, BinRows, BinValue, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { nameHash } from "../binHash";
import { vfxLayout } from "../classLayouts";
import { ClassView } from "../ClassView";
import { READ_ROW_CAP } from "../useBinRead";

const ENTRY = "0x3c4d5e6f";
const SYSTEM = nameHash("VfxSystemDefinitionData");
const MATERIAL = "0x44556677";
const MATERIAL_PATH = "Characters/Smolder/Materials/Glow";

const ASSET: AssetRef = {
  kind: "gameChunk",
  wad: "Champions/Smolder.wad.client",
  pathHash: "00aa",
};

const TEXTURE = "assets/shared/particles/glow.dds";

function row(
  path: string,
  name: string,
  value: BinValue,
  node: BinRow["node"] = "property",
): BinRow {
  return {
    entry: ENTRY,
    path,
    label: name,
    node,
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

const at = (name: string) => nameHash(name).slice(2);
const field = (name: string, value: BinValue) => row(at(name), name, value);
const page = (rows: BinRow[]): BinRows => ({ rows, total: rows.length });

const list = (len: number): BinValue => ({ type: "container", len, itemKind: "pointer" });
const embed = (className: string, len: number): BinValue => ({
  type: "struct",
  classHash: nameHash(className),
  class: className,
  len,
});

const COMPLEX = at("complexEmitterDefinitionData");
const SIMPLE = at("simpleEmitterDefinitionData");
const GLOW = `${COMPLEX}[0]`;
const SPARKS = `${COMPLEX}[1]`;
const TRAIL = `${SIMPLE}[0]`;
const CUSTOM_MATERIAL = `${GLOW}.${at("CustomMaterial")}`;
const BIRTH_COLOR = `${GLOW}.${at("birthColor")}`;
const DYNAMICS = `${BIRTH_COLOR}.${at("dynamics")}`;
const VELOCITY = `${GLOW}.${at("velocity")}`;
const SPARKS_COLOR = `${SPARKS}.${at("birthColor")}`;
const RATE = `${GLOW}.${at("rate")}`;

const ROOTS: BinRow[] = [
  field("particleName", { type: "string", value: "Smolder_Base_Idle" }),
  field("complexEmitterDefinitionData", list(2)),
  field("simpleEmitterDefinitionData", list(1)),
  field("soundOnCreateDefault", { type: "string", value: "sfx_smolder" }),
  field("transform", { type: "matrix", values: Array.from({ length: 16 }, () => 0) }),
];

/** One emitter's own fields, named as the table's columns want them. */
function emitter(path: string, name: string, extra: BinRow[] = [], off = false): BinRows {
  return page([
    row(`${path}.${at("emitterName")}`, "emitterName", { type: "string", value: name }),
    row(`${path}.${at("disabled")}`, "disabled", { type: "bool", value: off }),
    row(`${path}.${at("lifetime")}`, "lifetime", { type: "float", value: 2 }),
    row(`${path}.${at("blendMode")}`, "blendMode", { type: "integer", text: "1" }),
    ...extra,
  ]);
}

const PAGES: Record<string, BinRows> = {
  [COMPLEX]: page([
    row(GLOW, "[0]", embed("VfxEmitterDefinitionData", 6), "element"),
    row(SPARKS, "[1]", embed("VfxEmitterDefinitionData", 5), "element"),
  ]),
  [SIMPLE]: page([row(TRAIL, "[0]", embed("VfxEmitterDefinitionData", 4), "element")]),
  [GLOW]: emitter(GLOW, "Glow", [
    row(`${GLOW}.${at("texture")}`, "texture", { type: "string", value: TEXTURE }),
    row(`${GLOW}.${at("SpawnShape")}`, "SpawnShape", embed("VfxShapeSphere", 1)),
    row(CUSTOM_MATERIAL, "CustomMaterial", embed("VfxMaterialDefinitionData", 2)),
    row(BIRTH_COLOR, "birthColor", embed("ValueColor", 2)),
    row(VELOCITY, "velocity", embed("ValueVector3", 2)),
    row(RATE, "rate", embed("ValueFloat", 2)),
  ]),
  [RATE]: page([
    row(`${RATE}.${at("constantValue")}`, "constantValue", { type: "float", value: 3 }),
    row(`${RATE}.${at("dynamics")}`, "dynamics", embed("VfxAnimatedFloatVariableData", 2)),
  ]),
  [SPARKS]: emitter(SPARKS, "Sparks", [row(SPARKS_COLOR, "birthColor", embed("ValueColor", 1))]),
  [TRAIL]: emitter(TRAIL, "Trail", [], true),
  [SPARKS_COLOR]: page([
    row(`${SPARKS_COLOR}.${at("constantValue")}`, "constantValue", {
      type: "vector",
      values: [0, 1, 0, 1],
    }),
  ]),
  [CUSTOM_MATERIAL]: page([
    row(`${CUSTOM_MATERIAL}.${at("Material")}`, "Material", {
      type: "objectLink",
      hash: MATERIAL,
      name: MATERIAL_PATH,
    }),
  ]),
  [BIRTH_COLOR]: page([
    row(`${BIRTH_COLOR}.${at("constantValue")}`, "constantValue", {
      type: "vector",
      values: [1, 0, 0, 1],
    }),
    row(DYNAMICS, "dynamics", embed("VfxAnimatedColorVariableData", 2)),
  ]),
  [DYNAMICS]: page([
    row(`${DYNAMICS}.${at("times")}`, "times", { type: "container", len: 2, itemKind: "f32" }),
    row(`${DYNAMICS}.${at("values")}`, "values", { type: "container", len: 2, itemKind: "vec4" }),
  ]),
  [`${DYNAMICS}.${at("times")}`]: page([
    row(`${DYNAMICS}.${at("times")}[0]`, "[0]", { type: "float", value: 0 }, "element"),
    row(`${DYNAMICS}.${at("times")}[1]`, "[1]", { type: "float", value: 1 }, "element"),
  ]),
  [`${DYNAMICS}.${at("values")}`]: page([
    row(
      `${DYNAMICS}.${at("values")}[0]`,
      "[0]",
      { type: "vector", values: [1, 0, 0, 1] },
      "element",
    ),
    row(
      `${DYNAMICS}.${at("values")}[1]`,
      "[1]",
      { type: "vector", values: [0, 0, 1, 0] },
      "element",
    ),
  ]),
};

const DECLARED: Record<string, unknown> = {
  [MATERIAL]: {
    path: MATERIAL_PATH,
    declarations: [
      {
        asset: ASSET,
        file: "Smolder.bin",
        classHash: nameHash("StaticMaterialDef"),
        class: "StaticMaterialDef",
      },
    ],
  },
};

const PROJECT: WorkshopProject = {
  path: "C:/mods/skin",
  name: "skin",
  displayName: "Skin",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>{children}</ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function renderSystem(onShowInProperties = vi.fn()) {
  render(
    <ClassView
      document={9}
      asset={ASSET}
      roots={ROOTS}
      classHash={SYSTEM}
      layout={vfxLayout}
      objectName={() => "Particles/Smolder_Base_Idle"}
      onNotOpen={() => {}}
      onShowInProperties={onShowInProperties}
    />,
    { wrapper: Providers },
  );
  return onShowInProperties;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_read") {
      const paths = (args?.paths ?? []) as string[];
      return Promise.resolve({ ok: true, value: paths.map((path) => PAGES[path] ?? page([])) });
    }
    if (command === "locate_game_files") return Promise.resolve({ ok: true, value: {} });
    if (command === "declared_objects") {
      const hashes = (args?.objectHashes ?? []) as string[];
      const objects = Object.fromEntries(
        hashes.filter((hash) => hash in DECLARED).map((hash) => [hash, DECLARED[hash]]),
      );
      return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects } });
    }
    return Promise.resolve({ ok: false, error: { code: "UNKNOWN", detail: command } });
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

/** The strip is what a system opens on, so a table case asks for the table first. */
async function showTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Table" }));
}

describe("ClassView over a particle system", () => {
  it("draws every section of the layout, in its order", () => {
    renderSystem();

    for (const title of ["Identity", "Emitters", "Audio", "Other"]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("draws a card per emitter of both lists", async () => {
    renderSystem();

    expect(await screen.findAllByText("Glow")).not.toHaveLength(0);
    expect(screen.getByText("Sparks")).toBeInTheDocument();
    expect(screen.getByText("Trail")).toBeInTheDocument();
  });

  it("marks a card off the second list, and carries each index", async () => {
    renderSystem();

    await screen.findByText("Trail");
    expect(screen.getByText("simple")).toBeInTheDocument();
    expect(screen.getByText("[1]")).toBeInTheDocument();
  });

  it("lists the groups an emitter sets, and no others", async () => {
    renderSystem();

    await screen.findAllByText("Glow");
    for (const group of ["Emission", "Birth", "Position", "Texture", "Render", "Material"]) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Scale")).not.toBeInTheDocument();
    expect(screen.queryByText("Effects")).not.toBeInTheDocument();
  });

  it("opens on the first emitter's first group", async () => {
    renderSystem();

    expect(await screen.findByText("lifetime")).toBeInTheDocument();
  });

  it("draws a value family as its own constant, not as the class holding it", async () => {
    renderSystem();

    expect(await screen.findByDisplayValue("3")).toBeInTheDocument();
    expect(screen.queryByText("ValueFloat")).not.toBeInTheDocument();
  });

  it("marks a value a curve carries the rest of", async () => {
    renderSystem();

    expect(await screen.findByRole("img", { name: "Animated" })).toBeInTheDocument();
  });

  it("draws the group a chip chooses", async () => {
    renderSystem();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Position" }));

    expect(await screen.findByText("VfxShapeSphere")).toBeInTheDocument();
  });

  it("dims an emitter its own field disables", async () => {
    renderSystem();

    expect(await screen.findByLabelText("Disabled")).toBeInTheDocument();
  });

  it("draws the birth colour in the square of an emitter with no texture", async () => {
    renderSystem();

    expect(await screen.findByRole("img", { name: "Birth colour" })).toBeInTheDocument();
  });

  it("reads both containers in one call, and their elements in the next", async () => {
    renderSystem();

    await screen.findAllByText("Glow");
    const reads = mockInvoke.mock.calls.filter(([command]) => command === "bin_read");

    expect(reads[0]?.[1]).toMatchObject({ entry: ENTRY, paths: [COMPLEX, SIMPLE].sort() });
    expect(reads[1]?.[1]).toMatchObject({ entry: ENTRY, paths: [GLOW, SPARKS, TRAIL].sort() });
  });

  it("marks the squares and the open group, and no other value family", async () => {
    renderSystem();

    await screen.findByRole("img", { name: "Birth colour" });
    const asked = mockInvoke.mock.calls
      .filter(([command]) => command === "bin_read")
      .flatMap(([, args]) => (args as { paths: string[] }).paths);

    expect(asked).toContain(SPARKS_COLOR);
    expect(asked).not.toContain(VELOCITY);
  });

  it("sends a cell its own key, whose ancestors open the emitter in the tree", async () => {
    const onShowInProperties = renderSystem();
    const user = userEvent.setup();

    const [cell] = await screen.findAllByText("Glow");
    await user.pointer({ keys: "[MouseRight]", target: cell as HTMLElement });
    await user.click(await screen.findByRole("menuitem", { name: "Show in properties" }));

    expect(onShowInProperties).toHaveBeenCalledWith(`${ENTRY}:${GLOW}.${at("emitterName")}`);
  });
});

describe("The emitter table", () => {
  it("names each column by the field it draws", async () => {
    renderSystem();
    await showTable(userEvent.setup());

    expect(screen.getByText("emitterName")).toBeInTheDocument();
    expect(screen.getByText("birthColor")).toBeInTheDocument();
    expect(screen.getByText("SpawnShape")).toBeInTheDocument();
  });

  it("draws the class of a pointer field, which is what the row draws", async () => {
    renderSystem();
    await showTable(userEvent.setup());

    expect(await screen.findByText("VfxShapeSphere")).toBeInTheDocument();
  });

  it("draws the chip of the material under the emitter's own material", async () => {
    renderSystem();
    await showTable(userEvent.setup());

    expect(await screen.findByText(MATERIAL_PATH)).toBeInTheDocument();
  });

  it("draws a colour's swatch and strip, as the value rows draw them", async () => {
    renderSystem();
    await showTable(userEvent.setup());

    expect(await screen.findByLabelText("2 colour stops")).toBeInTheDocument();
  });
});

describe("ClassView over sixty emitters", () => {
  /** How many rows one emitter holds, which is what reading its fields costs. */
  const EMITTER_ROWS = 139;
  const MANY = Array.from({ length: 60 }, (_, at) => `${COMPLEX}[${at}]`);

  function renderMany() {
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "locate_game_files") return Promise.resolve({ ok: true, value: {} });
      if (command === "declared_objects") {
        return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects: {} } });
      }
      if (command !== "bin_read") {
        return Promise.resolve({ ok: false, error: { code: "UNKNOWN", detail: command } });
      }
      const paths = (args?.paths ?? []) as string[];
      return Promise.resolve({
        ok: true,
        value: paths.map((path) => {
          if (path === COMPLEX) {
            return page(
              MANY.map((at, index) =>
                row(at, `[${index}]`, embed("VfxEmitterDefinitionData", EMITTER_ROWS), "element"),
              ),
            );
          }
          const index = MANY.indexOf(path);
          return index < 0 ? page([]) : emitter(path, `Emitter${index}`);
        }),
      });
    });

    render(
      <ClassView
        document={9}
        asset={ASSET}
        roots={[field("complexEmitterDefinitionData", list(60))]}
        classHash={SYSTEM}
        layout={vfxLayout}
        objectName={() => "Particles/Smolder_Base_Idle"}
        onNotOpen={() => {}}
        onShowInProperties={vi.fn()}
      />,
      { wrapper: Providers },
    );
  }

  it("reads every emitter, in batches none of which passes the cap", async () => {
    renderMany();
    await screen.findAllByText("Emitter0");

    const asked = mockInvoke.mock.calls
      .filter(([command]) => command === "bin_read")
      .map(([, args]) => (args as { paths: string[] }).paths)
      .filter((paths) => paths.every((path) => MANY.includes(path)));

    expect(asked.length).toBeGreaterThan(1);
    for (const paths of asked) {
      expect(paths.length * EMITTER_ROWS).toBeLessThanOrEqual(READ_ROW_CAP);
    }
    expect(new Set(asked.flat())).toEqual(new Set(MANY));
  });
});
