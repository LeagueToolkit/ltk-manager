// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LegendBar } from "../components/LegendBar";

const TERMS = [
  { term: "*.psd", meaning: "every file with that extension" },
  { term: "wip/", meaning: "a folder and everything under it" },
];

describe("LegendBar", () => {
  it("draws every term beside what it means", () => {
    render(<LegendBar title="Syntax" terms={TERMS} />);

    expect(screen.getByText("*.psd")).toBeInTheDocument();
    expect(screen.getByText("every file with that extension")).toBeInTheDocument();
    expect(screen.getByText("wip/")).toBeInTheDocument();
  });

  it("folds to its own title", async () => {
    const user = userEvent.setup();
    render(<LegendBar title="Syntax" terms={TERMS} notes={["Patterns start at content/."]} />);

    await user.click(screen.getByRole("button", { name: /syntax/i }));

    expect(screen.queryByText("*.psd")).not.toBeInTheDocument();
    expect(screen.queryByText("Patterns start at content/.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /syntax/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps the header's action on screen while folded", async () => {
    const user = userEvent.setup();
    render(
      <LegendBar
        title="Syntax"
        terms={TERMS}
        action={<a href="https://example.invalid">Read the full syntax</a>}
      />,
    );

    await user.click(screen.getByRole("button", { name: /syntax/i }));

    expect(screen.getByRole("link", { name: "Read the full syntax" })).toBeInTheDocument();
  });

  it("starts folded when it is asked to", () => {
    render(<LegendBar title="Syntax" terms={TERMS} defaultOpen={false} />);

    expect(screen.queryByText("*.psd")).not.toBeInTheDocument();
  });
});
