// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useTestLayersStore } from "../../state/testLayers";
import { useTestProjects } from "../useTestProject";

const project = {
  path: "/project",
  displayName: "Project",
  layers: ["base", "extra"].map((name, priority) => ({
    name,
    priority,
    displayName: name,
    description: null,
    stringOverrides: {},
  })),
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ ok: true, value: null });
  useTestLayersStore.setState({ excluded: { "/project": ["extra"] } });
});

describe("useTestProjects", () => {
  it.each([undefined, false, true])(
    "sends the profile choice %s without changing tested layers",
    async (includeProfile) => {
      const client = createTestQueryClient();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useTestProjects(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ projects: [project], includeProfile });
      });
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.patcher.startPatcher, {
        config: {
          workshopProjects: ["/project"],
          workshopLayers: { "/project": ["base"] },
          includeProfile: includeProfile ?? false,
        },
      });
    },
  );
});
