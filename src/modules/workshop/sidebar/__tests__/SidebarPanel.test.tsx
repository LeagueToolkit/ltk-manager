// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopEditorStore } from "@/modules/workshop/state/workshopEditor";
import { useWorkshopLayoutStore } from "@/stores/workshopLayout";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { SidebarPanel } from "../SidebarPanel";

const PROJECT: WorkshopProject = {
  path: "X:/mods/aurelion",
  name: "aurelion",
  displayName: "Aurelion",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [
    { name: "base", displayName: "Base", priority: 0, description: "", stringOverrides: {} },
  ],
  thumbnailPath: null,
  lastModified: "2026-09-12T00:00:00Z",
};

function renderPanel() {
  const queryClient = createTestQueryClient();
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ProjectProvider project={PROJECT}>{children}</ProjectProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <SidebarPanel
      project={PROJECT}
      contentLayers={[]}
      selectedLayer={null}
      selectedLayerName="base"
      selectedLayerDisplayName="Base"
      onSelect={() => {}}
    />,
    { wrapper: Providers },
  );
}

/** Which sections the panel drew, by the id each header names itself with. */
function sectionHeaders(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-ui]")]
    .map((node) => node.getAttribute("data-ui") ?? "")
    .filter((id) => id.startsWith("SidePanel:") && id.endsWith(":header"))
    .map((id) => id.slice("SidePanel:".length, -":header".length));
}

describe("SidebarPanel", () => {
  beforeEach(() => {
    mockInvoke.mockResolvedValue({ ok: true, value: null });
    useWorkshopEditorStore.setState({ byProject: {} });
    useWorkshopLayoutStore.setState({ sidebarView: "explorer", layerPanelOpen: true });
  });

  it("names the view it is showing", () => {
    const { container } = renderPanel();

    expect(container.querySelector('[data-ui="SidebarPanel:title"]')?.textContent).toBe("Explorer");
  });

  it("fills with the Explorer's own sections", () => {
    const { container } = renderPanel();

    expect(sectionHeaders(container)).toEqual(["layers", "wads", "strings"]);
  });

  it("swaps the body and the title for the view the rail selected", () => {
    useWorkshopLayoutStore.setState({ sidebarView: "source" });
    const { container } = renderPanel();

    expect(container.querySelector('[data-ui="SidebarPanel:title"]')?.textContent).toBe(
      "Source control",
    );
    expect(sectionHeaders(container)).toEqual([]);
  });

  it("gives the search view's box the header's toolbar row", () => {
    useWorkshopLayoutStore.setState({ sidebarView: "search" });
    const { container } = renderPanel();

    const toolbar = container.querySelector('[data-ui="SidebarPanel:toolbar"]');
    expect(toolbar?.querySelector("input")).not.toBeNull();
  });
});
