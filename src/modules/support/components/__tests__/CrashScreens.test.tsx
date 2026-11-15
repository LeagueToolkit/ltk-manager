// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GetHelpContext } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";

import { GetHelpCrashScreen, RouteCrashScreen } from "../CrashScreens";

/* The form reads the library, the incidents and the settings. The crash screen decides when
   the form mounts and what it opens with, so the form is replaced by its context. */
vi.mock("../GetHelpDialog", () => ({
  GetHelpForm: ({ context }: { context: GetHelpContext }) => (
    <pre data-testid="get-help">{JSON.stringify(context)}</pre>
  ),
}));

describe("the crash screens", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true, value: null });
    window.location.hash = "#/library";
  });

  it("opens Get help beside the screen, with the route and the message of the crash", async () => {
    render(<GetHelpCrashScreen error={new TypeError("x is not a function")} />);
    expect(screen.queryByTestId("get-help")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Get help" }));

    expect(JSON.parse(screen.getByTestId("get-help").textContent ?? "")).toEqual({
      origin: { kind: "crash", route: "/library", message: "x is not a function" },
    });
  });

  it("reports a route error and renders the crash screen", () => {
    render(<RouteCrashScreen error={new RangeError("out of range")} />);

    expect(screen.getByText("The manager hit a problem")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get help" })).toBeInTheDocument();
    const call = mockInvoke.mock.calls.find(
      ([name]) => name === commandNames.diagnostics.trackUiError,
    );
    const { error } = call![1] as { error: Record<string, unknown> };
    expect(error.name).toBe("RangeError");
    expect(error.handled).toBe(true);
  });
});
