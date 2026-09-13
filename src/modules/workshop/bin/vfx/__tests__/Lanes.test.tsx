// @vitest-environment happy-dom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import type { BinRow } from "@/lib/tauri";
import { useWorkshopLayoutStore } from "@/stores";

import { type EmitterChoice, EmitterChoiceContext } from "../../emitterChoice";
import type { EmitterCardData } from "../../emitterTypes";
import { createDriver } from "../driver";
import { BLEND_MODE, DRAG_MOTION, LINGER_TYPE } from "../enums";
import { Lanes } from "../Lanes";
import { type EmitterModel, POINT_SHAPE, type SystemModel } from "../model";
import { FIRST_RIG } from "../rig";
import { type VfxRun, VfxRunContext } from "../run";

function constant(...values: number[]) {
  return { constant: values, keys: [], tables: [] };
}

/** An emitter as the lanes and a swapped driver read one. */
function emitter(over: Partial<EmitterModel> = {}): EmitterModel {
  return {
    index: 0,
    simple: false,
    listIndex: 0,
    name: "smoke",
    disabled: false,
    rate: constant(1),
    particleLifetime: constant(0.5),
    lifetime: 1,
    timeBeforeFirstEmission: 0,
    singleParticle: false,
    emitterPosition: constant(0, 0, 0),
    shape: POINT_SHAPE,
    rotationOverride: [0, 0, 0],
    scaleOverride: [1, 1, 1],
    translationOverride: [0, 0, 0],
    particleLinger: 0,
    emitterLinger: 0,
    lingerType: LINGER_TYPE.maxLifetimeAfterEmitterDies,
    blendMode: BLEND_MODE.add,
    pass: 0,
    miscRenderFlags: 0,
    groundLayer: false,
    childSet: null,
    fields: null,
    ...over,
  } as EmitterModel;
}

function system(...emitters: EmitterModel[]): SystemModel {
  return {
    entry: "0x1",
    name: null,
    emitters,
    transform: null,
    dragMotion: DRAG_MOTION.stepped,
    buildUpTime: 0,
  };
}

const ORB = emitter({ index: 0, name: "Orb", listIndex: 0, pass: 1 });
const SPARKLES = emitter({ index: 1, name: "Sparkles", listIndex: 1, disabled: true });
const GLOW = emitter({ index: 2, name: "Glow", listIndex: 0, simple: true, lifetime: null });
const SPARK = emitter({ index: 0, name: "Spark", listIndex: 0 });
const BURST = emitter({
  index: 3,
  name: "Burst",
  listIndex: 2,
  childSet: {
    children: [system(SPARK)],
    bones: [],
    probability: constant(0),
    onDeath: false,
    inheritance: null,
  },
});

const SYSTEM = system(ORB, SPARKLES, GLOW, BURST);

function card(over: Partial<EmitterCardData>): EmitterCardData {
  return {
    row: {} as BinRow,
    key: "card",
    index: 0,
    simple: false,
    fields: () => undefined,
    groups: [],
    ...over,
  };
}

const CARDS = [
  card({ key: "orb", index: 0 }),
  card({ key: "sparkles", index: 1 }),
  card({ key: "glow", index: 0, simple: true }),
  card({ key: "burst", index: 2 }),
];

/** A run over `SYSTEM` standing at zero, with every action a spy. */
function fakeRun(over: Partial<VfxRun> = {}): VfxRun {
  const driver = createDriver(1);
  driver.swap(SYSTEM);
  return {
    system: SYSTEM,
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
    subscribe: () => () => {},
    ...over,
  };
}

function choice(over: Partial<EmitterChoice> = {}): EmitterChoice {
  return {
    cards: CARDS,
    total: CARDS.length,
    filter: "",
    setFilter: vi.fn(),
    card: undefined,
    root: undefined,
    rootOpen: null,
    group: null,
    open: null,
    jumpRequest: 0,
    target: "emitter",
    child: null,
    shown: [],
    aim: vi.fn(),
    chooseCard: vi.fn(),
    chooseGroup: vi.fn(),
    chooseChild: vi.fn(),
    mode: "cards",
    setMode: vi.fn(),
    marked: [],
    read: "bands",
    spark: [],
    report: vi.fn(),
    openRows: new Set(),
    toggleRow: vi.fn(),
    ...over,
  };
}

function renderLanes(run = fakeRun(), emitters = choice()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <VfxRunContext value={run}>
      <EmitterChoiceContext value={emitters}>{children}</EmitterChoiceContext>
    </VfxRunContext>
  );
  render(<Lanes />, { wrapper });
  return { run, emitters };
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** One lane's eye or solo, found by the lane's name. */
function toggleOf(lane: string, toggle: "Visible" | "Solo"): HTMLElement {
  const row = screen
    .getByRole("button", { name: new RegExp(lane) })
    .closest<HTMLElement>("[data-ui='Lanes:lane']");
  if (row === null) throw new Error(lane);
  return within(row).getByRole("button", { name: toggle });
}

type SetUpdate = (held: ReadonlySet<number>) => ReadonlySet<number>;

/** What the last call to a set's spy writes over `held`. */
function updated(spy: unknown, held: ReadonlySet<number> = new Set()): ReadonlySet<number> {
  const update = vi.mocked(spy as (update: SetUpdate) => void).mock.lastCall?.[0];
  if (update === undefined) throw new Error("no update");
  return update(held);
}

/** What every call to a set's spy writes, each over the last, from an empty set. */
function chained(spy: unknown): ReadonlySet<number> {
  return vi
    .mocked(spy as (update: SetUpdate) => void)
    .mock.calls.reduce<ReadonlySet<number>>((held, [update]) => update(held), new Set());
}

/** The lane rows, in the order they are drawn. */
function laneNames(): string[] {
  return screen
    .getAllByRole("group", { name: / lane$/ })
    .map((track) => track.getAttribute("aria-label")?.replace(/ lane$/, "") ?? "");
}

describe("Lanes", () => {
  it("draws one lane per emitter, in draw order rather than file order", () => {
    renderLanes();

    expect(laneNames()).toEqual(["Sparkles", "Glow", "Burst", "Orb"]);
  });

  it("carries each lane's index, the second list's tag and a disabled emitter's struck eye", () => {
    renderLanes();

    expect(screen.getByText("[2]")).toBeInTheDocument();
    expect(screen.getByText("simple")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Disabled" })).toBeInTheDocument();
  });

  it("runs an endless emitter to the edge under an arrow", () => {
    renderLanes();

    expect(screen.getByRole("img", { name: "Emits until the system stops" })).toBeInTheDocument();
  });

  it("narrows the lanes on the strip's own filter", () => {
    renderLanes(fakeRun(), choice({ filter: "spark" }));

    expect(laneNames()).toEqual(["Sparkles"]);
  });

  it("selects an emitter's card from its name", async () => {
    const { emitters } = renderLanes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Sparkles/ }));

    expect(emitters.chooseCard).toHaveBeenCalledWith("sparkles");
  });

  it("hides and solos an emitter by its pool index", async () => {
    const { run } = renderLanes();
    const user = userEvent.setup();

    await user.click(toggleOf("Glow", "Visible"));
    await user.click(toggleOf("Glow", "Solo"));

    expect(updated(run.setMuted)).toEqual(new Set([2]));
    expect(updated(run.setSoloed)).toEqual(new Set([2]));
  });

  it("marks the hidden and the soloed lanes", () => {
    renderLanes(fakeRun({ muted: new Set([0]), soloed: new Set([2]) }));

    expect(toggleOf("Orb", "Visible")).toHaveAttribute("aria-pressed", "false");
    expect(toggleOf("Glow", "Visible")).toHaveAttribute("aria-pressed", "true");
    expect(toggleOf("Glow", "Solo")).toHaveAttribute("aria-pressed", "true");
  });

  it("paints every lane a drag passes with the state of the first", () => {
    const { run } = renderLanes();

    fireEvent.pointerDown(toggleOf("Sparkles", "Visible"), { button: 0 });
    fireEvent.pointerOver(toggleOf("Glow", "Visible"), { buttons: 1 });
    fireEvent.pointerOver(toggleOf("Burst", "Visible"), { buttons: 1 });

    expect(chained(run.setMuted)).toEqual(new Set([1, 2, 3]));
  });

  it("shows a lane alone on Alt, and every lane again from the lane alone", () => {
    const { run } = renderLanes();

    fireEvent.pointerDown(toggleOf("Glow", "Visible"), { button: 0, altKey: true });

    expect(updated(run.setMuted)).toEqual(new Set([0, 1, 3]));
    expect(updated(run.setMuted, new Set([0, 1, 3]))).toEqual(new Set());
  });

  it("sets a Shift range from the last lane pressed, in the order the lanes are listed", () => {
    const { run } = renderLanes();

    fireEvent.pointerDown(toggleOf("Sparkles", "Solo"), { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(toggleOf("Burst", "Solo"), { button: 0, shiftKey: true });

    expect(updated(run.setSoloed)).toEqual(new Set([1, 2, 3]));
  });

  it("shows or hides every lane from the header, and clears every solo", async () => {
    const { run } = renderLanes(fakeRun({ soloed: new Set([2]) }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Every lane visible" }));
    await user.click(screen.getByRole("button", { name: "Clear solos" }));

    expect(updated(run.setMuted)).toEqual(new Set([1, 2, 3, 0]));
    expect(updated(run.setSoloed, new Set([2]))).toEqual(new Set());
  });

  it("seeks from a press on a track and on the ruler", () => {
    const { run } = renderLanes();

    fireEvent.pointerDown(screen.getByRole("group", { name: "Orb lane" }), { button: 0 });
    const ruler = screen.getByRole("group", { name: "Timeline ruler" });
    fireEvent.pointerDown(ruler, { button: 0 });
    fireEvent.pointerUp(ruler, { button: 0 });

    expect(run.seek).toHaveBeenCalledTimes(2);
  });

  it("reads the time on the playhead's flag, and scrubs from a drag on it rather than looping", () => {
    const { run } = renderLanes();
    const flag = screen.getByText("0.00");

    fireEvent.pointerDown(flag, { button: 0, clientX: 0 });
    fireEvent.pointerMove(flag, { clientX: 30 });
    fireEvent.pointerUp(flag, { button: 0, clientX: 30 });

    expect(run.seek).toHaveBeenCalledTimes(1);
    expect(run.setLoop).not.toHaveBeenCalled();
  });

  it("names the unit after the ruler's last label", () => {
    renderLanes();

    expect(screen.getByRole("group", { name: "Timeline ruler" })).toHaveTextContent(/s$/);
  });

  it("sets the loop range from a drag along the ruler", () => {
    const { run } = renderLanes();
    const ruler = screen.getByRole("group", { name: "Timeline ruler" });

    fireEvent.pointerDown(ruler, { button: 0, clientX: 0 });
    fireEvent.pointerMove(ruler, { clientX: 40 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: 40 });

    expect(run.setLoop).toHaveBeenCalledWith(expect.objectContaining({ from: 0 }));
    expect(run.seek).not.toHaveBeenCalled();
  });

  it("drops a ruler drag the pointer cancels, and seeks on the next press", () => {
    const { run } = renderLanes();
    const ruler = screen.getByRole("group", { name: "Timeline ruler" });

    fireEvent.pointerDown(ruler, { button: 0, clientX: 0 });
    fireEvent.pointerMove(ruler, { clientX: 40 });
    fireEvent.pointerCancel(ruler);
    expect(run.setLoop).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: /Loop/ })).not.toBeInTheDocument();

    fireEvent.pointerDown(ruler, { button: 0, clientX: 10 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: 10 });
    expect(run.seek).toHaveBeenCalledTimes(1);
  });

  it("stops a track drag seeking once the pointer cancels", () => {
    const { run } = renderLanes();
    const track = screen.getByRole("group", { name: "Orb lane" });

    fireEvent.pointerDown(track, { button: 0, clientX: 10 });
    fireEvent.pointerMove(track, { clientX: 20 });
    fireEvent.pointerCancel(track);
    fireEvent.pointerMove(track, { clientX: 30 });

    expect(run.seek).toHaveBeenCalledTimes(2);
  });

  it("drags the loop's out by its edge, and the whole range by its band", () => {
    /* 210 pixels over the fitted 2.1 seconds, which puts the loop at 50 to 100. */
    const measured = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(210);
    onTestFinished(() => measured.mockRestore());
    const { run } = renderLanes(fakeRun({ loop: { from: 0.5, to: 1 } }));
    const ruler = screen.getByRole("group", { name: "Timeline ruler" });
    const last = () => vi.mocked(run.setLoop).mock.calls.at(-1)?.[0];

    fireEvent.pointerDown(ruler, { button: 0, clientX: 100 });
    fireEvent.pointerMove(ruler, { clientX: 150 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: 150 });
    expect(last()?.from).toBeCloseTo(0.5);
    expect(last()?.to).toBeCloseTo(1.5);

    fireEvent.pointerDown(ruler, { button: 0, clientX: 75 });
    fireEvent.pointerMove(ruler, { clientX: 100 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: 100 });
    expect(last()?.from).toBeCloseTo(0.75);
    expect(last()?.to).toBeCloseTo(1.25);
    expect(run.seek).not.toHaveBeenCalled();
  });

  it("draws the live-count histogram only while its switch is on", () => {
    useWorkshopLayoutStore.setState({ timelineHistogram: false });
    renderLanes();
    const histogram = () => document.querySelector("[data-ui='Lanes'] canvas");
    expect(histogram()).toBeNull();

    act(() => useWorkshopLayoutStore.setState({ timelineHistogram: true }));

    expect(histogram()).not.toBeNull();
  });

  it("clears the loop range from its x", async () => {
    const { run } = renderLanes(fakeRun({ loop: { from: 0.5, to: 1 } }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Clear the loop range" }));

    expect(run.setLoop).toHaveBeenCalledWith(null);
  });

  it("nests a child system's emitters under the emitter that spawns them, folded", async () => {
    const { emitters } = renderLanes();
    const user = userEvent.setup();
    expect(laneNames()).not.toContain("Spark");

    await user.click(screen.getByRole("button", { name: "Child systems" }));
    expect(laneNames()).toContain("Spark");

    await user.click(screen.getByRole("button", { name: /Spark\b/ }));
    expect(emitters.chooseChild).toHaveBeenCalledWith(
      expect.objectContaining({ path: "3.0", parent: "burst", emitter: SPARK }),
    );
  });
});
