import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Incident } from "@/lib/bindings";
import { useIncidentLineStore } from "@/stores";
import { mockListen } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { diagnosticsKeys } from "../keys";
import { CLEAN_GAME_GRACE_MS, useCleanGameWatch } from "../useCleanGameWatch";

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Handler[]>();

function emit(name: string, payload: unknown = null) {
  act(() => {
    for (const handler of handlers.get(name) ?? []) handler({ payload });
  });
}

function incident(id: string, dismissed = false): Incident {
  return {
    id,
    startedAt: "2026-08-21T19:14:02Z",
    endedAt: "2026-08-21T19:14:14Z",
    origin: { kind: "library" },
    injected: true,
    overlay: "live",
    redirected: [],
    skipped: [],
    launch: "match",
    scan: "eager",
    scanStatus: null,
    game: null,
    ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
    verdict: {
      kind: "missing-data",
      title: "Missing data",
      cause: "League stopped a read it could not finish.",
      subject: null,
      confidence: "likely",
      hints: [],
    },
    evidence: [],
    suspects: [],
    dismissed,
  };
}

/** Mounts the watch over a seeded incident list, so no query has to resolve under fake timers. */
function mountWatch(incidents: Incident[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(diagnosticsKeys.incidents(), incidents);

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return renderHook(() => useCleanGameWatch(), { wrapper });
}

function answeredId() {
  return useIncidentLineStore.getState().answeredIncidentId;
}

describe("useCleanGameWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    useIncidentLineStore.setState({ incident: null, answeredIncidentId: null });
    (mockListen as Mock).mockImplementation((name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return Promise.resolve(() => {});
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /// A mod that was in a clean game after the crash has answered the question,
  /// and a badge that stays would be an accusation.
  it("answers the open incident when no incident follows the game's exit", () => {
    mountWatch([incident("inc-2"), incident("inc-1", true)]);

    emit("patcher-game-exited");
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS));

    expect(answeredId()).toBe("inc-2");
  });

  /// The record and the log reader take seconds after the exit, and a verdict
  /// that lands late is still a verdict.
  it("waits the whole grace period before answering", () => {
    mountWatch([incident("inc-1")]);

    emit("patcher-game-exited");
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS - 1));

    expect(answeredId()).toBeNull();
  });

  it("is cancelled by an incident that arrives in time", () => {
    mountWatch([incident("inc-1")]);

    emit("patcher-game-exited");
    act(() => vi.advanceTimersByTime(5_000));
    emit("incident-recorded", incident("inc-2"));
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS));

    expect(answeredId()).toBeNull();
  });

  /// A dismissed incident has already been read, and its badges are down.
  it("answers nothing when every incident is dismissed", () => {
    mountWatch([incident("inc-1", true)]);

    emit("patcher-game-exited");
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS));

    expect(answeredId()).toBeNull();
  });

  it("answers nothing when there is no incident at all", () => {
    mountWatch([]);

    emit("patcher-game-exited");
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS));

    expect(answeredId()).toBeNull();
  });

  it("drops the wait when unmounted", () => {
    const { unmount } = mountWatch([incident("inc-1")]);

    emit("patcher-game-exited");
    unmount();
    act(() => vi.advanceTimersByTime(CLEAN_GAME_GRACE_MS));

    expect(answeredId()).toBeNull();
  });
});
