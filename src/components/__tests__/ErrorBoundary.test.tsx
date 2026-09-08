// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components";
import { mockInvoke } from "@/test/mocks/tauri";

function Boom(): never {
  throw new TypeError("x is not a function");
}

describe("ErrorBoundary", () => {
  // React writes the caught error to the console itself, which would otherwise
  // bury the run in a stack trace the test is asserting about anyway.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true, value: null });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("draws a fallback rather than an empty window", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("The manager hit a problem")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("reports the crash with its message and its component stack", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const call = mockInvoke.mock.calls.find(([name]) => name === "track_ui_error");
    expect(call).toBeDefined();

    const { error } = call![1] as { error: Record<string, unknown> };
    expect(error.name).toBe("TypeError");
    expect(error.message).toBe("x is not a function");
    expect(error.componentStack).toContain("Boom");
    expect(error.handled).toBe(true);
  });

  it("draws its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("the app")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
