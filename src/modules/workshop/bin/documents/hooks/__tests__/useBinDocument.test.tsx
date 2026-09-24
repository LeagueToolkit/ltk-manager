// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, expect, it } from "vitest";

import type { AssetRef, ReadOnly } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { EMPTY_EDITOR, useWorkshopEditorStore } from "../../../../state";
import { PROJECT } from "../../../tree/components/__tests__/binEditFixtures";
import { type BinOpenState, useBinDocument } from "../useBinDocument";

const ASSET: AssetRef = { kind: "gameChunk", wad: "Ahri.wad.client", pathHash: "00aa" };

const DECLARED = { layer: "base", layers: ["base"], marks: [], diagnostics: [] };

let opened: BinOpenState | null = null;

function Open() {
  opened = useBinDocument(ASSET, "0x12345678").state;
  return null;
}

function Queries({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function gate(): ReadOnly | null {
  return opened?.status === "open" ? opened.handle.readOnly : null;
}

let layerFiles: string[] = [];

beforeEach(() => {
  opened = null;
  layerFiles = [];
  useWorkshopEditorStore.setState({ byProject: { [PROJECT.path]: EMPTY_EDITOR } });
  mockInvoke.mockReset();
  let document = 0;
  mockInvoke.mockImplementation((command, args?: Record<string, unknown>) => {
    if (command === "bin_open") {
      const inProject = (args?.asset as { project?: string } | undefined)?.project !== undefined;
      return Promise.resolve({
        ok: true,
        value: {
          document: ++document,
          declared: inProject ? DECLARED : null,
          readOnly: inProject ? "declarationsOff" : "install",
        },
      });
    }
    if (command === "bin_set_declaring") {
      return Promise.resolve({
        ok: true,
        value: args?.declaring === "on" ? null : "declarationsOff",
      });
    }
    if (command === "get_project_content_tree") {
      const entries = layerFiles.map((relativePath) => ({ relativePath }));
      return Promise.resolve({ ok: true, value: { layers: [{ name: "base", entries }] } });
    }

    return Promise.resolve({ ok: true, value: null });
  });
});

it("opens game data in the current mod project and reopens when that project changes", async () => {
  const view = (path: string) => (
    <ProjectProvider project={{ ...PROJECT, path }}>
      <Open />
    </ProjectProvider>
  );
  const { rerender } = render(view("C:/mods/first"), { wrapper: Queries });

  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("bin_open", {
      asset: { ...ASSET, project: "C:/mods/first" },
      entry: "0x12345678",
    }),
  );

  rerender(view("C:/mods/second"));

  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("bin_open", {
      asset: { ...ASSET, project: "C:/mods/second" },
      entry: "0x12345678",
    }),
  );
  expect(mockInvoke).toHaveBeenCalledWith("bin_close", { document: 1 });
});

it("leaves a standalone game chunk without declaration ownership", async () => {
  render(<Open />, { wrapper: Queries });

  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("bin_open", {
      asset: ASSET,
      entry: "0x12345678",
    }),
  );
});

it("opens a project's game bin read-only while it declares nothing, and takes edits once turned on", async () => {
  render(
    <ProjectProvider project={PROJECT}>
      <Open />
    </ProjectProvider>,
    { wrapper: Queries },
  );

  await waitFor(() => expect(opened?.status).toBe("open"));
  expect(gate()).toBe("declarationsOff");

  act(() => useWorkshopEditorStore.getState().setUseDeclarations(PROJECT.path, true));

  await waitFor(() => expect(gate()).toBeNull());
  expect(mockInvoke).toHaveBeenCalledWith("bin_set_declaring", { document: 1, declaring: "on" });
});

it("opens a project's game bin declaring when a layer already holds declarations", async () => {
  layerFiles = ["game_data.yaml"];
  render(
    <ProjectProvider project={PROJECT}>
      <Open />
    </ProjectProvider>,
    { wrapper: Queries },
  );

  await waitFor(() => {
    expect(opened?.status).toBe("open");
    expect(gate()).toBeNull();
  });
});
