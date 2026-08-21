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
    title: "Unexplained Game Exit",
    cause: "League closed, and left no reason the manager can read.",
    subject: null,
    consequence: "game-stopped",
    titleOverride: null,
    hints: [],
  },
  suspects: [],
});
const older = createMockIncident({
  id: "older",
  endedAt: onDay(5, 19, 2),
  verdict: {
    kind: "stuck-loading",
    title: "Loading Screen Stall",
    cause: "League stopped at loading step 52 of 64.",
    subject: "step 52 of 64",
    consequence: "game-hung",
    titleOverride: null,
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

    expect(within(groups[0]).getByText("Missing Game Data")).toBeInTheDocument();
    expect(within(groups[2]).getByText("Loading Screen Stall")).toBeInTheDocument();
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

  /// Two incidents with the same title are told apart by where the game came
  /// from and how long it ran, without opening either.
  it("carries the subject, the origin and the duration on a row", () => {
    const incident = createMockIncident({
      id: "context",
      startedAt: onDay(0, 21, 10),
      endedAt: onDay(0, 21, 14),
    });
    render(<IncidentList incidents={[incident]} selectedId="context" onSelect={() => {}} />);

    const row = screen.getByRole("option");
    expect(within(row).getByText("aatrox_skin12_tx_cm.dds")).toBeInTheDocument();
    expect(within(row).getByText("Library · 4 min")).toBeInTheDocument();
  });

  /// The rail is a record, not a set of cards. The consequence reads on the
  /// detail page, where one of them is on screen rather than every one at once.
  it("draws no consequence chip", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    expect(screen.queryByText(/No mod ran|Game stopped|Game hung|Archive dropped/)).toBeNull();
  });

  it("names a dismissed row as dismissed rather than only dimming it", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    const dismissed = screen.getAllByRole("option")[2];
    expect(within(dismissed).getByText(/dismissed/)).toBeInTheDocument();
  });

  /// A day that scrolls past its own heading stops saying which day it is.
  it("heads each day with its label and how many it holds", () => {
    render(<IncidentList incidents={incidents} selectedId="today" onSelect={() => {}} />);

    const groups = screen.getAllByRole("group");
    expect(within(groups[0]).getByText("Today")).toBeInTheDocument();
    expect(within(groups[0]).getByText("1")).toBeInTheDocument();
  });
});
