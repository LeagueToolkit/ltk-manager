// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import { usePatcherSessionStore } from "@/stores";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { StopTestButton } from "../testSessionButtons";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

describe("StopTestButton", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true, value: null });
    usePatcherSessionStore.setState({ stopping: false });
  });

  /* `stop_patcher` resolves once the stop flag is set, which is seconds before the
     session ends, so the mutation settling must not bring back a live Stop Test. */
  it("keeps showing a stopping state after the stop request settles", async () => {
    const user = userEvent.setup();
    render(<StopTestButton />, { wrapper });

    await user.click(screen.getByRole("button", { name: "Stop Test" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });
});
