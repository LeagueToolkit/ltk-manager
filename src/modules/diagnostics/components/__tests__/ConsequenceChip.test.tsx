import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Consequence } from "@/lib/tauri";

import { ConsequenceChip } from "../ConsequenceChip";

describe("ConsequenceChip", () => {
  it.each([
    ["overlay-off", "No mod ran"],
    ["game-stopped", "Game stopped"],
    ["game-hung", "Game hung"],
    ["archive-dropped", "Archive dropped"],
  ] as const)("says what %s cost", (consequence, label) => {
    render(<ConsequenceChip consequence={consequence} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  /// Losing every mod and losing the game are total failures, and losing one
  /// archive or one loading screen is not. The chip has to separate the two.
  it("bands a total loss apart from a partial one", () => {
    const bandOf = (consequence: Consequence) => {
      const { unmount } = render(<ConsequenceChip consequence={consequence} />);
      const className = screen.getByText(/./).className;
      unmount();
      return className;
    };

    expect(bandOf("overlay-off")).toContain("danger");
    expect(bandOf("game-stopped")).toContain("danger");
    expect(bandOf("game-hung")).toContain("warning");
    expect(bandOf("archive-dropped")).toContain("warning");
  });
});
