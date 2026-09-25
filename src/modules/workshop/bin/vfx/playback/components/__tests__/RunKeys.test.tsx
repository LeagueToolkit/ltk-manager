// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, onTestFinished } from "vitest";

import { Slider } from "@/components";

import { type EmitterChoice, EmitterChoiceContext } from "../../../inspector/state/emitterChoice";
import { fakeRun } from "../../state/__tests__/fakeRun";
import { type VfxRun, VfxRunContext } from "../../state/run";
import { RunKeys } from "../RunKeys";

/** A strip with no emitter chosen, which is all the keys read of it. */
const CHOICE = { root: undefined } as EmitterChoice;

/** The keys over `run` around `children`, and the box they listen on. */
function renderKeys(run: VfxRun, children?: ReactNode): HTMLElement {
  render(
    <VfxRunContext value={run}>
      <EmitterChoiceContext value={CHOICE}>
        <RunKeys>
          <p>ground</p>
          {children}
        </RunKeys>
      </EmitterChoiceContext>
    </VfxRunContext>,
  );
  const box = screen.getByText("ground").parentElement;
  if (box === null) throw new Error("no box");
  return box;
}

/** A press of `key` with focus on `target`. */
function press(target: HTMLElement, key: string, code: string) {
  target.focus();
  fireEvent.keyDown(target, { key, code });
}

describe("RunKeys", () => {
  it("takes focus on mount while no other control has it", () => {
    const box = renderKeys(fakeRun().run);

    expect(document.activeElement).toBe(box);
  });

  it("leaves focus on a control outside the box that has it", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    outside.focus();

    renderKeys(fakeRun().run);

    expect(document.activeElement).toBe(outside);
  });

  it("plays on Space while a slider has focus, and leaves the arrows to the slider", () => {
    const { run } = fakeRun();
    renderKeys(
      run,
      <Slider
        aria-label="Chance"
        value={0.5}
        min={0}
        max={1}
        step={0.1}
        onValueChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Chance" });

    press(slider, " ", "Space");
    press(slider, "ArrowRight", "ArrowRight");

    expect(run.setPlaying).toHaveBeenCalledWith(true);
    expect(run.step).not.toHaveBeenCalled();
  });

  it("leaves Space to a tab, and every key to a text field", () => {
    const { run } = fakeRun();
    renderKeys(
      run,
      <>
        <button type="button" role="tab">
          Tab
        </button>
        <input aria-label="Filter" />
      </>,
    );

    press(screen.getByRole("tab"), " ", "Space");
    press(screen.getByRole("textbox", { name: "Filter" }), "l", "KeyL");

    expect(run.setPlaying).not.toHaveBeenCalled();
    expect(run.setLooping).not.toHaveBeenCalled();
  });

  it("toggles the loop on L, goes to the end on End, and restarts and plays on Home", () => {
    const { run } = fakeRun();
    const box = renderKeys(run);

    press(box, "l", "KeyL");
    press(box, "End", "End");
    press(box, "Home", "Home");

    expect(run.setLooping).toHaveBeenCalledWith(false);
    expect(run.seekEnd).toHaveBeenCalledTimes(1);
    expect(run.restart).toHaveBeenCalledTimes(1);
    expect(run.setPlaying).toHaveBeenCalledWith(true);
  });
});
