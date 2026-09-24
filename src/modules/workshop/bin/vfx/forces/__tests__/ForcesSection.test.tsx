// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import { FORCE_DEFAULT_BUILD, type AuthoredForce } from "../forceModel";
import { ForcePreviewProvider, useForcePreviewState } from "../forcePreview";
import { ForcesSection } from "../ForcesSection";
import { forceOf, vector } from "./forceFixture";

const fixture = vi.hoisted(() => ({ forces: [] as AuthoredForce[], build: 8175716 }));
vi.mock("../useForces", () => ({
  useForces: () => ({
    card: { row: fixture.forces[0]?.row },
    forces: fixture.forces,
    visible: true,
    hosted: true,
    pending: false,
    error: null,
  }),
}));
vi.mock("../../../classes/hooks/useClassSchema", () => ({
  useClassSchema: () => ({ data: { build: fixture.build, fields: [] } }),
}));
vi.mock("../../../documents/components/DeclaredLayer", () => ({ DeclaredRowState: () => null }));

beforeEach(() => {
  fixture.forces = [forceOf("acceleration", { acceleration: vector(1, 2, 3) })];
  fixture.build = FORCE_DEFAULT_BUILD;
});
afterEach(cleanup);

function mount(search = "") {
  const commit = vi.fn().mockResolvedValue(true);
  const editProperty = vi.fn().mockResolvedValue(true);
  const removeItem = vi.fn().mockResolvedValue(true);

  function Harness() {
    const preview = useForcePreviewState();
    return (
      <LeafEditContext value={{ commit, editProperty, removeItem, refused: new Map() }}>
        <ForcePreviewProvider value={preview}>
          <ForcesSection search={search} />
        </ForcePreviewProvider>
      </LeafEditContext>
    );
  }

  return { ...render(<Harness />), commit, editProperty, removeItem };
}

describe("force property tables", () => {
  it("starts empty force components folded without hiding their actions", async () => {
    fixture.forces = [forceOf("noise")];
    const { commit, editProperty } = mount();
    const header = screen.getByRole("button", { name: "Noise 1" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute force in preview" })).toBeInTheDocument();

    await userEvent.click(header);
    expect(screen.getByRole("table", { name: "Noise" })).toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
    expect(editProperty).not.toHaveBeenCalled();
  });

  it("keeps Add force available when the empty force section is folded", async () => {
    fixture.forces = [];
    mount();
    expect(screen.getByRole("button", { name: "Forces" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add force" }));
    expect(await screen.findByRole("menuitem", { name: "Attraction" })).toBeInTheDocument();
  });

  it("shows implicit force values as placeholders until edited", async () => {
    fixture.forces = [forceOf("noise")];
    const { commit, editProperty } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Noise 1" }));
    const input = screen.getByRole("textbox", { name: "Frequency" });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "0");

    await userEvent.click(input);
    await userEvent.tab();
    expect(commit).not.toHaveBeenCalled();
    expect(editProperty).not.toHaveBeenCalled();

    await userEvent.type(input, "12{Enter}");
    expect(editProperty).toHaveBeenCalledTimes(1);
  });

  it("places labels beside stepped XYZ fields and preserves the other components", async () => {
    const { commit } = mount();
    const table = screen.getByRole("table", { name: "Acceleration" });
    const heading = within(table).getByRole("rowheader", { name: "Acceleration" });
    const row = heading.closest("tr")!;
    expect(within(row).getAllByRole("textbox")).toHaveLength(3);

    const input = within(row).getByRole("textbox", { name: "Acceleration Y" });
    await userEvent.clear(input);
    await userEvent.type(input, "8{Enter}");
    expect(commit).toHaveBeenCalledWith(expect.anything(), {
      ok: true,
      leaf: { type: "vector", values: [1, 8, 3] },
    });
  });

  it("collapses a force without changing its data", async () => {
    const { commit, editProperty } = mount();
    const header = screen.getByRole("button", { name: "Acceleration 1" });
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
    expect(editProperty).not.toHaveBeenCalled();
  });

  it("keeps mute and solo out of saved declarations", async () => {
    const { commit, editProperty } = mount();
    const mute = screen.getByRole("button", { name: "Mute force in preview" });
    await userEvent.click(mute);
    expect(mute).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Solo force in preview" }));
    expect(commit).not.toHaveBeenCalled();
    expect(editProperty).not.toHaveBeenCalled();
  });

  it("adds a selected force kind in one save", async () => {
    const { editProperty } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Add force" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Noise" }));
    expect(editProperty).toHaveBeenCalledTimes(1);
    expect(editProperty.mock.calls[0][2][2]).toMatchObject({
      type: "insertItem",
      item: { class: "VfxFieldNoiseDefinitionData" },
    });
  });

  it("does not invent defaults for an unverified build", () => {
    fixture.build = 0;
    mount();
    expect(screen.getByText("Default unavailable for this build")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Local space" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Acceleration X" })).toBeInTheDocument();
  });

  it("finds a force by its raw property name", () => {
    fixture.forces = [forceOf("noise")];
    mount("velocityDelta");
    expect(screen.getByRole("table", { name: "Noise" })).toBeInTheDocument();
  });
});
