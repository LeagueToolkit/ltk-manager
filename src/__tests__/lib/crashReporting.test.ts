// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { describeThrown, installGlobalErrorHandlers } from "@/lib/crashReporting";
import { mockInvoke } from "@/test/mocks/tauri";

/** An event carrying a field the constructor in this environment may not take. */
function eventCarrying(type: string, field: string, value: unknown): Event {
  const event = new Event(type);
  Object.defineProperty(event, field, { value });
  return event;
}

function reported(): Record<string, unknown> | undefined {
  const call = mockInvoke.mock.calls.find(([name]) => name === "track_ui_error");
  return (call?.[1] as { error: Record<string, unknown> } | undefined)?.error;
}

describe("describeThrown", () => {
  it("keeps an error's own name, message and stack", () => {
    const thrown = new TypeError("x is not a function");

    expect(describeThrown(thrown)).toMatchObject({
      name: "TypeError",
      message: "x is not a function",
    });
    expect(describeThrown(thrown).stack).toBeTruthy();
  });

  it("still describes something that is not an error", () => {
    expect(describeThrown("just a string")).toEqual({
      name: "UnknownError",
      message: "just a string",
      stack: null,
    });
  });
});

describe("installGlobalErrorHandlers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true, value: null });
  });

  it("reports an error no boundary sees", () => {
    installGlobalErrorHandlers();

    window.dispatchEvent(eventCarrying("error", "error", new TypeError("nothing caught this")));

    expect(reported()).toMatchObject({
      name: "TypeError",
      message: "nothing caught this",
      handled: false,
    });
  });

  it("reports a rejection nothing handled", () => {
    installGlobalErrorHandlers();

    window.dispatchEvent(
      eventCarrying("unhandledrejection", "reason", new Error("the promise gave up")),
    );

    expect(reported()).toMatchObject({
      message: "the promise gave up",
      handled: false,
    });
  });
});
