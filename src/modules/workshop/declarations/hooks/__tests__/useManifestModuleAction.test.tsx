// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useOpenBinsStore } from "../../../state";
import { useManifestModuleAction } from "../useManifestModuleAction";

const PROJECT = "C:/mods/jade-teemo";
const DECLARING = 1;
const PLAIN = 2;

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
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
