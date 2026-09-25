// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../projects/state/ProjectContext";
import { EMPTY_EDITOR, useOpenBinsStore, useWorkshopEditorStore } from "../../../state";
import { useManifestModuleAction } from "../useManifestModuleAction";

const PROJECT = "C:/mods/jade-teemo";
const DECLARING = 1;
const PLAIN = 2;

const WORKSHOP_PROJECT = {
  path: PROJECT,
  name: "jade-teemo",
  displayName: "Jade Teemo",
  layers: [
    { name: "base", displayName: "Base", priority: 0, description: null, stringOverrides: {} },
  ],
} as unknown as WorkshopProject;

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={WORKSHOP_PROJECT}>
        <ToastProvider>{children}</ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useWorkshopEditorStore.setState({ byProject: { [PROJECT]: EMPTY_EDITOR } });
  useOpenBinsStore.setState({
    byTab: {
      a: { document: DECLARING, entry: null },
      b: { document: DECLARING, entry: "0x12345678" },
      c: { document: PLAIN, entry: null },
    },
  });
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command, args?: Record<string, unknown>) => {
    if (command === "bin_declared") {
      const value = args?.document === DECLARING ? { layer: "base" } : null;
      return Promise.resolve({ ok: true, value });
    }

    return Promise.resolve({ ok: true, value: null });
  });
});

it("applies the manifest again in each open declared document, once", async () => {
  const { result } = renderHook(() => useManifestModuleAction(PROJECT), { wrapper: Providers });

  expect(await result.current("base", { kind: "remove", module: 0 })).toBe(true);

  expect(mockInvoke).toHaveBeenCalledWith("declarations_module_action", {
    projectPath: PROJECT,
    layer: "base",
    action: { kind: "remove", module: 0 },
  });
  const reloads = mockInvoke.mock.calls.filter(([command]) => command === "bin_reload");
  expect(reloads).toEqual([["bin_reload", { document: DECLARING }]]);
});

it("reloads nothing when the action fails", async () => {
  mockInvoke.mockImplementation((command) =>
    Promise.resolve(
      command === "declarations_module_action"
        ? { ok: false, error: { code: "UNKNOWN", detail: "no module 4" } }
        : { ok: true, value: null },
    ),
  );
  const { result } = renderHook(() => useManifestModuleAction(PROJECT), { wrapper: Providers });

  expect(await result.current("base", { kind: "remove", module: 4 })).toBe(false);
  expect(mockInvoke.mock.calls.some(([command]) => command === "bin_reload")).toBe(false);
});

it("keeps the chosen module on the module a move carried", async () => {
  useWorkshopEditorStore
    .getState()
    .selectModule(PROJECT, { layer: "base", kind: "index", index: 0 });
  const { result } = renderHook(() => useManifestModuleAction(PROJECT), { wrapper: Providers });

  expect(await result.current("base", { kind: "move", module: 0, to: 2 })).toBe(true);

  expect(useWorkshopEditorStore.getState().byProject[PROJECT]?.selectedModule).toEqual({
    layer: "base",
    kind: "index",
    index: 2,
  });
});
