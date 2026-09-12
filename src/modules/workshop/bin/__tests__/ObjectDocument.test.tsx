// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { AssetRef, BinDocumentHandle, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { useWorkshopEditorStore } from "../../state/workshopEditor";
import { nameHash } from "../binHash";
import { useCurveDock } from "../curveTarget";
import { ObjectDocument } from "../ObjectDocument";

const ENTRY = "0x3c4d5e6f";

const ASSET: AssetRef = {
  kind: "gameChunk",
  wad: "Champions/Smolder.wad.client",
  pathHash: "00aa",
};

const HANDLE: BinDocumentHandle = {
  document: 9,
  rows: [],
  object: {
    entry: ENTRY,
    name: "Particles/Smolder_Base_Idle",
    classHash: nameHash("VfxSystemDefinitionData"),
    class: "VfxSystemDefinitionData",
  },
} as unknown as BinDocumentHandle;

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

vi.mock("../useBinDocument", () => ({
  useBinDocument: () => ({ state: { status: "open", handle: HANDLE }, reopen: () => {} }),
}));

vi.mock("../OtherDeclarations", () => ({ OtherDeclarations: () => null }));
vi.mock("../BinTree", () => ({ BinTree: () => null }));
vi.mock("../CurveSurface", () => ({ CurveSurface: () => <div>curve surface</div> }));

/** A view with state of its own, which an aim through the dock must leave standing. */
vi.mock("../ClassView", () => ({
  ClassView: () => {
    const dock = useCurveDock();
    const [count, setCount] = useState(0);
    return (
      <div>
        <button type="button" onClick={() => setCount((held) => held + 1)}>
          count {count}
        </button>
        <button type="button" onClick={() => dock.aim({ row: {} as never, chain: "Glow . rate" })}>
          aim
        </button>
      </div>
    );
  },
}));

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

beforeEach(() => {
  useWorkshopEditorStore.setState({ byProject: {} });
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(() =>
    Promise.resolve({ ok: false, error: { code: "UNKNOWN", detail: "" } }),
  );
});

describe("ObjectDocument", () => {
  it("keeps the view's state when a curve aim docks the surface", async () => {
    render(
      <ObjectDocument
        document={{
          kind: "object",
          id: "object:1",
          asset: ASSET,
          objectHash: ENTRY,
          objectPath: "Particles/Smolder_Base_Idle",
          file: "Smolder.bin",
        }}
        active
      />,
      { wrapper: Providers },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "count 0" }));
    await user.click(screen.getByRole("button", { name: "count 1" }));

    await user.click(screen.getByRole("button", { name: "aim" }));

    expect(screen.getByText("curve surface")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "count 2" })).toBeInTheDocument();
  });
});
