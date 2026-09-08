// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { detailsDocument, workshopKeys } from "@/modules/workshop";
import { useWorkshopEditorStore } from "@/modules/workshop/state/workshopEditor";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { NavigationArrows } from "../NavigationArrows";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));

const PROJECT: WorkshopProject = {
  path: "X:/mods/mine",
  name: "mine",
  displayName: "Mine",
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

function store() {
  return useWorkshopEditorStore.getState();
}

/* The grid, then a project, then a back out of it - which is the arrangement
   the arrows only reach once the stack belongs to the shell. */
function standOnTheGrid() {
  store().recordListVisit();
  store().openDocument(PROJECT.path, detailsDocument());
  store().navigateHistory(-1);
}

function renderArrows(project: WorkshopProject | null) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(workshopKeys.projects(), [PROJECT]);

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectProvider project={project}>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  }
  return render(<NavigationArrows />, { wrapper: Providers });
}

describe("NavigationArrows", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useWorkshopEditorStore.setState({ byProject: {}, history: [], historyIndex: -1 });
  });

  it("draws with no project open, because the stack is the shell's", () => {
    standOnTheGrid();

    renderArrows(null);

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
  });

  it("routes a forward into the project the stop sits in", async () => {
    standOnTheGrid();
    renderArrows(null);

    await userEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/workshop/$projectName",
      params: { projectName: "mine" },
    });
  });

  it("routes a back out of a project onto the grid", async () => {
    standOnTheGrid();
    store().navigateHistory(1);
    renderArrows(PROJECT);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/workshop" });
  });
});
