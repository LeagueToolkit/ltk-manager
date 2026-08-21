import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { IncidentList } from "../IncidentList";
import { createMockIncident, onDay } from "./fixtures";

beforeAll(() => {
  // jsdom lays nothing out, so it ships no scrollIntoView to keep the row in view.
  Element.prototype.scrollIntoView = vi.fn();
});

const today = createMockIncident({ id: "today", endedAt: onDay(0, 21, 14) });
const yesterday = createMockIncident({
  id: "yesterday",
  endedAt: onDay(1, 22, 40),
  verdict: {
    kind: "ended-without-reason",
    title: "Ended without a reason",
    cause: "League closed, and left no reason the manager can read.",
    subject: null,
    confidence: null,
    hints: [],
  },
  suspects: [],
});
const older = createMockIncident({
  id: "older",
  endedAt: onDay(5, 19, 2),
  verdict: {
    kind: "stuck-loading",
    title: "Stuck loading",
    cause: "League stopped at loading step 52 of 64.",
    subject: "step 52 of 64",
    confidence: "likely",
    hints: [],
  },
  dismissed: true,
});

const incidents = [today, yesterday, older];

describe("IncidentList", () => {
  /// The heading over a day says when, in the words a player would use, and
  /// only falls back to a date once "yesterday" stops being true.
  it("groups rows by day as Today, Yesterday, then the date", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveAccessibleName("Today");
    expect(groups[1]).toHaveAccessibleName("Yesterday");
    const dated = groups[2].getAttribute("aria-label") ?? "";
    expect(dated).not.toMatch(/Today|Yesterday/);
    expect(dated).toMatch(/\d/);

    expect(within(groups[0]).getByText("Missing data")).toBeInTheDocument();
    expect(within(groups[2]).getByText("Stuck loading")).toBeInTheDocument();
  });

  /// The line under the title is the subject where the verdict has one, and
  /// the first suspect's name where it does not.
  it("shows the subject or the first suspect under the title", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    expect(screen.getByText("aatrox_skin12_tx_cm.dds")).toBeInTheDocument();
    expect(screen.getByText("step 52 of 64")).toBeInTheDocument();
  });

  it("marks the selected row and reports a click on another", () => {
    const onSelect = vi.fn();
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={onSelect} />);

    const rows = screen.getAllByRole("option");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith("yesterday");
  });

  /// The arrows move the selection itself, because the selection is the URL
  /// and a highlight that trailed it would be a second cursor.
  it("moves the selection with the arrow keys and stops at the ends", () => {
    const onSelect = vi.fn();
    render(<IncidentList incidents={incidents} selectedId="yesterday" onSelect={onSelect} />);

    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("older");

    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("today");

    onSelect.mockClear();
    fireEvent.keyDown(list, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("older");
  });

  it("keeps a dismissed incident in the list", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
