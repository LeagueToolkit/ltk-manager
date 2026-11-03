// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProfileLabel } from "../SessionProfileLabel";

let included = true;
let deferred = false;
let profile: { name: string } | undefined;
vi.mock("@/modules/library", () => ({ useActiveProfile: () => ({ data: profile }) }));
vi.mock("@/modules/patcher", () => ({
  usePatcherStatus: () => ({
    data: {
      session: { origin: { kind: "workshop", includeProfile: included } },
      changesAfterGame: deferred,
    },
  }),
}));

beforeEach(() => {
  included = true;
  deferred = false;
  profile = { name: "Practice" };
});

describe("SessionProfileLabel", () => {
  it("shows no profile for an alone test", () => {
    included = false;
    const { container } = render(<SessionProfileLabel />);
    expect(container).toBeEmptyDOMElement();
  });
  it("names the selected profile without claiming it is already applied", () => {
    const { rerender } = render(<SessionProfileLabel />);
    expect(screen.getByText("Selected profile: Practice")).toBeInTheDocument();
    profile = { name: "Ranked" };
    deferred = true;
    rerender(<SessionProfileLabel />);
    expect(screen.getByText("Selected profile: Ranked")).toBeInTheDocument();
    expect(screen.getByText("Changes apply after this game.")).toBeInTheDocument();
  });
  it("does not invent a profile name while loading", () => {
    profile = undefined;
    render(<SessionProfileLabel />);
    expect(screen.getByText("Profile included")).toBeInTheDocument();
  });
});
