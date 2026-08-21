import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfidenceChip } from "../ConfidenceChip";

describe("ConfidenceChip", () => {
  /// Three words and no more. A player reads the word, not a percentage.
  it.each([
    ["confirmed", "Confirmed"],
    ["likely", "Likely"],
    ["lead", "Lead"],
  ] as const)("reads %s as %s", (confidence, label) => {
    render(<ConfidenceChip confidence={confidence} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  /// A lead is a heuristic, so it borrows no status hue. The other two do.
  it("draws a lead without a status band", () => {
    const { rerender } = render(<ConfidenceChip confidence="lead" />);
    expect(screen.getByText("Lead").className).not.toMatch(/warning|info|danger|success/);

    rerender(<ConfidenceChip confidence="likely" />);
    expect(screen.getByText("Likely").className).toMatch(/warning/);

    rerender(<ConfidenceChip confidence="confirmed" />);
    expect(screen.getByText("Confirmed").className).toMatch(/info/);
  });
});
