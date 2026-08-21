import { describe, expect, it } from "vitest";

import type { Verdict } from "@/lib/tauri";
import { createMockIncident } from "@/modules/diagnostics/components/__tests__/fixtures";

import { describeExitCode, isSkinhackRejection, subjectLine } from "../incident";

const skinhack: Verdict = {
  kind: "skinhack-detected",
  title: "Skinhack Detection",
  cause: "The scan found a skinhack.",
  subject: "graves.wad.client",
  consequence: "overlay-off",
  titleOverride: null,
  hints: [],
};

describe("isSkinhackRejection", () => {
  it("holds for the verdict the scan reached", () => {
    expect(isSkinhackRejection(createMockIncident({ verdict: skinhack }))).toBe(true);
  });

  /// The status alone never decides it. A rejection for another reason is a
  /// different verdict and takes neither the art nor the hue.
  it("does not hold for a rejection with another status", () => {
    const incident = createMockIncident({
      verdict: { ...skinhack, kind: "archive-rejected", title: "Archive Scan Rejection" },
      scanStatus: "missing-bin",
    });

    expect(isSkinhackRejection(incident)).toBe(false);
  });

  /// A skinhack the game caught can lose the verdict to a failure that outranks
  /// it, and the art follows the verdict rather than the status.
  it("does not hold when another verdict won", () => {
    const incident = createMockIncident({ scanStatus: "skinhack" });

    expect(incident.verdict.kind).not.toBe("skinhack-detected");
    expect(isSkinhackRejection(incident)).toBe(false);
  });
});

describe("describeExitCode", () => {
  /// The bare number is a reader's only clue to what killed the game, so the
  /// name Windows gives it goes beside the code.
  it("names an NTSTATUS the table knows", () => {
    expect(describeExitCode(-1073741819)).toBe("0xC0000005 STATUS_ACCESS_VIOLATION");
  });

  /// The token carries the code as a number, and the client may hand the same
  /// value back unsigned.
  it("reads the unsigned spelling as the same code", () => {
    expect(describeExitCode(0xc0000005)).toBe("0xC0000005 STATUS_ACCESS_VIOLATION");
  });

  it("keeps the hex for a status with no name", () => {
    expect(describeExitCode(-1073741000)).toBe("0xC0000338");
  });

  it("leaves a plain exit code as a number", () => {
    expect(describeExitCode(0)).toBe("0");
    expect(describeExitCode(3)).toBe("3");
  });
});

describe("subjectLine", () => {
  /// The rail is too narrow for a game path, and the card shows it whole.
  it("shortens a path to its file name", () => {
    const incident = createMockIncident();

    expect(incident.verdict.subject).toContain("/");
    expect(subjectLine(incident)).toBe("aatrox_skin12_tx_cm.dds");
  });

  it("leaves a subject that is not a path alone", () => {
    const incident = createMockIncident({
      verdict: { ...createMockIncident().verdict, subject: "step 52 of 64" },
    });

    expect(subjectLine(incident)).toBe("step 52 of 64");
  });

  it("falls back to the first suspect when there is no subject", () => {
    const incident = createMockIncident({
      verdict: { ...createMockIncident().verdict, subject: null },
    });

    expect(subjectLine(incident)).toBe("Aatrox Justicar");
  });
});
