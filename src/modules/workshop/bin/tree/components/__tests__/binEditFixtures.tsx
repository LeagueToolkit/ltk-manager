// Shared by the edit suites of an editable bin tree.

import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { ToastProvider } from "@/components";
import type { AssetRef, BinDocumentId, BinRow, WorkshopProject } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { BinEditContext, type TreeFocus, useBinEditor } from "../../hooks/useBinEdit";
import type { RowLine } from "../../utils/binRows";
import { BinRowLine } from "../BinRow";

export const ENTRY = "0x2a1f3c7d";
export const DOCUMENT = 3 as BinDocumentId;
export const ASSET: AssetRef = {
  kind: "layer",
  project: "C:/mods/skin",
  layer: "base",
  path: "data/skin0.bin",
};

export function row(overrides: Partial<BinRow>): BinRow {
  return {
    entry: ENTRY,
    path: "0000000a",
    label: "scale",
    node: "property",
    name: "scale",
    unnamed: false,
    kind: "f32",
    value: { type: "float", value: 1.5 },
    declared: null,
    ...overrides,
  };
}

/* A chip opens what it names inside the project it is mounted in. */
export const PROJECT: WorkshopProject = {
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

export const NO_FOCUS: TreeFocus = {
  key: null,
  settle: () => {},
  addTo: () => {},
  to: () => {},
  insertAt: () => {},
  closeInsert: () => {},
  reach: () => {},
  remap: () => {},
};

function Editable({ focus, children }: { focus: TreeFocus; children: ReactNode }) {
  const edit = useBinEditor(DOCUMENT, ASSET, true, focus);
  return <BinEditContext value={edit}>{children}</BinEditContext>;
}

export function providers(focus: TreeFocus = NO_FOCUS) {
  return function Providers({ children }: { children: ReactNode }) {
    const [client] = useState(() => createTestQueryClient());
    return (
      <QueryClientProvider client={client}>
        <ProjectProvider project={PROJECT}>
          <ToastProvider>
            <Editable focus={focus}>{children}</Editable>
          </ToastProvider>
        </ProjectProvider>
      </QueryClientProvider>
    );
  };
}

export function lineOf(drawn: BinRow, parent: BinRow | null = null, index = 0): RowLine {
  return {
    kind: "row",
    key: `${drawn.entry}:${drawn.path}`,
    row: drawn,
    depth: 1,
    expanded: false,
    loading: false,
    owner: null,
    parent,
    index,
  };
}

export function renderRow(
  drawn: BinRow,
  { parent = null, index = 0, focus = NO_FOCUS }: RowPlacement = {},
) {
  return render(
    <BinRowLine line={lineOf(drawn, parent, index)} focused={false} onToggle={() => {}} />,
    {
      wrapper: providers(focus),
    },
  );
}

export interface RowPlacement {
  parent?: BinRow | null;
  index?: number;
  focus?: TreeFocus;
}
