import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Verdict } from "@/lib/tauri";

import { VerdictCard } from "../VerdictCard";
import { createMockIncident } from "./fixtures";

const rejected: Verdict = {
  kind: "skinhack-detected",
  title: "Skinhack Detection",
  cause: "The scan found a skinhack in Graves.wad.client.",
  subject: "Graves.wad.client",
  consequence: "overlay-off",
  titleOverride: null,
  hints: [],
};

describe("VerdictCard", () => {
  it("reads the verdict's own title for an ordinary incident", () => {
    render(<VerdictCard incident={createMockIncident()} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Missing Game Data" }),
    ).toBeInTheDocument();
  });

  /// The rail has room for the finding and the card has room for the verb, so
  /// a caught skinhack says the longer thing here.
  it("names a caught skinhack in the heading", () => {
    render(<VerdictCard incident={createMockIncident({ verdict: rejected })} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Skinhack detection triggered" }),
    ).toBeInTheDocument();
  });

  /// A rejection for any other reason is not a skinhack, and must not borrow
  /// the heading or the hue.
  it("leaves another rejection status alone", () => {
    render(
      <VerdictCard
        incident={createMockIncident({
          verdict: {
            ...rejected,
            kind: "archive-rejected",
            title: "Archive Scan Rejection",
          },
          scanStatus: "base-skin",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Archive Scan Rejection" }),
    ).toBeInTheDocument();
  });

  it("takes the void hue only for a caught skinhack", () => {
    const { container, unmount } = render(
      <VerdictCard incident={createMockIncident({ verdict: rejected })} />,
    );
    const card = container.querySelector("section");
    expect(card?.className).toContain("void");
    unmount();

    const plain = render(<VerdictCard incident={createMockIncident()} />);
    expect(plain.container.querySelector("section")?.className).not.toContain("void");
  });
});
