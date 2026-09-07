// @vitest-environment happy-dom

import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";
import { renderWithProviders } from "@/test/utils";

import { ProjectCard } from "../ProjectCard";

vi.mock("@/modules/diagnostics", () => ({ SuspectBadge: () => null }));
vi.mock("../../api/useProjectThumbnail", () => ({
  useProjectThumbnail: () => ({ data: undefined }),
}));
const testState = { kind: "idle" as string };
vi.mock("../../api/useWorkshopTestState", () => ({ useWorkshopTestState: () => testState }));
vi.mock("@/modules/patcher", () => ({
  useStopPatcher: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/settings", () => ({ useSettings: () => ({ data: undefined }) }));

function project(name: string): WorkshopProject {
  return {
    path: `X:/mods/${name}`,
    name,
    displayName: name,
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
}

const ONE = project("one");

function show(viewMode: "grid" | "list" = "grid") {
  const onEdit = vi.fn();
  renderWithProviders(
    <ProjectCard project={ONE} viewMode={viewMode} onEdit={onEdit} tabIndex={0} />,
  );
  return { onEdit, user: userEvent.setup() };
}

const card = () => screen.getByRole("button", { name: ONE.displayName });
const item = (name: RegExp) => screen.queryByRole("menuitem", { name });
const picked = () => [...useWorkshopSelectionStore.getState().selectedPaths];

beforeEach(() => {
  testState.kind = "idle";
  useWorkshopSelectionStore.setState({ selectedPaths: new Set() });
  useWorkshopDialogsStore.setState({ renameProject: null });
});

describe("ProjectCard menu", () => {
  it.each(["grid", "list"] as const)("opens the six commands on a right click in %s", async (v) => {
    show(v);

    fireEvent.contextMenu(card());

    expect(item(/Edit Project/)).toBeInTheDocument();
    expect(item(/^Test/)).toBeInTheDocument();
    expect(item(/^Pack/)).toBeInTheDocument();
    expect(item(/Rename/)).toBeInTheDocument();
    expect(item(/Open Location/)).toBeInTheDocument();
    expect(item(/Delete/)).toBeInTheDocument();
  });

  it.each(["grid", "list"] as const)("opens the same six on the kebab in %s", async (v) => {
    const { user } = show(v);

    await user.click(screen.getByRole("button", { name: /More options/ }));

    expect(item(/Edit Project/)).toBeInTheDocument();
    expect(item(/Rename/)).toBeInTheDocument();
    expect(item(/Open Location/)).toBeInTheDocument();
  });

  /* The explorers' rule: a press acts on what it landed on, so the pick
     collapses onto the card and the card's own commands open. */
  it("selects a card alone on a right click outside the selection", () => {
    useWorkshopSelectionStore.setState({ selectedPaths: new Set(["X:/mods/other"]) });
    show();

    fireEvent.contextMenu(card());

    expect(picked()).toEqual([ONE.path]);
    expect(item(/Edit Project/)).toBeInTheDocument();
  });

  /* The card and the one pick are the same target, so the richer menu opens -
     and it is the only place Rename is drawn. */
  it("opens the card's own menu over a selection of one", () => {
    useWorkshopSelectionStore.setState({ selectedPaths: new Set([ONE.path]) });
    show();

    fireEvent.contextMenu(card());

    expect(item(/Rename/)).toBeInTheDocument();
    expect(item(/Clear selection/)).not.toBeInTheDocument();
    expect(picked()).toEqual([ONE.path]);
  });

  /* A session holds the files it was started over, and that set is not the
     user's to rewrite until it ends. */
  it("leaves the selection alone while a session is up", () => {
    testState.kind = "running-other";
    useWorkshopSelectionStore.setState({ selectedPaths: new Set(["X:/mods/other"]) });
    show();

    fireEvent.contextMenu(card());

    expect(picked()).toEqual(["X:/mods/other"]);
    expect(item(/Edit Project/)).toBeInTheDocument();
  });

  it("reads over the selection on a right click inside it", () => {
    useWorkshopSelectionStore.setState({
      selectedPaths: new Set([ONE.path, "X:/mods/other"]),
    });
    show();

    fireEvent.contextMenu(card());

    expect(picked()).toHaveLength(2);
    expect(item(/Clear selection/)).toBeInTheDocument();
    expect(item(/Edit Project/)).not.toBeInTheDocument();
  });
});

describe("ProjectCard rename", () => {
  it("reaches the rename dialog with F2 on a focused card", async () => {
    const { user } = show();

    card().focus();
    await user.keyboard("{F2}");

    expect(useWorkshopDialogsStore.getState().renameProject).toEqual(ONE);
  });

  it("reaches the same dialog from the menu", async () => {
    const { user } = show();
    fireEvent.contextMenu(card());

    await user.click(item(/Rename/)!);

    expect(useWorkshopDialogsStore.getState().renameProject).toEqual(ONE);
  });
});
