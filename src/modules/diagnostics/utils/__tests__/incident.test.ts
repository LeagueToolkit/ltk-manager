import { describe, expect, it } from "vitest";

import type { Verdict } from "@/lib/tauri";
import { createMockIncident } from "@/modules/diagnostics/components/__tests__/fixtures";

import { isSkinhackRejection } from "../incident";

const rejected: Verdict = {
  kind: "archive-rejected",
  title: "An archive was rejected",
  cause: "The scan found a skinhack.",
  subject: "graves.wad.client",
  confidence: "confirmed",
  hints: [],
};

describe("isSkinhackRejection", () => {
  it("holds when the scan rejected an archive for a ported Riot skin", () => {
    const incident = createMockIncident({ verdict: rejected, scanStatus: "skinhack" });

    expect(isSkinhackRejection(incident)).toBe(true);
  });

  it("does not hold for a rejection with another status", () => {
    const incident = createMockIncident({ verdict: rejected, scanStatus: "missing-bin" });

    expect(isSkinhackRejection(incident)).toBe(false);
  });

  /// A skinhack the game caught can lose the verdict to a failure that outranks
  /// it, and the art follows the verdict rather than the status.
  it("does not hold when another verdict won", () => {
    const incident = createMockIncident({ scanStatus: "skinhack" });

    expect(incident.verdict.kind).not.toBe("archive-rejected");
    expect(isSkinhackRejection(incident)).toBe(false);
  });
});
