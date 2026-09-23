// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { renderWithProviders } from "@/test/utils";

import { ProjectGrid } from "../ProjectGrid";

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
    location: "workshop",
    lastOpened: null,
    id: "project-id",
  };
}

const PROJECTS = [project("one"), project("two"), project("three")];

function renderGrid() {
  const onEdit = vi.fn();
  renderWithProviders(<ProjectGrid projects={PROJECTS} onEdit={onEdit} />);
  return { onEdit, user: userEvent.setup() };
}

function cards(): HTMLElement[] {
  return PROJECTS.map((p) => screen.getByRole("button", { name: p.displayName }));
}

describe("ProjectGrid", () => {
  it("holds one tab stop for the whole grid", () => {
    renderGrid();

    expect(cards().map((card) => card.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves the stop with the arrows", async () => {
    const { user } = renderGrid();

    await user.tab();
    expect(cards()[0]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(cards()[1]).toHaveFocus();
    expect(cards().map((card) => card.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard("{ArrowLeft}");
    expect(cards()[0]).toHaveFocus();
  });

  it("takes Home and End to the two ends", async () => {
    const { user } = renderGrid();

    await user.tab();
    await user.keyboard("{End}");
    expect(cards()[2]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(cards()[0]).toHaveFocus();
  });

  it("opens the focused card the way a click does", async () => {
    const { onEdit, user } = renderGrid();

    await user.tab();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onEdit).toHaveBeenCalledWith(PROJECTS[1]);

    await user.keyboard(" ");
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("leaves the keys of a card's own controls alone", async () => {
    const { onEdit, user } = renderGrid();

    await user.tab();
    await user.tab();
    expect(cards()[0]).not.toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("follows focus that arrived some other way", async () => {
    const { user } = renderGrid();

    await user.click(cards()[2]!);
    expect(cards().map((card) => card.tabIndex)).toEqual([-1, -1, 0]);

    await user.keyboard("{ArrowLeft}");
    expect(cards()[1]).toHaveFocus();
  });
});
