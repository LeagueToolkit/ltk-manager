import { describe, expect, it } from "vitest";

import type { Notification } from "@/stores";

import { shownErrors } from "../shownErrors";

function notification(title: string, error?: Notification["error"]): Notification {
  return { id: title, title, type: "error", error, timestamp: 0, read: false };
}

describe("shownErrors", () => {
  it("returns the backend errors oldest first and leaves out the other notifications", () => {
    const newestFirst = [
      notification("Could not save the file", {
        code: "IO",
        kind: null,
        detail: "disk full",
        ref: "ab12cd34",
      }),
      notification("Copy failed"),
      notification("Could not start the patcher", {
        code: "PATCHER",
        kind: "BUSY",
        detail: null,
        ref: null,
      }),
    ];

    expect(shownErrors(newestFirst)).toEqual([
      { title: "Could not start the patcher", code: "PATCHER", kind: "BUSY", ref: null },
      { title: "Could not save the file", code: "IO", kind: null, ref: "ab12cd34" },
    ]);
  });
});
