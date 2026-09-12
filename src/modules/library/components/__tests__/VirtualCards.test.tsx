// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VirtualCards } from "../VirtualCards";

const VIEWPORT_PX = 600;
const CARD_PX = 200;
const GRID_TRACKS = "200px 200px 200px 200px";

const items = Array.from({ length: 500 }, (_, index) => ({ id: `mod-${index}` }));

/**
 * A scroller that reports a real height, which happy-dom does not lay out.
 *
 * Every element answers the card height, so the virtualizer measures rows and
 * windows them the way a browser would.
 */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.dataset.scroller === "" ? VIEWPORT_PX : CARD_PX;
      return {
        top: 0,
        left: 0,
        bottom: height,
        right: 800,
        width: 800,
        height,
        x: 0,
        y: 0,
      } as DOMRect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(CARD_PX);

  /* The tracks a browser resolves `auto-fill` to, which happy-dom does not. */
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    if (element instanceof HTMLElement && element.className.includes("grid")) {
      const tracks = element.className.includes("auto-fill") ? GRID_TRACKS : "800px";
      Object.defineProperty(style, "gridTemplateColumns", { value: tracks, configurable: true });
    }
    return style;
  });
}

function cards(viewMode: "grid" | "list") {
  return (
    <div data-scroller="" style={{ overflowY: "auto", height: VIEWPORT_PX }}>
      <VirtualCards
        items={items}
        keyOf={(item) => item.id}
        viewMode={viewMode}
        renderItem={(item) => <div data-testid="card">{item.id}</div>}
      />
    </div>
  );
}

function mount(viewMode: "grid" | "list" = "list") {
  return render(cards(viewMode));
}

function cardsInFirstRow(container: HTMLElement) {
  return container.querySelectorAll('[data-index="0"] [data-testid="card"]').length;
}

beforeEach(() => {
  vi.restoreAllMocks();
  layOut();
});

describe("VirtualCards", () => {
  it("mounts a window of the list rather than all of it", () => {
    mount();

    /* One column of 200px rows in a 600px viewport is three on screen, plus
       the overscan on each side. */
    const drawn = screen.getAllByTestId("card");
    expect(drawn.length).toBeGreaterThanOrEqual(3);
    expect(drawn.length).toBeLessThan(20);
  });

  it("starts at the top of the list", () => {
    mount();

    expect(screen.getByText("mod-0")).toBeInTheDocument();
    expect(screen.queryByText("mod-499")).not.toBeInTheDocument();
  });

  it("reserves the height of every row it has not mounted", () => {
    const { container } = mount();

    const frame = container.querySelector<HTMLElement>('[data-ui="VirtualCards"]');
    expect(Number.parseFloat(frame!.style.height)).toBeGreaterThan(items.length * 10);
  });

  it("draws the first row at its full column count on mount", () => {
    const { container } = mount("grid");

    expect(cardsInFirstRow(container)).toBe(4);
  });

  it("counts the columns again when the view mode changes", () => {
    const { container, rerender } = mount("list");
    expect(cardsInFirstRow(container)).toBe(1);

    rerender(cards("grid"));

    expect(cardsInFirstRow(container)).toBe(4);
  });
});
