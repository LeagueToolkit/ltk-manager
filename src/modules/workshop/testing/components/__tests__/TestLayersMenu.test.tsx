// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTestLayersStore } from "../../state/testLayers";
import { TestLayersMenu } from "../TestLayersMenu";

let profile: { name: string } | undefined = { name: "Practice" };
vi.mock("@/modules/library", () => ({ useActiveProfile: () => ({ data: profile }) }));
const base = {
  name: "base",
  displayName: "Base",
  priority: 0,
  description: null,
  stringOverrides: {},
};
const project = { path: "/project", layers: [base] };

beforeEach(() => {
  profile = { name: "Practice" };
  useTestLayersStore.setState({ excluded: {} });
});

describe("TestLayersMenu", () => {
  it("offers the profile action for a base-only project and closes without testing on Escape", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<TestLayersMenu project={project} onTestOverProfile={run} />);
    await user.click(screen.getByRole("button", { name: "Test options" }));
    expect(screen.getByRole("menuitem", { name: "Test over Practice" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(run).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Test options" }));
    await user.click(screen.getByRole("menuitem", { name: "Test over Practice" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses a generic action until the selected profile name loads", async () => {
    profile = undefined;
    const user = userEvent.setup();
    render(<TestLayersMenu project={project} onTestOverProfile={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Test options" }));
    expect(screen.getByRole("menuitem", { name: "Test over profile" })).toBeInTheDocument();
    expect(screen.queryByText("Test over Default")).not.toBeInTheDocument();
  });

  it("keeps layer selection and disables profile testing while a session is active", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <TestLayersMenu
        project={{
          ...project,
          layers: [base, { ...base, name: "extra", displayName: "Extra", priority: 1 }],
        }}
        onTestOverProfile={run}
        disabled
      />,
    );
    await user.click(screen.getByRole("button", { name: "Test options" }));
    expect(screen.getByRole("menuitem", { name: "Test over Practice" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Extra" }));
    expect(useTestLayersStore.getState().excluded[project.path]).toEqual(["extra"]);
    expect(run).not.toHaveBeenCalled();
  });
});
