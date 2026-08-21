import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Incident } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useIncident, useLatestIncident } from "../useIncidents";

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
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
    redirected: [],
    skipped: [],
    launch: "match",
    scan: "eager",
    scanStatus: null,
    hostElevated: false,
    patcher: {},
    overlayDetail: null,
    enabledCount: 0,
    phase: "unknown",
    failure: null,
    game: null,
    ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
    verdict: {
      kind: "ended-without-reason",
      title: "League closed",
      cause: "League closed, and left no reason the manager can read.",
      subject: null,
      consequence: "game-stopped",
      titleOverride: null,
      hints: [],
    },
    evidence: [],
    suspects: [],
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

describe("useLatestIncident", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns the newest incident the user has not dismissed", async () => {
    mockIncidents([incident("newest", { dismissed: true }), incident("older"), incident("oldest")]);
    const { result } = renderHook(() => useLatestIncident(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.latest?.id).toBe("older");
  });

  it("has nothing once every incident is dismissed", async () => {
    mockIncidents([incident("a", { dismissed: true }), incident("b", { dismissed: true })]);
    const { result } = renderHook(() => useLatestIncident(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.latest).toBeNull();
  });

  it("has nothing on an empty list", async () => {
    mockIncidents([]);
    const { result } = renderHook(() => useLatestIncident(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.latest).toBeNull();
  });

  it("reads the list once", async () => {
    mockIncidents([incident("a")]);
    const { result } = renderHook(() => useLatestIncident(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const listings = mockInvoke.mock.calls.filter(([cmd]) => cmd === "list_incidents");
    expect(listings).toHaveLength(1);
  });
});

describe("useIncident", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("finds the incident by id, dismissed or not", async () => {
    mockIncidents([incident("newest"), incident("wanted", { dismissed: true })]);
    const { result } = renderHook(() => useIncident("wanted"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.incident?.id).toBe("wanted");
    expect(result.current.incident?.dismissed).toBe(true);
  });

  it("is null for an id the list does not hold", async () => {
    mockIncidents([incident("a")]);
    const { result } = renderHook(() => useIncident("missing"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.incident).toBeNull();
  });

  it("is null without an id", async () => {
    mockIncidents([incident("a")]);
    const { result } = renderHook(() => useIncident(null), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.incident).toBeNull();
  });
});
