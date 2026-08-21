import type { Incident } from "@/lib/tauri";
import { useIncidentLineStore } from "@/stores/incidents";

function incident(id: string): Incident {
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
    scanStatus: null,
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
    suspects: [],
    dismissed: false,
  };
}

describe("incidents store", () => {
  beforeEach(() => {
    useIncidentLineStore.setState({ incident: null, answeredIncidentId: null });
  });

  describe("show", () => {
    it("puts the incident on the line", () => {
      const crash = incident("crash");
      useIncidentLineStore.getState().show(crash);
      expect(useIncidentLineStore.getState().incident).toBe(crash);
    });

    it("replaces the incident already on the line", () => {
      useIncidentLineStore.getState().show(incident("first"));
      useIncidentLineStore.getState().show(incident("second"));
      expect(useIncidentLineStore.getState().incident?.id).toBe("second");
    });
  });

  describe("clear", () => {
    it("takes the line down when it speaks for the id", () => {
      useIncidentLineStore.getState().show(incident("crash"));
      useIncidentLineStore.getState().clear("crash");
      expect(useIncidentLineStore.getState().incident).toBeNull();
    });

    /// A dismiss that arrives for an older incident must not take down the
    /// line a newer one has since put up.
    it("leaves the line alone when it speaks for another incident", () => {
      useIncidentLineStore.getState().show(incident("newer"));
      useIncidentLineStore.getState().clear("older");
      expect(useIncidentLineStore.getState().incident?.id).toBe("newer");
    });

    it("takes the line down unconditionally without an id", () => {
      useIncidentLineStore.getState().show(incident("crash"));
      useIncidentLineStore.getState().clear();
      expect(useIncidentLineStore.getState().incident).toBeNull();
    });

    it("changes nothing on an empty line", () => {
      const before = useIncidentLineStore.getState();
      useIncidentLineStore.getState().clear("crash");
      expect(useIncidentLineStore.getState()).toBe(before);
    });
  });

  describe("markAnswered", () => {
    it("records the incident a clean game answered", () => {
      useIncidentLineStore.getState().markAnswered("crash");
      expect(useIncidentLineStore.getState().answeredIncidentId).toBe("crash");
    });

    it("keeps the line up, because the bar and the badge clear on their own terms", () => {
      useIncidentLineStore.getState().show(incident("crash"));
      useIncidentLineStore.getState().markAnswered("crash");
      expect(useIncidentLineStore.getState().incident?.id).toBe("crash");
    });

    it("keeps the newest answer only", () => {
      useIncidentLineStore.getState().markAnswered("first");
      useIncidentLineStore.getState().markAnswered("second");
      expect(useIncidentLineStore.getState().answeredIncidentId).toBe("second");
    });
  });
});
