// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { EditorTabs, findLeaf } from "@/modules/editor";
import { detailsDocument, gameDocument, workshopKeys } from "@/modules/workshop";
import { useWorkshopEditorStore } from "@/modules/workshop/shell/state/workshopEditor";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../projects/state/ProjectContext";
import { useActivateDocument } from "../../../shell/hooks/useProjectEditor";
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
  location: "workshop",
  lastOpened: null,
  id: "id-mine",
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

function renderArrows(project: WorkshopProject | null, tabs = false) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(workshopKeys.projects(), [PROJECT]);

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectProvider project={project}>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <>
      <NavigationArrows />
      {tabs && <HistoryTabs />}
    </>,
    { wrapper: Providers },
  );
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
      to: "/workshop/$projectId",
      params: { projectId: "id-mine" },
    });
  });

  it("routes a back out of a project onto the grid", async () => {
    standOnTheGrid();
    store().navigateHistory(1);
    renderArrows(PROJECT);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/workshop" });
  });

  /* The gesture Chromium spends on its own history, where the shell's stack is
     what a user means by Back. Dispatched by hand, because userEvent draws no
     thumb button. */
  function thumb(type: "mousedown" | "mouseup" | "auxclick", button: number): MouseEvent {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it("walks back on the thumb button, and takes the gesture off the webview", () => {
    standOnTheGrid();
    store().navigateHistory(1);
    renderArrows(PROJECT);

    /* Chromium navigates on the release, so a press left unprevented pops a
       route behind the walk and the arrow's work lands on the grid. */
    expect(thumb("mousedown", 3).defaultPrevented).toBe(true);
    expect(thumb("mouseup", 3).defaultPrevented).toBe(true);

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/workshop" });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("walks forward on the other thumb button", () => {
    standOnTheGrid();
    renderArrows(null);

    thumb("mousedown", 4);
    thumb("mouseup", 4);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/workshop/$projectId",
      params: { projectId: "id-mine" },
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("swallows the aux click the gesture ends on", () => {
    standOnTheGrid();
    renderArrows(null);

    expect(thumb("auxclick", 3).defaultPrevented).toBe(true);
  });

  it("leaves every other button to whatever was clicked", () => {
    standOnTheGrid();
    renderArrows(null);

    expect(thumb("mouseup", 0).defaultPrevented).toBe(false);
    expect(thumb("mouseup", 1).defaultPrevented).toBe(false);
    expect(thumb("mouseup", 2).defaultPrevented).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

function HistoryTabs() {
  const editor = useWorkshopEditorStore((state) => state.byProject[PROJECT.path]);
  const leaf = findLeaf(editor.layout, editor.activeLeafId)!;
  const activate = useActivateDocument();
  return (
    <EditorTabs
      leafId={leaf.id}
      activeId={leaf.activeTab}
      tabs={leaf.tabs.map((id) => ({ id, title: id }))}
      onActivate={(id) => activate(leaf.id, id)}
      onClose={() => {}}
    />
  );
}

it("records document-tab clicks and lets Back and Forward restore the selected tab", async () => {
  mockNavigate.mockReset();
  useWorkshopEditorStore.setState({ byProject: {}, history: [], historyIndex: -1 });
  store().openDocument(PROJECT.path, detailsDocument());
  store().openDocument(PROJECT.path, gameDocument());
  renderArrows(PROJECT, true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "details" }));
  expect(
    store().history.map((stop) => (stop.kind === "document" ? stop.documentId : stop.kind)),
  ).toEqual(["details", "game", "details"]);
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("tab", { name: "game" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("button", { name: "Forward" }));
  expect(screen.getByRole("tab", { name: "details" })).toHaveAttribute("aria-selected", "true");
  expect(store().history).toHaveLength(3);
});
