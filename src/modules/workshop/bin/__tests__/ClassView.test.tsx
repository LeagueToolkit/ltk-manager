// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { AssetRef, BinRow, BinRows, BinValue, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { nameHash } from "../binHash";
import { materialLayout } from "../classLayouts";
import { ClassView } from "../ClassView";

const ENTRY = "0x2a1f3c7d";
const MATERIAL = nameHash("StaticMaterialDef");
const ASSET: AssetRef = {
  kind: "gameChunk",
  wad: "Champions/Ezreal.wad.client",
  pathHash: "00aa",
};

const TEXTURE = "assets/characters/ezreal/skins/base/ezreal_base_tx_cm.dds";

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

function field(name: string, value: BinValue): BinRow {
  return row(nameHash(name).slice(2), name, value);
}

function page(rows: BinRow[]): BinRows {
  return { rows, total: rows.length };
}

const list = (len: number): BinValue => ({ type: "container", len, itemKind: "embed" });
const embed = (className: string, len: number): BinValue => ({
  type: "struct",
  classHash: nameHash(className),
  class: className,
  len,
});

const ROOTS: BinRow[] = [
  field("name", { type: "string", value: "Ezreal_Base_Mat" }),
  field("type", { type: "integer", text: "1" }),
  field("samplerValues", list(1)),
  field("paramValues", list(1)),
  field("switches", list(0)),
  field("shaderMacros", { type: "map", len: 1, keyKind: "string", valueKind: "string" }),
  field("dynamicMaterial", { type: "null" }),
];

/** The one element of each table section, addressed under its container's own path. */
const SAMPLER_PATH = `${nameHash("samplerValues").slice(2)}[0]`;
const PARAM_PATH = `${nameHash("paramValues").slice(2)}[0]`;

const ELEMENTS: Record<string, BinRows> = {
  [nameHash("samplerValues").slice(2)]: page([
    row(SAMPLER_PATH, "[0]", embed("StaticMaterialShaderSamplerDef", 8), "element"),
  ]),
  [nameHash("paramValues").slice(2)]: page([
    row(PARAM_PATH, "[0]", embed("StaticMaterialShaderParamDef", 2), "element"),
  ]),
  [nameHash("switches").slice(2)]: page([]),
};

const FIELDS: Record<string, BinRows> = {
  [SAMPLER_PATH]: page([
    row(`${SAMPLER_PATH}.${nameHash("TextureName").slice(2)}`, "TextureName", {
      type: "string",
      value: "Diffuse_Texture",
    }),
    row(`${SAMPLER_PATH}.${nameHash("texturePath").slice(2)}`, "texturePath", {
      type: "wadChunkLink",
      hash: "00cc",
      path: TEXTURE,
    }),
    row(`${SAMPLER_PATH}.${nameHash("addressU").slice(2)}`, "addressU", {
      type: "integer",
      text: "1",
    }),
    row(`${SAMPLER_PATH}.${nameHash("filterMag").slice(2)}`, "filterMag", {
      type: "integer",
      text: "2",
    }),
  ]),
  [PARAM_PATH]: page([
    row(`${PARAM_PATH}.${nameHash("name").slice(2)}`, "name", {
      type: "string",
      value: "Fresnel_Power",
    }),
    row(`${PARAM_PATH}.${nameHash("value").slice(2)}`, "value", {
      type: "vector",
      values: [4, 0, 0, 0],
    }),
  ]),
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

function renderView(onShowInProperties = vi.fn()) {
  render(
    <ClassView
      document={7}
      asset={ASSET}
      roots={ROOTS}
      classHash={MATERIAL}
      layout={materialLayout}
      objectName={() => "Characters/Ezreal/Skins/Base/Materials/Ezreal_Base_Mat"}
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
      const answered = paths.map((path) => ELEMENTS[path] ?? FIELDS[path] ?? page([]));
      return Promise.resolve({ ok: true, value: answered });
    }
    if (command === "locate_game_files") return Promise.resolve({ ok: true, value: {} });
    if (command === "declared_objects") {
      return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects: {} } });
    }
    return Promise.resolve({ ok: false, error: { code: "UNKNOWN", detail: command } });
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

describe("ClassView", () => {
  it("draws every section of the layout, in its order", async () => {
    renderView();

    for (const title of ["Identity", "Samplers", "Params", "Switches", "Macros", "Techniques"]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Other" })).toBeInTheDocument();
  });

  /* The tree's own rows are virtualized, which a zero-height test viewport draws none
     of. What this asserts is that Other is drawn by a tree over the rows left. */
  it("draws what the layout does not name as a tree of its own", () => {
    renderView();

    expect(screen.getByRole("tree", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "Macros" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "Techniques" })).toBeNull();
  });

  it("shows None under a section whose list is empty", () => {
    renderView();

    expect(screen.getAllByText("None").length).toBeGreaterThan(0);
  });

  it("draws the identity fields in the cell their own rows draw", () => {
    renderView();

    expect(screen.getByDisplayValue("Ezreal_Base_Mat")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
  });

  it("reads its tables through the projected read, one call per level", async () => {
    renderView();

    await waitFor(() => expect(screen.getByText("Diffuse_Texture")).toBeInTheDocument());

    const reads = mockInvoke.mock.calls.filter(([command]) => command === "bin_read");
    expect(reads).toHaveLength(2);
    expect(reads[0]?.[1]).toMatchObject({ entry: ENTRY, paths: Object.keys(ELEMENTS).sort() });
    expect(reads[1]?.[1]).toMatchObject({ entry: ENTRY, paths: [SAMPLER_PATH, PARAM_PATH].sort() });
  });

  it("draws a sampler's name, its path and its modes", async () => {
    renderView();

    expect(await screen.findByText("Diffuse_Texture")).toBeInTheDocument();
    expect(screen.getByText(TEXTURE)).toBeInTheDocument();
    expect(screen.getByLabelText("U")).toHaveValue("1");
    expect(screen.getByLabelText("Mag")).toHaveValue("2");
  });

  it("draws a param's name and its four numbers", async () => {
    renderView();

    expect(await screen.findByText("Fresnel_Power")).toBeInTheDocument();
    expect(screen.getByLabelText("x")).toHaveValue("4");
  });

  it("sends a cell's Show in properties the cell's own key, not its element's", async () => {
    const onShowInProperties = renderView();
    const user = userEvent.setup();

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText(TEXTURE) });
    await user.click(await screen.findByRole("menuitem", { name: "Show in properties" }));

    expect(onShowInProperties).toHaveBeenCalledWith(
      `${ENTRY}:${SAMPLER_PATH}.${nameHash("texturePath").slice(2)}`,
    );
  });

  it("copies a cell's own path, which is the address of the node under it", async () => {
    renderView();
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText(TEXTURE) });
    await user.click(await screen.findByRole("menuitem", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(
      "Characters/Ezreal/Skins/Base/Materials/Ezreal_Base_Mat:texturePath",
    );
  });
});
