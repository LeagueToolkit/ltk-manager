// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopEditorStore } from "@/modules/workshop/state/workshopEditor";
import { useWorkshopLayoutStore } from "@/stores/workshopLayout";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { DETAILS_DOCUMENT_ID } from "../../documents";
import { SidebarRail } from "../SidebarRail";

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
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-09-12T00:00:00Z",
};

function renderRail() {
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
  render(<SidebarRail />, { wrapper: Providers });
  return userEvent.setup();
}

function layout() {
  return useWorkshopLayoutStore.getState();
}

function openDocumentIds(): readonly string[] {
  const editor = useWorkshopEditorStore.getState().byProject[PROJECT.path];
  return Object.keys(editor?.documents ?? {});
}

describe("SidebarRail", () => {
  beforeEach(() => {
    useWorkshopLayoutStore.setState({ sidebarView: "explorer", layerPanelOpen: true });
    useWorkshopEditorStore.setState({ byProject: {} });
  });

  it("marks the view the panel is showing", () => {
    expect(screen.queryByRole("tab")).toBeNull();
    renderRail();

    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Problems" })).toHaveAttribute("aria-selected", "false");
  });

  it("fills the panel with the view its icon names", async () => {
    const user = renderRail();

    await user.click(screen.getByRole("tab", { name: "Problems" }));

    expect(layout().sidebarView).toBe("problems");
    expect(layout().layerPanelOpen).toBe(true);
  });

  it("hides the panel when the showing view's own icon is pressed", async () => {
    const user = renderRail();

    await user.click(screen.getByRole("tab", { name: "Explorer" }));

    expect(layout().layerPanelOpen).toBe(false);
    expect(layout().sidebarView).toBe("explorer");
    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveAttribute("aria-selected", "false");
  });

  it("reopens the panel on the view pressed while it was hidden", async () => {
    const user = renderRail();

    await user.click(screen.getByRole("tab", { name: "Explorer" }));
    await user.click(screen.getByRole("tab", { name: "Search" }));

    expect(layout().layerPanelOpen).toBe(true);
    expect(layout().sidebarView).toBe("search");
  });

  it("opens a project document without touching the panel's view", async () => {
    const user = renderRail();

    await user.click(screen.getByRole("button", { name: "Mod details" }));

    expect(openDocumentIds()).toContain(DETAILS_DOCUMENT_ID);
    expect(layout().sidebarView).toBe("explorer");
  });
});
