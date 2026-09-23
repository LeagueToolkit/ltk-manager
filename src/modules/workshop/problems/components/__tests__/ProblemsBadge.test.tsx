// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Problem, ProblemSeverity, RuleInfo, Run, WorkshopProject } from "@/lib/tauri";
import { useWorkshopLayoutStore } from "@/stores/workshopLayout";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../projects/state/ProjectContext";
import { ProblemsBadge } from "../ProblemsBadge";

const PROJECT: WorkshopProject = {
  path: "X:/mods/smolder-prestige",
  name: "smolder-prestige",
  displayName: "Smolder Prestige",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
  location: "workshop",
  lastOpened: null,
  id: "id-smolder-prestige",
};

const RETYPE = "bin/property-type";

const DORMANT: RuleInfo["state"] = {
  kind: "dormant",
  waiting: "Patch 16.17",
  reason: "Riot changes how these values are stored in patch 16.17.",
};

function rule(state: RuleInfo["state"]): RuleInfo {
  return { id: RETYPE, title: "Meta property type mismatch", description: "", state };
}

function problem(id: string, severity: ProblemSeverity): Problem {
  return {
    id,
    rule: RETYPE,
    severity,
    site: { layer: "base", path: "data/skin0.bin", node: null },
    fix: null,
  };
}

function run(state: RuleInfo["state"], problems: Problem[]): Run {
  return { at: "2026-08-21T21:14:02Z", rules: [rule(state)], objects: [], problems, failed: [] };
}

function renderBadge(value: Run) {
  mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, value }));
  const queryClient = createTestQueryClient();
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectProvider project={PROJECT}>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  }
  return render(<ProblemsBadge />, { wrapper: Providers });
}

describe("ProblemsBadge", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useWorkshopLayoutStore.setState({
      forwardLookingMeta: useWorkshopLayoutStore.getInitialState().forwardLookingMeta,
    });
  });

  it("counts what the project has to answer for", async () => {
    renderBadge(run({ kind: "active" }, [problem("a", "warning"), problem("b", "warning")]));

    expect(await screen.findByRole("button", { name: "2 warnings, open Problems" })).toBeVisible();
  });

  /* A change Riot has not deployed has broken nothing, so the bar stays quiet
     about it. The panel still lists those findings, muted. */
  it("says nothing about a check waiting on a newer game", async () => {
    useWorkshopLayoutStore.setState({ forwardLookingMeta: false });
    const waiting = run(DORMANT, [problem("a", "warning")]);
    renderBadge(waiting);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  /* The setting decides what the Problems tab is about. It never changes what
     the mod owes on the game that is installed, which is what this counts. */
  it("says nothing about one even with the forward-looking linter on", async () => {
    useWorkshopLayoutStore.setState({ forwardLookingMeta: true });
    renderBadge(run(DORMANT, [problem("a", "warning")]));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  /* One rule can hold tables for several builds, and a finding from one the
     game has taken crashes it today whatever the rest is waiting on. */
  it("counts a crash from a waiting check", async () => {
    renderBadge(run(DORMANT, [problem("a", "fatal"), problem("b", "warning")]));

    expect(await screen.findByRole("button", { name: "1 crash, open Problems" })).toBeVisible();
  });
});
