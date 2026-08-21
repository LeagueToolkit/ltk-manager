import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Incident, Suspect } from "@/lib/tauri";
import { useIncidentLineStore } from "@/stores";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useIncidents } from "../../api";
import { SuspectBadge } from "../SuspectBadge";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));

const MOD_ID = "aatrox-justicar";
const PROJECT_PATH = "X:\\projects\\aatrox-justicar";

function suspect(overrides?: Partial<Suspect>): Suspect {
  return {
    modId: MOD_ID,
    projectPath: null,
    displayName: "Aatrox Justicar",
    because: "writes Aatrox.wad.client, which holds the path",
    confidence: "likely",
    ...overrides,
  };
}

function incident(id: string, overrides?: Partial<Incident>): Incident {
  return {
    id,
    startedAt: "2026-08-21T21:14:02Z",
    endedAt: "2026-08-21T21:14:14Z",
    origin: { kind: "library" },
    injected: true,
    overlay: "live",
    redirected: ["Aatrox.wad.client"],
    skipped: [],
    launch: "match",
    scan: "eager",
    game: null,
    ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
    verdict: {
      kind: "missing-data",
      title: "Missing data",
      cause: "League stopped a read it could not finish.",
      subject: "Aatrox.wad.client",
      confidence: "likely",
      hints: [],
    },
    evidence: [],
    suspects: [suspect()],
    dismissed: false,
    ...overrides,
  };
}

/** The backend lists newest first, so the order given here is the order kept. */
function mockIncidents(incidents: Incident[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_incidents") return Promise.resolve({ ok: true, value: incidents });
    return Promise.resolve({ ok: true, value: null });
  });
}

/** Reports when the incident list has settled, so an absence can be asserted. */
function Probe() {
  const { isSuccess } = useIncidents();
  return <span data-testid={isSuccess ? "incidents-ready" : "incidents-pending"} />;
}

function renderBadge(badge: ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe />
      {badge}
    </QueryClientProvider>,
  );
}

async function settled() {
  await screen.findByTestId("incidents-ready");
}

describe("SuspectBadge", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    useIncidentLineStore.setState({ incident: null, answeredIncidentId: null });
  });

  it("marks a mod the newest incident names", async () => {
    mockIncidents([incident("crash")]);
    renderBadge(<SuspectBadge modId={MOD_ID} />);

    const badge = await screen.findByRole("button", { name: /suspected/i });
    expect(badge).toHaveTextContent("Suspected");
  });

  it("marks a workshop project by its path", async () => {
    mockIncidents([
      incident("crash", { suspects: [suspect({ modId: null, projectPath: PROJECT_PATH })] }),
    ]);
    renderBadge(<SuspectBadge projectPath={PROJECT_PATH} />);

    expect(await screen.findByRole("button", { name: /suspected/i })).toBeInTheDocument();
  });

  it("stays off a mod the incident does not name", async () => {
    mockIncidents([incident("crash")]);
    renderBadge(<SuspectBadge modId="someone-else" />);

    await settled();
    expect(screen.queryByText("Suspected")).not.toBeInTheDocument();
  });

  /// A disabled mod has answered the question itself.
  it("stays off a disabled mod", async () => {
    mockIncidents([incident("crash")]);
    renderBadge(<SuspectBadge modId={MOD_ID} enabled={false} />);

    await settled();
    expect(screen.queryByText("Suspected")).not.toBeInTheDocument();
  });

  it("goes when the incident is dismissed", async () => {
    mockIncidents([incident("crash", { dismissed: true })]);
    renderBadge(<SuspectBadge modId={MOD_ID} />);

    await settled();
    expect(screen.queryByText("Suspected")).not.toBeInTheDocument();
  });

  /// A mod that was in a clean game after the crash has answered the
  /// question, and a badge that stayed would be an accusation.
  it("goes once a clean game has answered the incident", async () => {
    mockIncidents([incident("crash")]);
    useIncidentLineStore.setState({ answeredIncidentId: "crash" });
    renderBadge(<SuspectBadge modId={MOD_ID} />);

    await settled();
    expect(screen.queryByText("Suspected")).not.toBeInTheDocument();
  });

  /// The badge is a question about the last game, not the history.
  it("speaks for the newest undismissed incident only", async () => {
    mockIncidents([
      incident("newer", { suspects: [suspect({ modId: "someone-else" })] }),
      incident("older"),
    ]);
    renderBadge(<SuspectBadge modId={MOD_ID} />);

    await settled();
    expect(screen.queryByText("Suspected")).not.toBeInTheDocument();
  });

  it("opens the Games tab on the incident", async () => {
    const user = userEvent.setup();
    mockIncidents([incident("crash")]);
    renderBadge(<SuspectBadge modId={MOD_ID} />);

    await user.click(await screen.findByRole("button", { name: /suspected/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/diagnostics",
      search: { tab: "games", incident: "crash" },
    });
  });
});
