// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { AssetRef, BinRow, BinRows, BinValue, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { nameHash } from "../binHash";
import { skinLayout } from "../classLayouts";
import { ClassView } from "../ClassView";

const ENTRY = "0x2a1f3c7d";
const SKIN = nameHash("SkinCharacterDataProperties");
const RESOLVER = "0x11223344";
const SYSTEM = "0x99887766";
const EFFECT_KEY = "0xaabbccdd";
const SYSTEM_PATH = "Particles/Smolder_Base_Idle";

const ASSET: AssetRef = {
  kind: "gameChunk",
  wad: "Champions/Smolder.wad.client",
  pathHash: "00aa",
};

const AVATAR = "assets/characters/smolder/skins/base/smolder_avatar.dds";
const LOADSCREEN = "assets/characters/smolder/skins/base/smolder_loadscreen.dds";
const BODY = "assets/characters/smolder/skins/base/smolder_base_tx_cm.dds";
const SIMPLE_SKIN = "ASSETS/Characters/Smolder/Skins/Base/Smolder.skn";

function row(
  entry: string,
  path: string,
  name: string,
  value: BinValue,
  node: BinRow["node"] = "property",
  unnamed = false,
): BinRow {
  return { entry, path, label: name, node, name, unnamed, kind: null, value, declared: null };
}

function field(name: string, value: BinValue): BinRow {
  return row(ENTRY, nameHash(name).slice(2), name, value);
}

const page = (rows: BinRow[]): BinRows => ({ rows, total: rows.length });

const list = (len: number): BinValue => ({ type: "container", len, itemKind: "embed" });
const embed = (className: string, len: number): BinValue => ({
  type: "struct",
  classHash: nameHash(className),
  class: className,
  len,
});
const chunk = (path: string): BinValue => ({ type: "wadChunkLink", hash: "00cc", path });
const link = (hash: string, name: string | null): BinValue => ({ type: "objectLink", hash, name });

const ROOTS: BinRow[] = [
  field("championSkinName", { type: "string", value: "Smolder" }),
  field("iconAvatar", chunk(AVATAR)),
  field("loadscreen", embed("CensoredImage", 1)),
  field("skinMeshProperties", embed("SkinMeshDataProperties", 4)),
  field("skinAnimationProperties", embed("SkinAnimationProperties", 1)),
  field("idleParticlesEffects", list(1)),
  field("mResourceResolver", link(RESOLVER, null)),
  field("skinAudioProperties", embed("SkinAudioProperties", 1)),
  field("healthBarData", embed("CharacterHealthBarDataRecord", 0)),
];

const at = (name: string) => nameHash(name).slice(2);
const MESH = at("skinMeshProperties");
const OVERRIDES = `${MESH}.${at("materialOverride")}`;
const OVERRIDE = `${OVERRIDES}[0]`;
const EFFECTS = at("idleParticlesEffects");
const EFFECT = `${EFFECTS}[0]`;
const RESOURCE_MAP = at("resourceMap");

/** Every page the projected read answers, by the entry and path it was asked under. */
const PAGES: Record<string, BinRows> = {
  [`${ENTRY}:${at("loadscreen")}`]: page([
    row(ENTRY, `${at("loadscreen")}.${at("image")}`, "image", chunk(LOADSCREEN)),
  ]),
  [`${ENTRY}:${MESH}`]: page([
    row(ENTRY, `${MESH}.${at("simpleSkin")}`, "simpleSkin", {
      type: "string",
      value: SIMPLE_SKIN,
    }),
    row(ENTRY, `${MESH}.${at("texture")}`, "texture", chunk(BODY)),
    row(ENTRY, `${MESH}.${at("Material")}`, "Material", link("0x1234abcd", null)),
    row(ENTRY, OVERRIDES, "materialOverride", list(1)),
  ]),
  [`${ENTRY}:${OVERRIDES}`]: page([
    row(ENTRY, OVERRIDE, "[0]", embed("SkinMeshDataProperties_MaterialOverride", 3), "element"),
  ]),
  [`${ENTRY}:${OVERRIDE}`]: page([
    row(ENTRY, `${OVERRIDE}.${at("submesh")}`, "submesh", { type: "string", value: "Body" }),
    row(ENTRY, `${OVERRIDE}.${at("texture")}`, "texture", chunk(BODY)),
  ]),
  [`${ENTRY}:${at("skinAnimationProperties")}`]: page([
    row(
      ENTRY,
      `${at("skinAnimationProperties")}.${at("animationGraphData")}`,
      "animationGraphData",
      link("0x5678ef01", null),
    ),
  ]),
  [`${ENTRY}:${at("skinAudioProperties")}`]: page([
    row(ENTRY, `${at("skinAudioProperties")}.${at("bankUnits")}`, "bankUnits", list(2)),
  ]),
  [`${ENTRY}:${EFFECTS}`]: page([
    row(
      ENTRY,
      EFFECT,
      "[0]",
      embed("SkinCharacterDataProperties_CharacterIdleEffect", 3),
      "element",
    ),
  ]),
  [`${ENTRY}:${EFFECT}`]: page([
    row(ENTRY, `${EFFECT}.${at("effectKey")}`, "effectKey", {
      type: "hash",
      hash: EFFECT_KEY,
      name: null,
    }),
    row(ENTRY, `${EFFECT}.${at("effectName")}`, "effectName", {
      type: "string",
      value: "IdleGlow",
    }),
    row(ENTRY, `${EFFECT}.${at("boneName")}`, "boneName", { type: "string", value: "L_Wing" }),
  ]),
  [`${RESOLVER}:`]: page([
    row(RESOLVER, RESOURCE_MAP, "resourceMap", {
      type: "map",
      len: 1,
      keyKind: "hash",
      valueKind: "link",
    }),
  ]),
  [`${RESOLVER}:${RESOURCE_MAP}`]: page([
    row(
      RESOLVER,
      `${RESOURCE_MAP}{${EFFECT_KEY}}`,
      EFFECT_KEY,
      link(SYSTEM, SYSTEM_PATH),
      "entry",
      true,
    ),
  ]),
};

const DECLARED: Record<string, unknown> = {
  [SYSTEM]: {
    path: SYSTEM_PATH,
    declarations: [
      {
        asset: ASSET,
        file: "Smolder.bin",
        classHash: nameHash("VfxSystemDefinitionData"),
        class: "VfxSystemDefinitionData",
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

function renderSkin() {
  render(
    <ClassView
      document={7}
      asset={ASSET}
      roots={ROOTS}
      classHash={SKIN}
      layout={skinLayout}
      objectName={() => "Characters/Smolder/Skins/Skin0"}
      onNotOpen={() => {}}
      onShowInProperties={vi.fn()}
    />,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_read") {
      const entry = args?.entry as string;
      const paths = (args?.paths ?? []) as string[];
      return Promise.resolve({
        ok: true,
        value: paths.map((path) => PAGES[`${entry}:${path}`] ?? page([])),
      });
    }
    if (command === "locate_game_files") {
      const paths = (args?.paths ?? []) as string[];
      const found = paths.filter((path) => path === SIMPLE_SKIN.toLowerCase());
      return Promise.resolve({
        ok: true,
        value: Object.fromEntries(
          found.map((path) => [
            path,
            { pathHash: "00dd00dd00dd00dd", path, sizeBytes: 1n, wad: ASSET.wad },
          ]),
        ),
      });
    }
    if (command === "declared_objects") {
      const hashes = (args?.objectHashes ?? []) as string[];
      const objects = Object.fromEntries(
        hashes.filter((hash) => hash in DECLARED).map((hash) => [hash, DECLARED[hash]]),
      );
      return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects } });
    }
    return Promise.resolve({ ok: false, error: { code: "UNKNOWN", detail: command } });
  });
});

describe("ClassView over a skin", () => {
  it("draws every section of the layout, in its order", () => {
    renderSkin();

    for (const title of [
      "Identity",
      "Icons",
      "Mesh",
      "Material overrides",
      "Animation",
      "VFX",
      "Audio",
      "Other",
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("draws the identity fields in the cell their own rows draw", () => {
    renderSkin();

    expect(screen.getByDisplayValue("Smolder")).toBeInTheDocument();
  });

  it("names each icon under its own tile, the loadscreen's image included", async () => {
    renderSkin();

    expect(screen.getByText("iconAvatar")).toBeInTheDocument();
    expect(await screen.findByText("loadscreen")).toBeInTheDocument();
  });

  it("holds the preview slot open, with no renderer behind it", () => {
    renderSkin();

    expect(screen.getByRole("img", { name: "Mesh preview" })).toBeInTheDocument();
  });

  it("draws the mesh's own fields and its textures", async () => {
    renderSkin();

    expect(await screen.findByText("simpleSkin")).toBeInTheDocument();
    expect(screen.getAllByText("texture").length).toBeGreaterThan(0);
  });

  it("opens a string path the resolver holds as a chip", async () => {
    renderSkin();

    expect(await screen.findByText(SIMPLE_SKIN.toLowerCase())).toBeInTheDocument();
  });

  it("draws a row per material override, with the submesh it swaps", async () => {
    renderSkin();

    expect(await screen.findByText("Body")).toBeInTheDocument();
  });

  it("carries the system's chip on an effect row, joined through the resolver", async () => {
    renderSkin();

    expect(await screen.findByText(SYSTEM_PATH)).toBeInTheDocument();
    expect(screen.getByText("L_Wing")).toBeInTheDocument();
  });

  it("draws what no section names as a tree of its own", () => {
    renderSkin();

    expect(screen.getByRole("tree", { name: "Other" })).toBeInTheDocument();
  });

  it("reads the resolver through the handle the file is already open on", async () => {
    renderSkin();

    await screen.findByText(SYSTEM_PATH);
    const entries = mockInvoke.mock.calls
      .filter(([command]) => command === "bin_read")
      .map(([, args]) => (args as { entry: string }).entry);

    expect(new Set(entries)).toEqual(new Set([ENTRY, RESOLVER]));
    expect(mockInvoke.mock.calls.some(([command]) => command === "bin_open")).toBe(false);
  });
});
