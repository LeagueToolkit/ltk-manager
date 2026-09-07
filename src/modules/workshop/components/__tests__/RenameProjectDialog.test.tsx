// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopDialogsStore } from "@/stores";
import { renderWithProviders } from "@/test/utils";

import { RenameProjectDialog } from "../RenameProjectDialog";

const rename = vi.fn();
vi.mock("../../api/useRenameProject", () => ({
  useRenameProject: () => ({ mutate: rename, isPending: false }),
}));

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

const MOD = project("my-mod");
const field = () => screen.getByRole("textbox");
const submit = () => screen.getByRole("button", { name: "Rename" });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkshopDialogsStore.setState({ renameProject: null });
});

describe("RenameProjectDialog", () => {
  it("renames the project over its slug", async () => {
    const user = userEvent.setup();
    useWorkshopDialogsStore.setState({ renameProject: MOD });
    renderWithProviders(<RenameProjectDialog />);

    await user.clear(field());
    await user.type(field(), "renamed-mod");
    await user.click(submit());

    expect(rename.mock.calls[0][0]).toEqual({
      projectPath: MOD.path,
      newName: "renamed-mod",
    });
  });

  it("refuses a slug a directory name would not hold", async () => {
    const user = userEvent.setup();
    useWorkshopDialogsStore.setState({ renameProject: MOD });
    renderWithProviders(<RenameProjectDialog />);

    await user.clear(field());
    await user.type(field(), "not a slug");

    expect(submit()).toBeDisabled();
    expect(screen.getByText(/lowercase/)).toBeInTheDocument();
  });

  it("offers nothing for a name that has not moved", () => {
    useWorkshopDialogsStore.setState({ renameProject: MOD });
    renderWithProviders(<RenameProjectDialog />);

    expect(submit()).toBeDisabled();
  });

  /* A cancelled attempt is spent, so the next look at the same card reads the
     slug it still has rather than the text that was refused. */
  it("seeds the field again after a close", async () => {
    const user = userEvent.setup();
    useWorkshopDialogsStore.setState({ renameProject: MOD });
    const { rerender } = renderWithProviders(<RenameProjectDialog />);

    await user.clear(field());
    await user.type(field(), "half-typed");
    useWorkshopDialogsStore.getState().closeRenameDialog();
    rerender(<RenameProjectDialog />);
    useWorkshopDialogsStore.setState({ renameProject: MOD });
    rerender(<RenameProjectDialog />);

    expect(field()).toHaveValue(MOD.name);
  });
});
