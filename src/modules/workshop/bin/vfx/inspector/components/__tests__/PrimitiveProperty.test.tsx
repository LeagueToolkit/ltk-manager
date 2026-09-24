// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BinRow, FieldSchema } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { FieldLabelsContext } from "../../../../classes/state/fieldLabels";
import { nameHash } from "../../../../shared/utils/binHash";
import { LeafEditContext } from "../../../../tree/hooks/useLeafEdit";
import { RowDocumentContext } from "../../../../tree/state/rowFold";
import { rowKey } from "../../../../tree/utils/binRows";
import type { DefaultField } from "../../utils/emitterGroups";
import { emitterLabel } from "../../utils/emitterLabels";
import { PRIMITIVE_FIELD } from "../../utils/primitives";
import { PrimitiveProperty } from "../PrimitiveProperty";

const MESH = nameHash("VfxPrimitiveMesh");
const QUAD = nameHash("VfxPrimitiveArbitraryQuad");
const MESH_DEFINITION = nameHash("VfxMeshDefinitionData");
const MESH_FIELD = nameHash("mMesh");
const MESH_NAME = nameHash("mMeshName");
const ALIGN_YAW = nameHash("AlignYawToCamera");

function schemaField(name: string, declared: FieldSchema["declared"], extra = {}): FieldSchema {
  return {
    hash: nameHash(name),
    name,
    declared,
    classHash: null,
    defaultValue: null,
    revisions: [],
    ...extra,
  };
}

const SCHEMAS: Record<string, { name: string; fields: FieldSchema[] }> = {
  [MESH]: {
    name: "VfxPrimitiveMesh",
    fields: [
      schemaField(
        "AlignYawToCamera",
        { kind: "bool", key: null, value: null },
        {
          defaultValue: "false",
        },
      ),
      schemaField(
        "mMesh",
        { kind: "embed", key: null, value: null },
        {
          classHash: MESH_DEFINITION,
        },
      ),
    ],
  },
  [MESH_DEFINITION]: {
    name: "VfxMeshDefinitionData",
    fields: [
      schemaField(
        "mMeshName",
        { kind: "string", key: null, value: null },
        {
          defaultValue: '"ASSETS/default.scb"',
        },
      ),
    ],
  },
};

const reads = new Map<string, BinRow[]>();

vi.mock("../../../../classes/hooks/useClassSchema", () => ({
  useClassSchema: (classHash: string | null) => ({
    data: classHash === null ? undefined : SCHEMAS[classHash],
  }),
}));
vi.mock("../../../../documents/hooks/useBinRead", () => ({
  useBinRead: (_document: number, requests: readonly { key: string }[]) =>
    new Map(requests.map(({ key }) => [key, { rows: reads.get(key) ?? [] }])),
}));
vi.mock("../../../../classes/components/ClassCells", async (original) => ({
  ...(await original<typeof import("../../../../classes/components/ClassCells")>()),
  AlsoCheck: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../../../documents/components/DeclaredLayer", () => ({
  DeclaredRowState: () => null,
  DeclaredRowMark: () => null,
  DeclaredDiagnosticsMark: () => null,
}));

afterEach(cleanup);
beforeEach(() => {
  mockInvoke.mockReset();
  reads.clear();
});

const holder: BinRow = {
  entry: "0x00000001",
  path: "00000002[0]",
  label: "emitters[0]",
  name: "[0]",
  node: "element",
  unnamed: false,
  kind: "embed",
  declared: null,
  value: { type: "struct", classHash: "0x09cde442", class: "VfxEmitterDefinitionData", len: 0 },
};

const field: DefaultField = {
  hash: PRIMITIVE_FIELD,
  name: "primitive",
  declared: { kind: "pointer", key: null, value: null },
  classHash: nameHash("VfxLegacyPrimitiveBase"),
  defaultValue: "null",
};

function primitiveRow(classHash: string, name: string, len: number): BinRow {
  return {
    entry: holder.entry,
    path: `${holder.path}.${PRIMITIVE_FIELD.slice(2)}`,
    label: `${holder.label}.primitive`,
    name: "primitive",
    node: "property",
    unnamed: false,
    kind: "pointer",
    declared: null,
    value: { type: "struct", classHash, class: name, len },
  };
}

function mount(authored?: BinRow) {
  const commit = vi.fn();
  const editProperty = vi.fn().mockResolvedValue(true);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <LeafEditContext value={{ commit, editProperty, refused: new Map() }}>
        <RowDocumentContext value={1}>
          <FieldLabelsContext value={emitterLabel}>
            <PrimitiveProperty
              field={field}
              holder={holder}
              authored={authored}
              width="w-32"
              owner="0x09cde442"
            />
          </FieldLabelsContext>
        </RowDocumentContext>
      </LeafEditContext>
    </QueryClientProvider>,
  );

  return { editProperty };
}

describe("the primitive picker", () => {
  it("reads an emitter naming none as a camera quad, and gives it the class picked", async () => {
    const { editProperty } = mount();
    const picker = screen.getByRole("combobox", { name: "Render Primitive" });
    expect(picker).toHaveTextContent("Camera quad");
    expect(screen.getByRole("img", { name: "Sketch of Camera quad" })).toBeInTheDocument();

    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: /^Mesh/ }));

    expect(editProperty).toHaveBeenCalledWith(holder, PRIMITIVE_FIELD, [
      { type: "replacePointer", path: "", class: MESH },
    ]);
  });

  it("clears a held primitive with Not set", async () => {
    const authored = primitiveRow(QUAD, "VfxPrimitiveArbitraryQuad", 0);
    const { editProperty } = mount(authored);
    const picker = screen.getByRole("combobox", { name: "Render Primitive" });
    expect(picker).toHaveTextContent("Arbitrary quad");

    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: /^Not set/ }));

    expect(editProperty).toHaveBeenCalledWith(holder, PRIMITIVE_FIELD, [
      { type: "replacePointer", path: "", class: null },
    ]);
  });
});

describe("the primitive's fields", () => {
  it("draws the held fields and writes an absent embed's field through on its first edit", async () => {
    const authored = primitiveRow(MESH, "VfxPrimitiveMesh", 1);
    reads.set(rowKey(authored), [
      {
        entry: holder.entry,
        path: `${authored.path}.${ALIGN_YAW.slice(2)}`,
        label: `${authored.label}.AlignYawToCamera`,
        name: "AlignYawToCamera",
        node: "property",
        unnamed: false,
        kind: "bool",
        declared: null,
        value: { type: "bool", value: true },
      },
    ]);
    const { editProperty } = mount(authored);

    expect(screen.getByText("Align Yaw To Camera")).toBeInTheDocument();
    expect(screen.getByText("VfxMeshDefinitionData")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("ASSETS/default.scb");

    await userEvent.type(input, "ASSETS/orb.scb{Enter}");

    expect(editProperty).toHaveBeenCalledWith(authored, MESH_FIELD, [
      { type: "ensureProperty", path: "", field: MESH_NAME },
      {
        type: "setLeaf",
        path: MESH_NAME.slice(2),
        value: { type: "string", value: "ASSETS/orb.scb" },
      },
    ]);
  });
});
