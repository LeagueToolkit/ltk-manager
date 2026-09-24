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
  DeclaredState,
  VfxSystem,
  VfxValue,
  WorkshopProject,
} from "@/lib/tauri";
import { useWorkshopLayoutStore } from "@/stores";
import { editCall, isEdit } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { assetKey } from "../../../../preview/utils/assetRef";
import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { useWorkshopEditorStore } from "../../../../shell/state/workshopEditor";
import { forgetBinSave } from "../../../../state";
import { CurveDockContext, type CurveTarget } from "../../../curves/state/curveTarget";
import { READ_ROW_CAP } from "../../../documents/hooks/useBinRead";
import { nameHash } from "../../../shared/utils/binHash";
import { emitterLabel } from "../../../vfx/inspector/utils/emitterLabels";
import { vfxLayout } from "../../utils/classLayouts";
import { ClassView } from "../ClassView";

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
  materials: [],
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
  location: "workshop",
  lastOpened: null,
  id: "id-skin",
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

function renderSystem(onShowInProperties = vi.fn(), editable = false) {
  render(
    <ClassView
      document={9}
      asset={ASSET}
      editable={editable}
      roots={ROOTS}
      classHash={SYSTEM}
      layout={vfxLayout}
      objectName={() => "Particles/Smolder_Base_Idle"}
      onNotOpen={() => {}}
      onShowInProperties={onShowInProperties}
    />,
    { wrapper: Providers },
  );
  onTestFinished(() => forgetBinSave(assetKey(ASSET)));

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
  await screen.findByText("Emitter Lifetime");
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
    const cells = screen.getAllByText(emitterLabel(nameHash(name)) ?? name);
    const line = cells.map((cell) => cell.closest<HTMLElement>("[data-row-key]")).find(Boolean);
    if (line == null) throw new Error(name);
    return line;
  });
}

describe("ClassView over a particle system", () => {
  it("searches creator labels, raw names and hashes without writing game data", async () => {
    renderSystem(vi.fn(), true);
    await fieldRow("rate");
    const search = screen.getByRole("textbox", { name: "Search emitter properties" });

    for (const query of ["emission rate", "birthColor", nameHash("rate")]) {
      fireEvent.change(search, { target: { value: query } });
      const name = query === "birthColor" ? "Initial Color" : "Emission Rate";

      expect(await screen.findByText(name)).toBeInTheDocument();
      expect(screen.queryByText("Blend Mode")).not.toBeInTheDocument();
    }

    const constant = await screen.findByDisplayValue("3");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(constant).toHaveFocus();

    fireEvent.change(search, { target: { value: "missing-property" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching properties");

    await userEvent.click(screen.getByRole("button", { name: "Clear property search" }));
    expect(await screen.findByText("Blend Mode")).toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(mockInvoke.mock.calls.some(([command, args]) => isEdit(command, args, "patch"))).toBe(
      false,
    );
  });

  it("restores folded sections after a property search", async () => {
    renderSystem();
    await fieldRow("rate");
    const heading = screen.getByRole("button", { name: "Emission", expanded: true });
    await userEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");

    const search = screen.getByRole("textbox", { name: "Search emitter properties" });
    fireEvent.change(search, { target: { value: "emission rate" } });
    expect(await screen.findByText("Emission Rate")).toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Emission", expanded: false })).toBeInTheDocument();
  });

  it("marks an inspector constant after its declaration is accepted", async () => {
    let declared: DeclaredState = {
      layer: "base",
      module: { kind: "auto" },
      modules: [],
      layers: ["base"],
      marks: [],
      objects: [],
      links: [],
      diagnostics: [],
    };
    const read = mockInvoke.getMockImplementation()!;
    mockInvoke.mockImplementation((command, args) => {
      if (command === "bin_declared") {
        return Promise.resolve({ ok: true, value: declared });
      }

      if (isEdit(command, args, "patch")) {
        declared = {
          ...declared,
          marks: [
            {
              entry: ENTRY,
              path: `${RATE}.${at("constantValue")}`,
              property: "rate.constantValue",
              module: 0,
              moduleName: null,
              sign: "set",
              whole: false,
              reference: null,
              game: "3",
            },
          ],
        };
        return Promise.resolve({ ok: true, value: null });
      }

      return read(command, args);
    });
    renderSystem(vi.fn(), true);
    const field = await screen.findByDisplayValue("3");

    await userEvent.clear(field);
    await userEvent.type(field, "6{Enter}");

    const line = within(await fieldRow("rate"));
    expect(await line.findByRole("img", { name: "Declared in base" })).toBeInTheDocument();
  });

  it("shows declaration diagnostics and reference actions in the inspector", async () => {
    const read = mockInvoke.getMockImplementation()!;
    const declared: DeclaredState = {
      layer: "base",
      module: { kind: "auto" },
      modules: [],
      layers: ["base"],
      marks: [],
      objects: [],
      links: [],
      diagnostics: [
        {
          entry: ENTRY,
          path: `${GLOW}.${at("lifetime")}`,
          layer: "base",
          key: "complexEmitterDefinitionData[0].lifetime",
          kind: "propertyEditSkipped",
          reason: "kindMismatch",
          object: null,
          detail: null,
        },
      ],
    };
    mockInvoke.mockImplementation((command, args) => {
      if (command === "bin_declared") {
        return Promise.resolve({ ok: true, value: declared });
      }

      return read(command, args);
    });
    renderSystem(vi.fn(), true);
    const line = await fieldRow("lifetime");

    expect(
      await within(line).findByRole("img", { name: "1 apply diagnostic" }),
    ).toBeInTheDocument();
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(line).getByText("Emitter Lifetime"),
    });

    expect(await screen.findByRole("menuitem", { name: "Paste reference" })).toBeInTheDocument();
  });

  it("keeps an uneditable inspector's values read-only", async () => {
    renderSystem();
    const line = within(await fieldRow("lifetime"));

    expect(line.getByDisplayValue("2")).toHaveAttribute("readonly");
    expect(await screen.findByDisplayValue("3")).toHaveAttribute("readonly");
  });

  it("patches an inspector leaf, refreshes its reads and queues the document save", async () => {
    const read = mockInvoke.getMockImplementation()!;
    mockInvoke.mockImplementation((command, args) => {
      if (command === "bin_edit" || command === "bin_save") {
        return Promise.resolve({ ok: true, value: null });
      }

      return read(command, args);
    });
    renderSystem(vi.fn(), true);
    const field = within(await fieldRow("lifetime")).getByDisplayValue("2");
    const readsBefore = asked().length;

    await userEvent.clear(field);
    await userEvent.type(field, "4{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(9, {
          kind: "patch",
          entry: ENTRY,
          path: `${GLOW}.${at("lifetime")}`,
          value: { type: "float", value: 4 },
        }),
      ),
    );
    await waitFor(() => expect(asked().length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("bin_save", { document: 9 }), {
      timeout: 2000,
    });
  });

  it("edits a value family's authored constant at its nested address", async () => {
    renderSystem(vi.fn(), true);
    const search = await screen.findByRole("textbox", { name: "Search emitter properties" });
    fireEvent.change(search, { target: { value: "emission rate" } });
    const field = await screen.findByDisplayValue("3");

    await userEvent.clear(field);
    await userEvent.type(field, "6{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(9, {
          kind: "patch",
          entry: ENTRY,
          path: `${RATE}.${at("constantValue")}`,
          value: { type: "float", value: 6 },
        }),
      ),
    );
  });

  it("authors emitter linger from its placeholder, reloads the value and queues a save", async () => {
    const linger = `${GLOW}.${at("emitterLinger")}`;
    const read = mockInvoke.getMockImplementation()!;
    let saved = false;

    mockInvoke.mockImplementation((command, args) => {
      if (command === "class_schema") {
        return Promise.resolve({
          ok: true,
          value: {
            ...SCHEMA,
            fields: [
              ...SCHEMA.fields,
              {
                hash: nameHash("period"),
                name: "period",
                declared: { kind: "f32", key: null, value: null },
                classHash: null,
                defaultValue: "0",
                revisions: [],
              },
              {
                hash: nameHash("emitterLinger"),
                name: "emitterLinger",
                declared: { kind: "option", key: null, value: "f32" },
                classHash: null,
                defaultValue: "0",
                revisions: [],
              },
            ],
          },
        });
      }

      if (isEdit(command, args, "editProperty")) {
        saved = true;
        return Promise.resolve({ ok: true, value: null });
      }

      if (command === "bin_save") {
        return Promise.resolve({ ok: true, value: null });
      }

      if (command === "bin_read" && saved) {
        const paths = args?.paths as string[];
        return Promise.resolve({
          ok: true,
          value: paths.map((path) => {
            if (path === GLOW) {
              return page([
                ...PAGES[GLOW].rows,
                row(linger, "emitterLinger", { type: "optional", itemKind: "f32", present: true }),
              ]);
            }

            if (path === linger) {
              return page([row(`${linger}[0]`, "[0]", { type: "float", value: 2.5 }, "element")]);
            }

            return PAGES[path] ?? page([]);
          }),
        });
      }

      return read(command, args);
    });
    renderSystem(vi.fn(), true);
    const input = within(await fieldRow("emitterLinger")).getByPlaceholderText("0");
    const period = within(await fieldRow("period")).getByPlaceholderText("0");
    const emission = section("Emission").closest("section")!;
    const rowOrder = () =>
      Array.from(
        emission.querySelectorAll<HTMLElement>("[data-row-key]"),
        (row) => row.dataset.rowKey,
      );
    const orderBeforeEdit = rowOrder();
    expect(input).toHaveValue("");
    expect(
      mockInvoke.mock.calls.some(([command, args]) => isEdit(command, args, "editProperty")),
    ).toBe(false);

    await userEvent.type(input, "2.5{Enter}");
    expect(mockInvoke).toHaveBeenCalledWith(
      ...editCall(9, {
        kind: "editProperty",
        entry: ENTRY,
        holder: GLOW,
        field: nameHash("emitterLinger"),
        edits: [{ type: "setLeaf", path: "[0]", value: { type: "float", value: 2.5 } }],
      }),
    );
    expect(await screen.findByDisplayValue("2.5")).not.toHaveAttribute("placeholder");
    expect(rowOrder()).toEqual(orderBeforeEdit);
    expect(within(await fieldRow("period")).getByPlaceholderText("0")).toBe(period);
    expect(section("Emission")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("bin_save", { document: 9 }), {
      timeout: 2000,
    });
  });

  it("keeps a stable value mode control beside the editable constant", async () => {
    renderSystem(vi.fn(), true);
    const line = within(await fieldRow("rate"));
    const constant = await line.findByDisplayValue("3");
    const mode = await line.findByRole("group", { name: "Value mode" });

    expect(within(mode).getByRole("button", { name: "Edit curve" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(mode).getByRole("button", { name: "Use constant value" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(mode.parentElement).toContainElement(constant);
  });

  it("offers curve activation beside an authored constant value", async () => {
    renderSystem(vi.fn(), true);

    const velocity = within(await fieldRow("velocity"));
    expect(await velocity.findByRole("button", { name: "Animate value" })).toBeInTheDocument();
  });

  it("switches an animated property back to its authored constant", async () => {
    const read = mockInvoke.getMockImplementation()!;
    let constant = false;

    mockInvoke.mockImplementation((command, args) => {
      if (isEdit(command, args, "setPointer")) {
        constant = true;
        return Promise.resolve({ ok: true, value: null });
      }

      if (command === "bin_read" && constant) {
        const paths = (args?.paths ?? []) as string[];
        const constantRate = page([
          row(`${RATE}.${at("constantValue")}`, "constantValue", { type: "float", value: 3 }),
          row(RATE_CURVE, "dynamics", { type: "null" }),
        ]);

        return Promise.resolve({
          ok: true,
          value: paths.map((path) => (path === RATE ? constantRate : (PAGES[path] ?? page([])))),
        });
      }

      return read(command, args);
    });

    renderSystem(vi.fn(), true);
    const rate = within(await fieldRow("rate"));

    await userEvent.click(await rate.findByRole("button", { name: "Use constant value" }));

    expect(mockInvoke).toHaveBeenCalledWith(
      ...editCall(9, {
        kind: "setPointer",
        entry: ENTRY,
        path: RATE_CURVE,
        className: null,
      }),
    );
    expect(
      mockInvoke.mock.calls.some(([command, args]) => isEdit(command, args, "removeProperty")),
    ).toBe(false);
    await waitFor(() =>
      expect(rate.getByRole("button", { name: "Use constant value" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("aligns scalar and vector properties in label and value columns", async () => {
    renderSystem(vi.fn(), true);
    const rate = await fieldRow("rate");
    const colour = await fieldRow("birthColor");
    const lifetime = await fieldRow("lifetime");

    expect(rate).not.toHaveClass("flex-col");
    expect(colour).not.toHaveClass("flex-col");
    expect(lifetime).not.toHaveClass("flex-col");
    expect(within(rate).getByText("Emission Rate")).toBeInTheDocument();
    expect(await within(rate).findByDisplayValue("3")).toBeInTheDocument();
  });

  it("uses compact numeric fields and one separator per inspector group", async () => {
    renderSystem(vi.fn(), true);
    const rate = await fieldRow("rate");
    const colour = await fieldRow("birthColor");
    const group = rate.closest("section")!;
    const density = rate.closest<HTMLElement>("[style]")!;

    expect(group).toHaveClass("border-t");
    expect(group).not.toHaveClass("gap-1", "py-1");
    expect(rate).not.toHaveClass("border-b", "py-0.5");
    expect(density.style.getPropertyValue("--readout-height")).toBe("1.25rem");
    expect(density.style.getPropertyValue("--bin-scalar-width")).toBe("5rem");
    expect(density.style.getPropertyValue("--bin-component-width")).toBe("4rem");
    expect(await within(rate).findByDisplayValue("3")).toHaveClass(
      "w-[var(--bin-scalar-width,8rem)]",
    );
    expect(await within(colour).findByRole("textbox", { name: "x" })).toHaveClass(
      "w-[var(--bin-component-width,6rem)]",
    );
  });

  it("edits a colour constant without changing its other channels", async () => {
    renderSystem(vi.fn(), true);
    const line = within(await fieldRow("birthColor"));
    const field = await line.findByRole("textbox", { name: "x" });

    await userEvent.clear(field);
    await userEvent.type(field, "0.5{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(9, {
          kind: "patch",
          entry: ENTRY,
          path: `${BIRTH_COLOR}.${at("constantValue")}`,
          value: { type: "vector", values: [0.5, 0, 0, 1] },
        }),
      ),
    );
  });

  it("rejects invalid numeric text without writing to the document", async () => {
    renderSystem(vi.fn(), true);
    const field = within(await fieldRow("lifetime")).getByDisplayValue("2");

    await userEvent.clear(field);
    await userEvent.type(field, "NaN{Enter}");

    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(mockInvoke.mock.calls.some(([command, args]) => isEdit(command, args, "patch"))).toBe(
      false,
    );
  });

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

  it("lists authored groups and groups supplied by schema defaults", async () => {
    renderSystem();

    await screen.findAllByText("Glow");
    for (const group of ["Emission", "Birth", "Position", "Texture", "Render", "Material"]) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    }
    expect(await screen.findByText("Scale")).toBeInTheDocument();
    expect(screen.queryByText("Effects")).not.toBeInTheDocument();
  });

  it("opens on the first emitter's first group", async () => {
    renderSystem();

    expect(await screen.findByText("Emitter Lifetime")).toBeInTheDocument();
  });

  it("leaves every group drawn when a chip picks one, because picking scrolls rather than filters", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");

    await user.click(cardChip("Position"));

    expect(await screen.findByText("Spawn Shape")).toBeInTheDocument();
    expect(screen.getByText("Emitter Lifetime")).toBeInTheDocument();
    expect(screen.getByText("Blend Mode")).toBeInTheDocument();
  });

  it("draws every group the emitter sets at once, each a section of its own", async () => {
    renderSystem();
    await screen.findByText("Emitter Lifetime");

    expect(screen.getByText("Spawn Shape")).toBeInTheDocument();
    expect(screen.getByText("Blend Mode")).toBeInTheDocument();
  });

  it("folds a section from its own header", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");

    await user.click(section("Emission"));

    expect(screen.queryByText("Emitter Lifetime")).toBeNull();
    expect(screen.getByText("Blend Mode")).toBeInTheDocument();
  });

  it("reads no row of a folded section, and reads them once it opens", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");

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

  it("marks the curve mode of a panel row whose dynamics points at one", async () => {
    renderSystem();
    const rate = within(await fieldRow("rate"));

    expect(await rate.findByRole("button", { name: "Edit curve" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks a value whose curve the panel has not read", async () => {
    renderSystem();
    const user = userEvent.setup();

    const [birth] = await screen.findAllByRole("button", { name: "Birth" });
    await user.click(birth as HTMLElement);

    const color = within(await fieldRow("birthColor"));
    expect(await color.findByRole("button", { name: "Edit curve" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    await screen.findByText("Spawn Shape");
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
    const user = userEvent.setup();
    renderSystem();
    await showTable(user);

    expect(screen.getByText("Emitter Name")).toBeInTheDocument();
    expect(screen.getByText("Spawn Shape")).toBeInTheDocument();

    await user.hover(screen.getByText("Initial Color"));
    const card = await screen.findByRole("tooltip", { name: "Initial Color" }, { timeout: 2000 });
    expect(within(card).getByText("birthColor")).toBeInTheDocument();
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
    await screen.findByText("Emitter Lifetime");

    expect(crumb().getByRole("button", { name: "Smolder_Base_Idle" })).toBeInTheDocument();
    expect(crumb().getByRole("button", { name: /Glow/ })).toBeInTheDocument();
    expect(crumb().getByRole("button", { name: "Emission" })).toBeInTheDocument();
  });

  it("draws the system's own sections from the crumb's first segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");
    expect(screen.queryByRole("button", { name: "Identity" })).not.toBeInTheDocument();

    await user.click(crumb().getByRole("button", { name: "Smolder_Base_Idle" }));

    for (const title of ["Identity", "Audio", "Other"]) {
      expect(await screen.findByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("draws every group the emitter sets from the crumb's second segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");

    await user.click(crumb().getByRole("button", { name: /Glow/ }));

    expect(await screen.findByText("Emitter Lifetime")).toBeInTheDocument();
    expect(screen.getByText("Spawn Shape")).toBeInTheDocument();
    expect(await fieldRow("texture")).toBeInTheDocument();
  });

  it("opens a menu of that emitter's groups on the crumb's last segment", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");

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
    await screen.findByText("Emitter Lifetime");
    scrolled.mockClear();

    await user.click(crumb().getByRole("button", { name: "Emission" }));
    await user.click(await screen.findByRole("menuitem", { name: "Emission" }));

    expect(scrolled.mock.contexts).toContain(section("Emission").closest("section"));
  });

  it("holds the crumb's group segment still while the pane scrolls", async () => {
    renderSystem();
    await screen.findByText("Emitter Lifetime");
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
    expect(await screen.findByText("Blend Mode")).toBeInTheDocument();
  });

  it("holds a place for the curve before a mark targets it", async () => {
    renderSystem();
    await screen.findByText("Emitter Lifetime");

    expect(screen.getByRole("tab", { name: "Curve" })).toBeInTheDocument();
    expect(screen.getByText("No value targeted")).toBeInTheDocument();
  });

  it("draws the curve of the row a sparkline targets, named by its chain and its path", async () => {
    renderSystem();
    const user = userEvent.setup();
    const line = within(await fieldRow("rate"));

    await user.click(await line.findByRole("button", { name: "Edit curve" }));

    expect(await screen.findByText("Glow [0] . rate")).toBeInTheDocument();
    expect(screen.getByText(RATE)).toBeInTheDocument();
    expect(screen.queryByText("No value targeted")).not.toBeInTheDocument();
  });

  it("lists the emitter's animated fields while nothing targets the pane, and aims from one", async () => {
    renderSystem();
    const user = userEvent.setup();
    await within(await fieldRow("rate")).findByRole("button", { name: "Edit curve" });
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
    await user.click(await line.findByRole("button", { name: "Edit curve" }));
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
    expect(await screen.findByText("Radius")).toBeInTheDocument();

    const [sparks] = await screen.findAllByRole("button", { name: /Sparks/ });
    await user.click(sparks as HTMLElement);

    expect(await screen.findByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Radius")).not.toBeInTheDocument();
  });

  it("aims the menu at a row under an opened struct, and checks the links it holds", async () => {
    const onShowInProperties = renderSystem();
    const user = userEvent.setup();
    await showCards(user);
    const shape = within(await fieldRow("SpawnShape"));
    await user.click(shape.getByRole("button", { name: "Show fields", expanded: false }));
    const radius = await screen.findByText("Radius");

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
    await user.click(await line.findByRole("button", { name: "Edit curve" }));
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

    expect(await animated.findByRole("button", { name: "Edit curve" })).toBeInTheDocument();
    expect(
      await animated.findByRole("button", { name: "Show what is random" }),
    ).toBeInTheDocument();
    expect(flat.queryByRole("button", { name: "Edit curve" })).toBeNull();
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

  it("keeps unauthored fields in collapsed sections without requiring a Defaults switch", async () => {
    renderSystem();
    await screen.findByText("Emitter Lifetime");
    expect(section("Scale", false)).toBeInTheDocument();
    expect(screen.queryByText("Scale over Lifetime")).not.toBeInTheDocument();
    await userEvent.click(section("Scale", false));
    expect(await screen.findByText("Scale over Lifetime")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Defaults" })).toBeNull();
  });

  it("collapses authored constructor values while leaving changed and unknown sections open", async () => {
    const read = mockInvoke.getMockImplementation()!;
    mockInvoke.mockImplementation((command, args) => {
      if (command === "class_schema") {
        return Promise.resolve({
          ok: true,
          value: {
            ...SCHEMA,
            fields: [
              ...SCHEMA.fields,
              {
                hash: nameHash("blendMode"),
                name: "blendMode",
                declared: { kind: "u8", key: null, value: null },
                classHash: null,
                defaultValue: "1",
                revisions: [],
              },
            ],
          },
        });
      }

      return read(command, args);
    });
    renderSystem();
    await screen.findByText("Emitter Lifetime");

    await waitFor(() => expect(section("Render", false)).toBeInTheDocument());
    expect(section("Emission")).toBeInTheDocument();
    expect(section("Position")).toBeInTheDocument();
    expect(screen.queryByText("Blend Mode")).not.toBeInTheDocument();

    await userEvent.click(section("Render", false));
    expect(await screen.findByText("Blend Mode")).toBeInTheDocument();
    expect(mockInvoke.mock.calls.some(([command, args]) => isEdit(command, args, "patch"))).toBe(
      false,
    );
  });

  it("reveals default-only sections during search and preserves an explicit expansion", async () => {
    renderSystem();
    await screen.findByText("Emitter Lifetime");
    const search = screen.getByRole("textbox", { name: "Search emitter properties" });
    expect(section("Scale", false)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "scale0" } });
    expect(await screen.findByText("Scale over Lifetime")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(section("Scale", false)).toBeInTheDocument();

    await userEvent.click(section("Scale", false));
    fireEvent.change(search, { target: { value: "birthColor" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(section("Scale")).toBeInTheDocument();
    expect(screen.getByText("Scale over Lifetime")).toBeInTheDocument();
  });

  it("offers Show curve on a row with dynamics and on no row without", async () => {
    renderSystem();
    const user = userEvent.setup();

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("Emission Rate") });
    expect(await screen.findByRole("menuitem", { name: "Show curve" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Emitter Lifetime") });

    expect(screen.queryByRole("menuitem", { name: "Show curve" })).not.toBeInTheDocument();
  });

  it("sends a cell of the inspector its own key, for the tree to reveal", async () => {
    const onShowInProperties = renderSystem();
    const user = userEvent.setup();
    const cell = await screen.findByText("Emitter Lifetime");

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
    await screen.findByText("Emitter Lifetime");

    await user.click(screen.getByRole("button", { name: "Emitters" }));

    expect(screen.queryByText("Emitter Lifetime")).not.toBeInTheDocument();
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
    await screen.findByText("Particle Linger");
  }

  it("draws its emitter's fields under a banner naming the child system", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");

    await selectEmber(user);

    expect(screen.getByText(CHILD_NAME)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open system" })).toBeEnabled();
    expect(screen.queryByText("Custom Material")).not.toBeInTheDocument();
  });

  it("opens the parent's card on the crumb, whichever card was open", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");
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
    await screen.findByText("Custom Material");
    await selectEmber(user);

    await user.click(crumb().getByRole("button", { name: /Glow/ }));

    expect(await screen.findByText("Custom Material")).toBeInTheDocument();
    expect(screen.queryByText("particleLinger")).not.toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Ember/ })).not.toBeInTheDocument();
  });

  it("lists the child emitter's animated fields on the curve pane", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");

    await selectEmber(user);

    expect(await screen.findByText("Ember [0] animates")).toBeInTheDocument();
  });

  it("follows the curve pane's field from the parent into the child", async () => {
    renderSystem();
    const user = userEvent.setup();
    const line = within(await fieldRow("rate"));
    await user.click(await line.findByRole("button", { name: "Edit curve" }));
    await screen.findByText("Glow [0] . rate");

    await selectEmber(user);

    expect(await screen.findByText("Ember [0] . rate")).toBeInTheDocument();
  });

  it("shows the parent's card open while its child is selected", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");
    await selectEmber(user);

    await fromPanesMenu(user, "Emitters");

    expect(await screen.findByRole("button", { name: /Glow/, pressed: true })).toBeInTheDocument();
  });

  it("names no parent on the crumb once the filter hides it", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");
    await selectEmber(user);

    await user.type(screen.getByRole("textbox", { name: "Filter emitters by name" }), "Spark");

    expect(await crumb().findByRole("button", { name: /Ember/ })).toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Sparks/ })).not.toBeInTheDocument();
    expect(crumb().queryByRole("button", { name: /Glow/ })).not.toBeInTheDocument();
  });

  it("offers a child row's own menu, without revealing it in this object's Properties", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");
    await selectEmber(user);

    await user.pointer({ keys: "[MouseRight]", target: await fieldRow("rate") });

    expect(await screen.findByRole("menuitem", { name: "Show curve" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Properties/ })).not.toBeInTheDocument();
  });

  it("checks the child's own paths, as the system's rows are checked", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Custom Material");

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
    await screen.findByText("Emitter Lifetime");

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
    await screen.findByText("Emitter Lifetime");

    await user.click(screen.getByRole("button", { name: "Close Curve" }));

    expect(paneTab("Curve")).not.toBeInTheDocument();
  });

  it("reopens the preview from the Panes menu", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");
    await fromPanesMenu(user, "Preview");
    expect(paneTab("Preview")).not.toBeInTheDocument();

    await fromPanesMenu(user, "Preview");

    expect(await screen.findByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });

  it("puts every pane back from Reset layout", async () => {
    renderSystem();
    const user = userEvent.setup();
    await screen.findByText("Emitter Lifetime");
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
    await screen.findByText("Emitter Lifetime");

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

it("keeps the shell mounted while a hidden document reports zero width", async () => {
  paneWidth = WIDE;
  renderSystem();
  await screen.findByText("Emitter Lifetime");
  const shell = document.querySelector('[data-ui="ClassView:shell"]');
  expect(shell).not.toBeNull();
  await resizeTo(0);
  expect(document.querySelector('[data-ui="ClassView:shell"]')).toBe(shell);
  await resizeTo(WIDE);
  expect(document.querySelector('[data-ui="ClassView:shell"]')).toBe(shell);
});
