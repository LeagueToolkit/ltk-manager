// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { type ReactNode, useMemo, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { ToastProvider } from "@/components";
import type {
  AssetRef,
  BinRow,
  BinRows,
  BinValue,
  VfxSystem,
  VfxValue,
  WorkshopProject,
} from "@/lib/tauri";
import { useWorkshopLayoutStore } from "@/stores";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { useWorkshopEditorStore } from "../../state/workshopEditor";
import { nameHash } from "../binHash";
import { vfxLayout } from "../classLayouts";
import { ClassView } from "../ClassView";
import { CurveDockContext, type CurveTarget } from "../curveTarget";
import { READ_ROW_CAP } from "../useBinRead";

const ENTRY = "0x3c4d5e6f";
const SYSTEM = nameHash("VfxSystemDefinitionData");
const MATERIAL = "0x44556677";
const MATERIAL_PATH = "Characters/Smolder/Materials/Glow";
/** An object a row under an opened struct links, which the view's own read never reaches. */
const NESTED_LINK = "0x55667788";

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
const SPARKS_RATE = `${SPARKS}.${at("rate")}`;
const SPARKS_SCALE = `${SPARKS}.${at("birthScale0")}`;
const RATE = `${GLOW}.${at("rate")}`;
const RATE_CURVE = `${RATE}.${at("dynamics")}`;
const RATE_TIMES = `${RATE_CURVE}.${at("times")}`;
const RATE_VALUES = `${RATE_CURVE}.${at("values")}`;
const RATE_TABLES = `${RATE_CURVE}.${at("probabilityTables")}`;
const RATE_TABLE = `${RATE_TABLES}[0]`;
const RATE_KEY_TIMES = `${RATE_TABLE}.${at("keyTimes")}`;
const RATE_KEY_VALUES = `${RATE_TABLE}.${at("keyValues")}`;
const SHAPE = `${GLOW}.${at("SpawnShape")}`;
const SPARKS_SHAPE = `${SPARKS}.${at("SpawnShape")}`;

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
    row(`${GLOW}.${at("SpawnShape")}`, "SpawnShape", embed("VfxShapeSphere", 2)),
    row(CUSTOM_MATERIAL, "CustomMaterial", embed("VfxMaterialDefinitionData", 2)),
    row(BIRTH_COLOR, "birthColor", embed("ValueColor", 2)),
    row(VELOCITY, "velocity", embed("ValueVector3", 2)),
    row(RATE, "rate", embed("ValueFloat", 2)),
  ]),
  [RATE]: page([
    row(`${RATE}.${at("constantValue")}`, "constantValue", { type: "float", value: 3 }),
    row(RATE_CURVE, "dynamics", embed("VfxAnimatedFloatVariableData", 3)),
  ]),
  [RATE_CURVE]: page([
    row(RATE_TIMES, "times", { type: "container", len: 2, itemKind: "f32" }),
    row(RATE_VALUES, "values", { type: "container", len: 2, itemKind: "f32" }),
    row(RATE_TABLES, "probabilityTables", list(1)),
  ]),
  [RATE_TABLES]: page([row(RATE_TABLE, "[0]", embed("VfxProbabilityTableData", 2), "element")]),
  [RATE_TABLE]: page([
    row(RATE_KEY_TIMES, "keyTimes", { type: "container", len: 2, itemKind: "f32" }),
    row(RATE_KEY_VALUES, "keyValues", { type: "container", len: 2, itemKind: "f32" }),
  ]),
  [RATE_KEY_TIMES]: page([
    row(`${RATE_KEY_TIMES}[0]`, "[0]", { type: "float", value: 0 }, "element"),
    row(`${RATE_KEY_TIMES}[1]`, "[1]", { type: "float", value: 1 }, "element"),
  ]),
  [RATE_KEY_VALUES]: page([
    row(`${RATE_KEY_VALUES}[0]`, "[0]", { type: "float", value: 0.5 }, "element"),
    row(`${RATE_KEY_VALUES}[1]`, "[1]", { type: "float", value: 1 }, "element"),
  ]),
  [RATE_TIMES]: page([
    row(`${RATE_TIMES}[0]`, "[0]", { type: "float", value: 0 }, "element"),
    row(`${RATE_TIMES}[1]`, "[1]", { type: "float", value: 1 }, "element"),
  ]),
  [RATE_VALUES]: page([
    row(`${RATE_VALUES}[0]`, "[0]", { type: "float", value: 3 }, "element"),
    row(`${RATE_VALUES}[1]`, "[1]", { type: "float", value: 12 }, "element"),
  ]),
  [SPARKS]: emitter(SPARKS, "Sparks", [
    row(SPARKS_COLOR, "birthColor", embed("ValueColor", 1)),
    row(SPARKS_RATE, "rate", embed("ValueFloat", 1)),
    row(SPARKS_SCALE, "birthScale0", embed("ValueVector3", 1)),
    row(SPARKS_SHAPE, "SpawnShape", embed("VfxShapeBox", 1)),
  ]),
  [TRAIL]: emitter(TRAIL, "Trail", [], true),
  [SHAPE]: page([
    row(`${SHAPE}.${at("radius")}`, "radius", { type: "float", value: 25 }),
    row(`${SHAPE}.${at("mesh")}`, "mesh", {
      type: "objectLink",
      hash: NESTED_LINK,
      name: "Characters/Smolder/Sphere",
    }),
  ]),
  [SPARKS_SHAPE]: page([
    row(`${SPARKS_SHAPE}.${at("size")}`, "size", { type: "vector", values: [40, 0, 40] }),
  ]),
  [SPARKS_COLOR]: page([
    row(`${SPARKS_COLOR}.${at("constantValue")}`, "constantValue", {
      type: "vector",
      values: [0, 1, 0, 1],
    }),
  ]),
  [SPARKS_RATE]: page([
    row(`${SPARKS_RATE}.${at("constantValue")}`, "constantValue", { type: "float", value: 7 }),
  ]),
  [SPARKS_SCALE]: page([
    row(`${SPARKS_SCALE}.${at("constantValue")}`, "constantValue", {
      type: "vector",
      values: [40, 40, 40],
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

/** The system Glow's particles spawn, another object of the same document. */
const CHILD_ENTRY = "0x7a8b9c0d";
const CHILD_NAME = "Particles/Smolder_Child";
const CHILD_TEXTURE = "assets/shared/particles/ember.dds";

/** `page` as the child system's own entry holds it. */
const inChild = (held: BinRows): BinRows => ({
  ...held,
  rows: held.rows.map((each) => ({ ...each, entry: CHILD_ENTRY })),
});

/** The child's one emitter, Ember, sits at Glow's path under its own entry. */
const CHILD_PAGES: Record<string, BinRows> = {
  [COMPLEX]: inChild(page([row(GLOW, "[0]", embed("VfxEmitterDefinitionData", 7), "element")])),
  [GLOW]: inChild(
    emitter(GLOW, "Ember", [
      row(`${GLOW}.${at("texture")}`, "texture", { type: "string", value: CHILD_TEXTURE }),
      row(RATE, "rate", embed("ValueFloat", 2)),
      row(`${GLOW}.${at("particleLinger")}`, "particleLinger", { type: "float", value: 0.5 }),
    ]),
  ),
  [RATE]: inChild(PAGES[RATE]),
  [RATE_CURVE]: inChild(PAGES[RATE_CURVE]),
  [RATE_TIMES]: inChild(PAGES[RATE_TIMES]),
  [RATE_VALUES]: inChild(PAGES[RATE_VALUES]),
};

function vfxStruct(
  className: string,
  fields: Record<string, VfxValue>,
  object: { entry: string; name: string | null } | null = null,
): VfxValue {
  return {
    type: "struct",
    classHash: nameHash(className),
    class: className,
    object,
    fields: Object.entries(fields).map(([name, value]) => ({ hash: nameHash(name), name, value })),
  };
}

const vfxEmitter = (name: string, fields: Record<string, VfxValue> = {}) =>
  vfxStruct("VfxEmitterDefinitionData", {
    emitterName: { type: "string", value: name },
    ...fields,
  });
const vfxList = (...items: VfxValue[]): VfxValue => ({ type: "container", items });

/** The system as the run reads it, Glow spawning the child system. */
const RESOLVED: VfxSystem = {
  entry: ENTRY,
  name: "Particles/Smolder_Base_Idle",
  classHash: SYSTEM,
  class: "VfxSystemDefinitionData",
  root: vfxStruct("VfxSystemDefinitionData", {
    complexEmitterDefinitionData: vfxList(
      vfxEmitter("Glow", {
        childParticleSetDefinition: vfxStruct("VfxChildParticleSetDefinitionData", {
          childrenIdentifiers: vfxList(
            vfxStruct("VfxChildIdentifier", {
              effect: vfxStruct(
                "VfxSystemDefinitionData",
                { complexEmitterDefinitionData: vfxList(vfxEmitter("Ember")) },
                { entry: CHILD_ENTRY, name: CHILD_NAME },
              ),
            }),
          ),
        }),
      }),
      vfxEmitter("Sparks"),
    ),
    simpleEmitterDefinitionData: vfxList(vfxEmitter("Trail")),
  }),
};

/** What the meta schema declares for an emitter, which Defaults lists the unauthored of. */
const SCHEMA = {
  name: "VfxEmitterDefinitionData",
  build: 1500,
  patch: null,
  fields: [
    {
      hash: nameHash("lifetime"),
      name: "lifetime",
      declared: { kind: "f32", key: null, value: null },
      revisions: [],
    },
    {
      hash: nameHash("scale0"),
      name: "scale0",
      declared: { kind: "pointer", key: null, value: null },
      revisions: [],
    },
  ],
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

/** A pane a shell fits in, and one that falls back to the stack. */
const WIDE = 1200;
const NARROW = 700;

/** What the object pane measures, which happy-dom runs no layout to answer. */
let paneWidth = 0;

/** Every live observer of it, since happy-dom's own watches nothing. */
const OBSERVERS = new Set<(entries: ResizeObserverEntry[]) => void>();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => paneWidth,
  });
  globalThis.ResizeObserver = class {
    private readonly notify: (entries: ResizeObserverEntry[]) => void;

    constructor(notify: (entries: ResizeObserverEntry[]) => void) {
      this.notify = notify;
      OBSERVERS.add(notify);
    }

    observe() {}
    unobserve() {}

    disconnect() {
      OBSERVERS.delete(this.notify);
    }
  } as unknown as typeof ResizeObserver;
});

/**
 * The pane at a new width, which the frame hears about only through an observer.
 *
 * The entries are empty, since the frame measures the element rather than the entry and
 * the virtualizer under the tree falls back to a rect of its own when they are.
 */
async function resizeTo(width: number) {
  paneWidth = width;
  await act(async () => {
    for (const notify of OBSERVERS) notify([]);
  });
}

/** The dock the object tab holds, which a test rendering the view alone stands in for. */
function WithDock({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<CurveTarget | null>(null);
  const dock = useMemo(() => ({ target, aim: setTarget, clear: () => setTarget(null) }), [target]);
  return <CurveDockContext value={dock}>{children}</CurveDockContext>;
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>
          <WithDock>{children}</WithDock>
        </ToastProvider>
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
  paneWidth = 0;
  /* The arrangement is the project's, so a pane one case opened would stay open for the next. */
  useWorkshopEditorStore.setState({ byProject: {} });
  /* Defaults is app-wide and persisted, so a case that turns it on would turn it on for the next. */
  useWorkshopLayoutStore.setState({ inspectorDefaults: false, openSections: {} });
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_read") {
      const paths = (args?.paths ?? []) as string[];
      const pages = args?.entry === CHILD_ENTRY ? CHILD_PAGES : PAGES;
      return Promise.resolve({ ok: true, value: paths.map((path) => pages[path] ?? page([])) });
    }
    if (command === "class_schema") return Promise.resolve({ ok: true, value: SCHEMA });
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

/** Reopen or close one pane from the menu the crumb row carries. */
async function fromPanesMenu(user: UserEvent, name: string) {
  await user.click(screen.getByRole("button", { name: "Panes" }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

/** The lanes stand in for the strip in the shell, so a card case opens the Emitters pane first. */
async function showCards(user: UserEvent) {
  await screen.findByText("lifetime");
  await fromPanesMenu(user, "Emitters");
  await screen.findAllByRole("button", { name: /Sparks/ });
}

/** Every path the projected read has asked for, in the order it asked. */
function asked(): string[] {
  return mockInvoke.mock.calls
    .filter(([command]) => command === "bin_read")
    .flatMap(([, args]) => (args as { paths: string[] }).paths);
}

/** Every object hash the link checks have asked the index about, in the order asked. */
function declaredAsked(): string[] {
  return mockInvoke.mock.calls
    .filter(([command]) => command === "declared_objects")
    .flatMap(([, args]) => (args as { objectHashes: string[] }).objectHashes);
}

/** A box `height` tall from `top`, as the layout a test stands in for measures one. */
function rect(top: number, height: number): DOMRect {
  const box = { x: 0, y: top, top, bottom: top + height, left: 0, right: 100, width: 100, height };
  return { ...box, toJSON: () => box };
}

/** A group's own fold button, which is the only control naming it that expands. */
function section(group: string, open = true): HTMLElement {
  return screen.getByRole("button", { name: group, expanded: open });
}

/** A card's group chip, which neither folds a section nor sits in the jump bar. */
function cardChip(group: string): HTMLElement {
  const held = screen
    .getAllByRole("button", { name: group })
    .find((each) => !each.hasAttribute("aria-expanded") && each.closest("nav") === null);
  if (held === undefined) throw new Error(group);
  return held;
}

/**
 * The inspector line a field's name sits on, which holds that field's own controls.
 *
 * Retried rather than awaited once, because the curve pane lists the same field names and
 * can answer the first match before the inspector has drawn a row at all.
 */
async function fieldRow(name: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const cells = screen.getAllByText(name);
    const line = cells.map((cell) => cell.closest<HTMLElement>("[data-row-key]")).find(Boolean);
    if (line == null) throw new Error(name);
    return line;
  });
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

  it("narrows the strip to the emitters whose name holds the text, case-insensitively", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Sparks");

    await user.type(screen.getByRole("textbox", { name: "Filter emitters by name" }), "spa");

    expect(screen.getByText("Sparks")).toBeInTheDocument();
    expect(screen.queryByText("Trail")).toBeNull();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("restores every card when the field is cleared, and says how many while it is not", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Sparks");
    const field = screen.getByRole("textbox", { name: "Filter emitters by name" });

    expect(screen.queryByText("3 of 3")).toBeNull();

    await user.type(field, "spa");
    await user.clear(field);

    expect(screen.getByText("Trail")).toBeInTheDocument();
    expect(screen.queryByText(/ of 3/)).toBeNull();
  });

  it("narrows the table on the same text the strip was narrowed on", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Sparks");

    await user.type(screen.getByRole("textbox", { name: "Filter emitters by name" }), "spa");
    await user.click(screen.getByRole("button", { name: "Table" }));

    expect(await screen.findByText("Sparks")).toBeInTheDocument();
    expect(screen.queryByText("Trail")).toBeNull();
  });

  const opened = (name: RegExp) => screen.getByRole("button", { name, pressed: true });

  it("moves the open card to the first match when the filter hides the one that was open", async () => {
    renderSystem();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Sparks/ }));
    expect(opened(/Sparks/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Filter emitters by name" }), "trail");

    expect(opened(/Trail/)).toBeInTheDocument();
  });

  it("opens a card whose fields the read has not answered, which sets no group at all", async () => {
    renderSystem();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Trail/ }));

    expect(opened(/Trail/)).toBeInTheDocument();
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

  it("leaves every group drawn when a chip picks one, because picking scrolls rather than filters", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(cardChip("Position"));

    expect(await screen.findByText("SpawnShape")).toBeInTheDocument();
    expect(screen.getByText("lifetime")).toBeInTheDocument();
    expect(screen.getByText("blendMode")).toBeInTheDocument();
  });

  it("draws every group the emitter sets at once, each a section of its own", async () => {
    renderSystem();
    await screen.findByText("lifetime");

    expect(screen.getByText("SpawnShape")).toBeInTheDocument();
    expect(screen.getByText("blendMode")).toBeInTheDocument();
  });

  it("folds a section from its own header", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(section("Emission"));

    expect(screen.queryByText("lifetime")).toBeNull();
    expect(screen.getByText("blendMode")).toBeInTheDocument();
  });

  it("reads no row of a folded section, and reads them once it opens", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(section("Emission"));
    await user.click(await screen.findByRole("button", { name: /Sparks/ }));
    await waitFor(() => expect(asked()).toContain(SPARKS_SCALE));

    expect(asked()).not.toContain(SPARKS_RATE);

    await user.click(section("Emission", false));

    await waitFor(() => expect(asked()).toContain(SPARKS_RATE));
  });

  it("reads an enum by the name the engine gives it", async () => {
    renderSystem();

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("carries the unit of a field after its number", async () => {
    renderSystem();
    const line = within(await fieldRow("lifetime"));

    expect(line.getByDisplayValue("2")).toBeInTheDocument();
    expect(line.getByText("s")).toBeInTheDocument();
  });

  it("draws a value family as its own constant, not as the class holding it", async () => {
    renderSystem();

    expect(await screen.findByDisplayValue("3")).toBeInTheDocument();
    expect(screen.queryByText("ValueFloat")).not.toBeInTheDocument();
  });

  it("draws a sparkline of the curve a panel row's dynamics points at", async () => {
    renderSystem();

    expect(await screen.findByLabelText("2 curve keys")).toBeInTheDocument();
  });

  it("marks a value whose curve the panel has not read", async () => {
    renderSystem();
    const user = userEvent.setup();

    const [birth] = await screen.findAllByRole("button", { name: "Birth" });
    await user.click(birth as HTMLElement);

    expect(await screen.findByRole("img", { name: "Animated" })).toBeInTheDocument();
  });

  it("scrolls to the group a card's chip chooses", async () => {
    const scrolled = vi.fn();
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = native;
    });
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("SpawnShape");
    scrolled.mockClear();

    await user.click(cardChip("Position"));

    expect(scrolled.mock.contexts).toContain(section("Position").closest("section"));
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

  it("marks the squares and every row it draws, and reads the keys of what is on screen", async () => {
    renderSystem();

    await screen.findByRole("img", { name: "Birth colour" });
    await waitFor(() => expect(asked()).toContain(RATE_TIMES));

    expect(asked()).toContain(SPARKS_COLOR);
    expect(asked()).toContain(VELOCITY);
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

    expect(await screen.findByRole("button", { name: MATERIAL_PATH })).toBeInTheDocument();
  });

  it("draws a colour's swatch and strip, as the value rows draw them", async () => {
    renderSystem();
    await showTable(userEvent.setup());

    expect(await screen.findByLabelText("2 colour stops")).toBeInTheDocument();
  });
});

describe("The shell frame", () => {
  beforeEach(() => {
    paneWidth = WIDE;
  });

  /** The crumb, which is the one place a shell aims the inspector from. */
  const crumb = () => within(screen.getByRole("navigation", { name: "What the inspector draws" }));

  it("names the system, the open emitter and its group", async () => {
    renderSystem();
    await screen.findByText("lifetime");

    expect(crumb().getByRole("button", { name: "Smolder_Base_Idle" })).toBeInTheDocument();
    expect(crumb().getByRole("button", { name: /Glow/ })).toBeInTheDocument();
    expect(crumb().getByRole("button", { name: "Emission" })).toBeInTheDocument();
  });

  it("draws the system's own sections from the crumb's first segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");
    expect(screen.queryByRole("button", { name: "Identity" })).not.toBeInTheDocument();

    await user.click(crumb().getByRole("button", { name: "Smolder_Base_Idle" }));

    for (const title of ["Identity", "Audio", "Other"]) {
      expect(await screen.findByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("draws every group the emitter sets from the crumb's second segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(crumb().getByRole("button", { name: /Glow/ }));

    expect(await screen.findByText("lifetime")).toBeInTheDocument();
    expect(screen.getByText("SpawnShape")).toBeInTheDocument();
    expect(screen.getByText("texture")).toBeInTheDocument();
  });

  it("opens a menu of that emitter's groups on the crumb's last segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(crumb().getByRole("button", { name: "Emission" }));

    expect(await screen.findByRole("menuitem", { name: "Position" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Scale" })).not.toBeInTheDocument();
  });

  it("scrolls to the group the crumb's menu names, the one already aimed at included", async () => {
    const scrolled = vi.fn();
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = native;
    });
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");
    scrolled.mockClear();

    await user.click(crumb().getByRole("button", { name: "Emission" }));
    await user.click(await screen.findByRole("menuitem", { name: "Emission" }));

    expect(scrolled.mock.contexts).toContain(section("Emission").closest("section"));
  });

  it("holds the crumb's group segment still while the pane scrolls", async () => {
    renderSystem();
    await screen.findByText("lifetime");
    const sections = ["Emission", "Birth", "Position"].map(
      (title) => section(title).closest("section") as HTMLElement,
    );
    const pane = sections[0]?.parentElement as HTMLElement;

    /* The first section scrolled up until its last sliver shows, the second under it. */
    const rects = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const at = sections.indexOf(this as HTMLElement);
        if (at >= 0) return rect(at * 200 - 190, 200);
        if (this === pane) return rect(0, 400);
        return rect(0, 0);
      });
    onTestFinished(() => rects.mockRestore());
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 400 });

    fireEvent.scroll(pane);

    expect(crumb().getByRole("button", { name: "Emission" })).toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: "Birth" })).not.toBeInTheDocument();
  });

  it("aims the crumb at the emitter when a card names itself", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const [card] = await screen.findAllByRole("button", { name: /Sparks/ });

    await user.click(card as HTMLElement);

    expect(crumb().getByRole("button", { name: /Sparks/ })).toBeInTheDocument();
    expect(await screen.findByText("blendMode")).toBeInTheDocument();
  });

  it("holds a place for the curve before a mark targets it", async () => {
    renderSystem();
    await screen.findByText("lifetime");

    expect(screen.getByRole("tab", { name: "Curve" })).toBeInTheDocument();
    expect(screen.getByText("No value targeted")).toBeInTheDocument();
  });

  it("draws the curve of the row a sparkline targets, named by its chain and its path", async () => {
    renderSystem();
    const user = userEvent.setup();
    const line = within(await fieldRow("rate"));

    await user.click(await line.findByRole("button", { name: "Show curve" }));

    expect(await screen.findByText("Glow [0] . rate")).toBeInTheDocument();
    expect(screen.getByText(RATE)).toBeInTheDocument();
    expect(screen.queryByText("No value targeted")).not.toBeInTheDocument();
  });

  it("lists the emitter's animated fields while nothing targets the pane, and aims from one", async () => {
    renderSystem();
    const user = userEvent.setup();
    await within(await fieldRow("rate")).findByRole("button", { name: "Show curve" });
    const pane = within(document.querySelector<HTMLElement>("[data-ui='CurveSurface']")!);

    expect(pane.getByText("Glow [0] animates")).toBeInTheDocument();
    await user.click(pane.getByRole("button", { name: "rate" }));

    expect(await screen.findByText("Glow [0] . rate")).toBeInTheDocument();
  });

  it("follows its field to the emitter selected next, and lists that one's curves where it has none", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const line = within(await fieldRow("rate"));
    await user.click(await line.findByRole("button", { name: "Show curve" }));
    await screen.findByText("Glow [0] . rate");

    const [sparks] = await screen.findAllByRole("button", { name: /Sparks/ });
    await user.click(sparks as HTMLElement);

    expect(await screen.findByText("No value targeted")).toBeInTheDocument();
    expect(screen.queryByText("Glow [0] . rate")).not.toBeInTheDocument();

    const [glow] = screen.getAllByRole("button", { name: /Glow/ });
    await user.click(glow as HTMLElement);

    expect(await screen.findByText("Glow [0] . rate")).toBeInTheDocument();
  });

  it("opens a struct row in place, and holds it open on the emitter selected next", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const shape = within(await fieldRow("SpawnShape"));

    await user.click(shape.getByRole("button", { name: "Show fields", expanded: false }));
    expect(await screen.findByText("radius")).toBeInTheDocument();

    const [sparks] = await screen.findAllByRole("button", { name: /Sparks/ });
    await user.click(sparks as HTMLElement);

    expect(await screen.findByText("size")).toBeInTheDocument();
    expect(screen.queryByText("radius")).not.toBeInTheDocument();
  });

  it("aims the menu at a row under an opened struct, and checks the links it holds", async () => {
    const onShowInProperties = renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const shape = within(await fieldRow("SpawnShape"));
    await user.click(shape.getByRole("button", { name: "Show fields", expanded: false }));
    const radius = await screen.findByText("radius");

    await waitFor(() => expect(declaredAsked()).toContain(NESTED_LINK));

    await user.pointer({ keys: "[MouseRight]", target: radius });
    await user.click(await screen.findByRole("menuitem", { name: "Show in properties" }));

    expect(onShowInProperties).toHaveBeenCalledWith(`${ENTRY}:${SHAPE}.${at("radius")}`);
  });

  it("keeps the pane on its target when another group is chosen", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const line = within(await fieldRow("rate"));
    await user.click(await line.findByRole("button", { name: "Show curve" }));
    await screen.findByText("Glow [0] . rate");

    await user.click(crumb().getByRole("button", { name: "Emission" }));
    await user.click(await screen.findByRole("menuitem", { name: "Position" }));

    expect(await screen.findByText("VfxShapeSphere")).toBeInTheDocument();
    expect(screen.getByText("Glow [0] . rate")).toBeInTheDocument();
  });

  it("gives a row with dynamics both triggers, and a row without neither", async () => {
    renderSystem();
    const animated = within(await fieldRow("rate"));
    const flat = within(await fieldRow("lifetime"));

    expect(await animated.findByRole("button", { name: "Show curve" })).toBeInTheDocument();
    expect(animated.getByRole("button", { name: "Show what is random" })).toBeInTheDocument();
    expect(flat.queryByRole("button", { name: "Show curve" })).toBeNull();
  });

  it("opens the dock on the graph, the spread under it, from the second trigger", async () => {
    renderSystem();
    const user = userEvent.setup();
    const line = within(await fieldRow("rate"));

    await user.click(await line.findByRole("button", { name: "Show what is random" }));

    expect(await screen.findByText("Glow [0] . rate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("uniform")).toBeInTheDocument();
  });

  it("appends the fields the emitter does not author while Defaults is on", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");
    expect(screen.queryByText("scale0")).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Defaults" }));

    expect(await screen.findByText("scale0")).toBeInTheDocument();
  });

  it("offers Show curve on a row with dynamics and on no row without", async () => {
    renderSystem();
    const user = userEvent.setup();

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("rate") });
    expect(await screen.findByRole("menuitem", { name: "Show curve" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("lifetime") });

    expect(screen.queryByRole("menuitem", { name: "Show curve" })).not.toBeInTheDocument();
  });

  it("sends a cell of the inspector its own key, for the tree to reveal", async () => {
    const onShowInProperties = renderSystem();
    const user = userEvent.setup();
    const cell = await screen.findByText("lifetime");

    await user.pointer({ keys: "[MouseRight]", target: cell });
    await user.click(await screen.findByRole("menuitem", { name: "Show in properties" }));

    expect(onShowInProperties).toHaveBeenCalledWith(`${ENTRY}:${GLOW}.${at("lifetime")}`);
  });

  it("names the group a chip chooses on the crumb's last segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);

    await user.click(cardChip("Position"));

    expect(await crumb().findByRole("button", { name: "Position" })).toBeInTheDocument();
  });

  it("draws the panel under the strip once the pane is too narrow for a shell", async () => {
    paneWidth = NARROW;
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(screen.getByRole("button", { name: "Emitters" }));

    expect(screen.queryByText("lifetime")).not.toBeInTheDocument();
  });

  it("keeps the open emitter and its group when the pane narrows to the stack", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    await user.click(cardChip("Position"));
    await screen.findByText("VfxShapeSphere");

    await resizeTo(NARROW);

    expect(screen.getByText("VfxShapeSphere")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "What the inspector draws" }),
    ).not.toBeInTheDocument();
  });
});

describe("A child lane", () => {
  beforeEach(() => {
    paneWidth = WIDE;
    const served = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
      command === "read_vfx_system"
        ? Promise.resolve({ ok: true, value: RESOLVED })
        : served?.(command, args),
    );
  });

  const crumb = () => within(screen.getByRole("navigation", { name: "What the inspector draws" }));

  /** Unfold Glow's child lanes and select the child system's one emitter. */
  async function selectEmber(user: UserEvent) {
    await user.click(await screen.findByRole("button", { name: "Child systems" }));
    await user.click(await screen.findByRole("button", { name: /Ember/, pressed: false }));
    await screen.findByText("particleLinger");
  }

  it("draws its emitter's fields under a banner naming the child system", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");

    await selectEmber(user);

    expect(screen.getByText(CHILD_NAME)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open system" })).toBeEnabled();
    expect(screen.queryByText("CustomMaterial")).not.toBeInTheDocument();
  });

  it("opens the parent's card on the crumb, whichever card was open", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");
    await user.click(await screen.findByRole("button", { name: /Sparks/, pressed: false }));
    expect(crumb().getByRole("button", { name: /Sparks/ })).toBeInTheDocument();

    await selectEmber(user);

    expect(await crumb().findByRole("button", { name: /Ember/ })).toBeInTheDocument();
    expect(crumb().getByRole("button", { name: /Glow/ })).toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Sparks/ })).not.toBeInTheDocument();
  });

  it("leaves the child for its parent from the parent's crumb segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");
    await selectEmber(user);

    await user.click(crumb().getByRole("button", { name: /Glow/ }));

    expect(await screen.findByText("CustomMaterial")).toBeInTheDocument();
    expect(screen.queryByText("particleLinger")).not.toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Ember/ })).not.toBeInTheDocument();
  });

  it("lists the child emitter's animated fields on the curve pane", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");

    await selectEmber(user);

    expect(await screen.findByText("Ember [0] animates")).toBeInTheDocument();
  });

  it("follows the curve pane's field from the parent into the child", async () => {
    renderSystem();
    const user = userEvent.setup();
    const line = within(await fieldRow("rate"));
    await user.click(await line.findByRole("button", { name: "Show curve" }));
    await screen.findByText("Glow [0] . rate");

    await selectEmber(user);

    expect(await screen.findByText("Ember [0] . rate")).toBeInTheDocument();
  });

  it("shows the parent's card open while its child is selected", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");
    await selectEmber(user);

    await fromPanesMenu(user, "Emitters");

    expect(await screen.findByRole("button", { name: /Glow/, pressed: true })).toBeInTheDocument();
  });

  it("names no parent on the crumb once the filter hides it", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");
    await selectEmber(user);

    await user.type(screen.getByRole("textbox", { name: "Filter emitters by name" }), "Spark");

    expect(await crumb().findByRole("button", { name: /Ember/ })).toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Sparks/ })).not.toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Glow/ })).not.toBeInTheDocument();
  });

  it("offers a child row's own menu, without revealing it in this object's Properties", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");
    await selectEmber(user);

    await user.pointer({ keys: "[MouseRight]", target: await fieldRow("rate") });

    expect(await screen.findByRole("menuitem", { name: "Show curve" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Properties/ })).not.toBeInTheDocument();
  });

  it("checks the child's own paths, as the system's rows are checked", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("CustomMaterial");

    await selectEmber(user);

    await waitFor(() => {
      const located = mockInvoke.mock.calls
        .filter(([command]) => command === "locate_game_files")
        .flatMap(([, args]) => (args as { paths: string[] }).paths);
      expect(located).toContain(CHILD_TEXTURE);
    });
  });
});

describe("The shell's panes", () => {
  beforeEach(() => {
    paneWidth = WIDE;
  });

  const paneTab = (name: string) => screen.queryByRole("tab", { name });

  it("draws the preview, the inspector, the timeline and the curve, each in a panel of its own", async () => {
    renderSystem();
    await screen.findByText("lifetime");

    for (const pane of ["Preview", "Inspector", "Timeline", "Curve"]) {
      expect(paneTab(pane)).toBeInTheDocument();
    }
    expect(paneTab("Emitters")).not.toBeInTheDocument();
  });

  it("opens the emitters from the Panes menu, with the strip's cards", async () => {
    renderSystem();
    const user = userEvent.setup();
    await showCards(user);

    expect(await screen.findByRole("tab", { name: "Emitters" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Sparks/ })).toBeInTheDocument();
  });

  it("closes a pane from its own tab", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(screen.getByRole("button", { name: "Close Curve" }));

    expect(paneTab("Curve")).not.toBeInTheDocument();
  });

  it("reopens the preview from the Panes menu", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");
    await fromPanesMenu(user, "Preview");
    expect(paneTab("Preview")).not.toBeInTheDocument();

    await fromPanesMenu(user, "Preview");

    expect(await screen.findByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });

  it("puts every pane back from Reset layout", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");
    await fromPanesMenu(user, "Preview");
    await fromPanesMenu(user, "Curve");

    await fromPanesMenu(user, "Reset layout");

    for (const pane of ["Preview", "Inspector", "Timeline", "Curve"]) {
      expect(await screen.findByRole("tab", { name: pane })).toBeInTheDocument();
    }
  });

  it("keeps the inspector aimed where the crumb left it", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("lifetime");

    await user.click(
      within(screen.getByRole("navigation", { name: "What the inspector draws" })).getByRole(
        "button",
        { name: "Smolder_Base_Idle" },
      ),
    );

    expect(await screen.findByRole("button", { name: "Identity" })).toBeInTheDocument();
    expect(paneTab("Inspector")).toBeInTheDocument();
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
