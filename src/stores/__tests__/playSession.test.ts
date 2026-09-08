// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { usePlaySessionStore } from "@/stores";

function store() {
  return usePlaySessionStore.getState();
}

/** The release id the Riot Client reports as a session's "version". */
const RELEASE = "24C2E5A086AFFB82";

describe("playSession", () => {
  beforeEach(() => {
    usePlaySessionStore.setState({ step: "idle", session: null });
  });

  /// The whole point of following a session: the run reaches the game rather
  /// than ending at the request that asked for one. The client mints the
  /// session a few seconds before League exists, so it opens at "waiting".
  it("walks a session from opened to running to over", () => {
    store().sessionStarted({ phase: "Pending", running: false, version: RELEASE });
    expect(store().step).toBe("waiting-for-game");
    expect(store().session).toEqual({ phase: "Pending", running: false, version: RELEASE });

    store().sessionGameRunning({ running: true });
    expect(store().step).toBe("in-game");

    store().sessionEnded();
    expect(store().step).toBe("idle");
    expect(store().session).toBeNull();
  });

  /// Recorded from client 137: a player sitting in the client reports phase
  /// `None` with League very much up. Keying the run off the phase parks the
  /// bar on "waiting" for the entire session.
  it("stays in game while the phase says nothing", () => {
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });
    expect(store().step).toBe("in-game");

    store().sessionChanged({ phase: "None" });
    expect(store().step).toBe("in-game");
  });

  /// A match starting and ending is not the run starting and ending. The step
  /// used to flip with it, which read as the bar going backwards between games.
  it("does not move the run when a match starts or ends", () => {
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });

    store().sessionChanged({ phase: "Gameplay" });
    expect(store().step).toBe("in-game");
    expect(store().session?.phase).toBe("Gameplay");

    store().sessionChanged({ phase: "None" });
    expect(store().step).toBe("in-game");
    expect(store().session?.phase).toBe("None");
  });

  /// The version arrives only when the session opens, so nothing later may
  /// drop it.
  it("keeps the version across a phase change and a game change", () => {
    store().sessionStarted({ phase: "Pending", running: false, version: RELEASE });
    store().sessionChanged({ phase: "Gameplay" });
    store().sessionGameRunning({ running: true });

    expect(store().session?.version).toBe(RELEASE);
  });

  /// League closed while the client kept the session open - between games, or
  /// closed from the client itself.
  it("returns to waiting when the game goes away but the session lives", () => {
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });
    store().sessionGameRunning({ running: false });

    expect(store().step).toBe("waiting-for-game");
    expect(store().session?.running).toBe(false);
  });

  it("ends a run whose launch named no session", () => {
    usePlaySessionStore.setState({ step: "launching" });
    store().launchDelivered(false);

    expect(store().step).toBe("idle");
  });

  it("waits for the game when the launch named a session", () => {
    usePlaySessionStore.setState({ step: "launching" });
    store().launchDelivered(true);

    expect(store().step).toBe("waiting-for-game");
  });

  /// The watcher polls immediately, so a session can open before the launch
  /// command's reply gets back. Stepping back to "waiting" would be a
  /// regression the user sees as the bar going backwards.
  it("does not step back to waiting once a session is already open", () => {
    usePlaySessionStore.setState({ step: "launching" });
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });
    store().launchDelivered(true);

    expect(store().step).toBe("in-game");
  });

  /// A game the manager never launched still ends the same way, so the ending
  /// has to return the step to rest whatever it was.
  it("returns to rest when a session it never launched ends", () => {
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });
    store().sessionEnded();

    expect(store().step).toBe("idle");
    expect(store().session).toBeNull();
  });

  /// An event that arrives after the session is gone must not resurrect it.
  it("ignores a game change once the session has ended", () => {
    store().sessionStarted({ phase: "None", running: true, version: RELEASE });
    store().sessionEnded();
    store().sessionGameRunning({ running: false });

    expect(store().session).toBeNull();
  });
});
