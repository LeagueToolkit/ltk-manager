// @vitest-environment happy-dom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createDriver } from "../driver";
import { FIRST_RIG } from "../rig";
import { type VfxRun, VfxRunContext } from "../run";
import { RunTransport } from "../RunTransport";

/** A run standing at zero over an empty system, with every action a spy. */
function fakeRun(): { run: VfxRun; tick: () => void } {
  const listeners = new Set<() => void>();
  const driver = createDriver(1);
  const run: VfxRun = {
    system: null,
    error: null,
    pending: false,
    driver,
    playing: false,
    speed: 1,
    seed: 1,
    rig: FIRST_RIG,
    muted: new Set(),
    soloed: new Set(),
    loop: null,
    pinned: null,
    span: 2,
    resumed: false,
    fitRequest: 0,
    requestFit: vi.fn(),
    setPlaying: vi.fn(),
    setSpeed: vi.fn(),
    setRig: vi.fn(),
    reroll: vi.fn(),
    toggleMuted: vi.fn(),
    toggleSoloed: vi.fn(),
    setMuted: vi.fn(),
    setSoloed: vi.fn(),
    setLoop: vi.fn(),
    setPinned: vi.fn(),
    seek: vi.fn(),
    step: vi.fn(),
    restart: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    run,
    tick: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe("RunTransport", () => {
  it("draws the run's playhead off the clock, and its controls off the run", async () => {
    const { run, tick } = fakeRun();
    render(
      <VfxRunContext value={run}>
        <RunTransport />
      </VfxRunContext>,
    );

    expect(screen.getByText("0.00 / 2.00 s")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Playhead" })).toBeInTheDocument();

    run.driver.advance(0.5);
    await act(async () => tick());
    expect(screen.getByText("0.50 / 2.00 s")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(run.setPlaying).toHaveBeenCalledWith(true);
  });

  it("leaves the scrub out where the host draws a ruler", () => {
    const { run } = fakeRun();
    render(
      <VfxRunContext value={run}>
        <RunTransport scrub={false} />
      </VfxRunContext>,
    );

    expect(screen.queryByRole("slider", { name: "Playhead" })).not.toBeInTheDocument();
    expect(screen.getByText("0.00 / 2.00 s")).toBeInTheDocument();
  });
});
