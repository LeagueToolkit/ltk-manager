// @vitest-environment happy-dom

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IgnoredEntry, PackResult, ValidationResult, WorkshopProject } from "@/lib/tauri";
import { renderWithProviders } from "@/test/utils";

import { IGNORE_RULES_DOCUMENT_ID } from "../../documents";
import { usePackDialog, useWorkshopEditorStore } from "../../state";
import { PackDialog } from "../PackDialog";

const pack = vi.fn();
let packResult: PackResult;

vi.mock("../../api/usePackProject", () => ({
  usePackProject: () => ({
    mutate: (args: unknown, handlers: { onSuccess: (result: PackResult) => void }) => {
      pack(args);
      handlers.onSuccess(packResult);
    },
    isPending: false,
  }),
}));

let validation: ValidationResult;
vi.mock("../../api/useValidateProject", () => ({
  useValidateProject: () => ({ data: validation, isLoading: false }),
}));

const MOD: WorkshopProject = {
  path: "X:/mods/my-mod",
  name: "my-mod",
  displayName: "My Mod",
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

function result(ignored: IgnoredEntry[]): PackResult {
  return {
    outputPath: "X:/mods/my-mod/build/my-mod.modpkg",
    fileName: "my-mod.modpkg",
    format: "modpkg",
    ignored,
  };
}

const packButton = () => screen.getByRole("button", { name: "Pack" });
const disclosure = () => screen.getByRole("button", { name: /Left out by ignore rules/ });

beforeEach(() => {
  vi.clearAllMocks();
  validation = { valid: true, errors: [], warnings: [] };
  packResult = result([]);
  usePackDialog.setState({ payload: null, isOpen: false });
  useWorkshopEditorStore.setState({ pendingDocuments: {} });
});

describe("PackDialog", () => {
  it("counts what the rules left out and lists it", async () => {
    const user = userEvent.setup();
    packResult = result([
      { path: "base/textures/skin0_src.psd", pruned: false },
      { path: "base/wip", pruned: true },
      { path: "base/.DS_Store", pruned: false },
    ]);
    usePackDialog.getState().open(MOD);
    renderWithProviders(<PackDialog />);

    await user.click(packButton());

    expect(within(disclosure()).getByText("3")).toBeInTheDocument();

    await user.click(disclosure());

    const list = screen.getByRole("list", { name: /left out/i });
    expect(within(list).getByText("skin0_src.psd")).toBeInTheDocument();
    expect(within(list).getByText(".DS_Store")).toBeInTheDocument();
    // A pruned folder is one row, and its trailing separator is what says so.
    expect(within(list).getByText("wip/")).toBeInTheDocument();
  });

  it("says nothing where the rules left nothing out", async () => {
    const user = userEvent.setup();
    usePackDialog.getState().open(MOD);
    renderWithProviders(<PackDialog />);

    await user.click(packButton());

    expect(screen.getByText("Package Created")).toBeInTheDocument();
    expect(screen.queryByText(/Left out by ignore rules/)).not.toBeInTheDocument();
  });

  it("asks the editor for the ignore rules rather than opening them itself", async () => {
    const user = userEvent.setup();
    packResult = result([{ path: "base/notes.txt", pruned: false }]);
    usePackDialog.getState().open(MOD);
    renderWithProviders(<PackDialog />);

    await user.click(packButton());
    await user.click(disclosure());
    await user.click(screen.getByRole("button", { name: "Ignore rules" }));

    expect(useWorkshopEditorStore.getState().pendingDocuments[MOD.path]?.id).toBe(
      IGNORE_RULES_DOCUMENT_ID,
    );
    expect(useWorkshopEditorStore.getState().byProject[MOD.path]).toBeUndefined();
  });

  it("draws an emptied layer among the pre-flight warnings", () => {
    validation = {
      valid: true,
      errors: [],
      warnings: ["Layer content/high-res is empty after ignore rules"],
    };
    usePackDialog.getState().open(MOD);
    renderWithProviders(<PackDialog />);

    expect(
      screen.getByText("Layer content/high-res is empty after ignore rules"),
    ).toBeInTheDocument();
    expect(packButton()).toBeEnabled();
  });
});
