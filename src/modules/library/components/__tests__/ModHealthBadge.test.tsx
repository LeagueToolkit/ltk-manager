// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HealthCheckReadiness,
  ModHealth,
  ModHealthVerdict,
  ProblemSeverity,
} from "@/lib/tauri";

import { ModHealthBadge } from "../ModHealthBadge";
import { verdict } from "./modHealthFixtures";

const useModHealthVerdict = vi.fn<() => { data: ModHealthVerdict | undefined }>();
const useHealthCheckReadiness = vi.fn<() => HealthCheckReadiness>(() => "ready");
const checkOne = vi.fn();
const repairOne = vi.fn();

vi.mock("../../api", () => ({
  useModHealthVerdict: () => useModHealthVerdict(),
  useHealthCheckReadiness: () => useHealthCheckReadiness(),
  useCheckModHealth: () => ({ mutate: checkOne, isPending: false }),
  useRepairMod: () => ({ mutate: repairOne, isPending: false }),
}));

function show(health: ModHealth, severity: ProblemSeverity = "fatal") {
  useModHealthVerdict.mockReturnValue({ data: verdict("a", health, { severity }) });
  render(<ModHealthBadge modId="a" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModHealthBadge", () => {
  /* A badge on every card would bury the few that need one. */
  it("draws nothing for a mod the check found nothing wrong with", () => {
    show("healthy");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws nothing for a mod nothing has checked", () => {
    useModHealthVerdict.mockReturnValue({ data: undefined });
    render(<ModHealthBadge modId="a" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("counts every finding on a mod no repair reaches", () => {
    show("unrepairable");

    expect(
      screen.getByRole("button", { name: /unrepairable findings, click for details/i }),
    ).toBeInTheDocument();
  });

  /* Story: the verdict says what a repair can do and the severity says how much
     it matters, so the two unrepairable rungs are not one pill. A mod that loads
     is not one to go and replace. */
  it("does not call a mod broken when nothing stops it loading", async () => {
    const user = userEvent.setup();
    show("unrepairable", "warning");

    const pill = screen.getByRole("button", { name: /no repair reaches, click for details/i });
    await user.click(pill);

    expect(screen.getByText("This mod loads with a fault")).toBeInTheDocument();
    expect(screen.queryByText("This mod cannot be repaired")).not.toBeInTheDocument();
    expect(screen.queryByText(/look for a new version/)).not.toBeInTheDocument();
  });

  it("counts what a repair reaches on a repairable mod", () => {
    show("repairable");

    expect(
      screen.getByRole("button", { name: /repairable findings, click to repair/i }),
    ).toBeInTheDocument();
  });
});
