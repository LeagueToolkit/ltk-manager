// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeys } from "../useKeys";

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKeys", () => {
  it("runs the handler of the command on the press's chord and prevents its default", () => {
    const save = vi.fn();
    renderHook(() => useKeys("editor", { "editor.save": save }));

    const event = press("s", { ctrlKey: true });

    expect(save).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("answers the narrowest scope first and stops there", () => {
    const restore = vi.fn();
    const clear = vi.fn();
    renderHook(() => useKeys("editor", { "editor.restorePanel": restore }));
    renderHook(() => useKeys("document:map", { "map.selectNone": clear }));

    press("Escape");

    expect(clear).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });

  it("passes the press to a wider scope when a handler declines it", () => {
    const restore = vi.fn();
    renderHook(() => useKeys("editor", { "editor.restorePanel": restore }));
    renderHook(() => useKeys("document:map", { "map.selectNone": () => false }));

    const event = press("Escape");

    expect(restore).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a declined press with its default action", () => {
    renderHook(() => useKeys("editor", { "editor.undo": () => false }));

    expect(press("z", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("answers nothing while disabled", () => {
    const close = vi.fn();
    renderHook(() => useKeys("editor", { "editor.closeTab": close }, { enabled: false }));

    press("w", { ctrlKey: true });

    expect(close).not.toHaveBeenCalled();
  });

  it("answers a press from inside its element alone", () => {
    const box = document.createElement("div");
    const inside = document.createElement("button");
    box.appendChild(inside);
    document.body.appendChild(box);
    const play = vi.fn();
    renderHook(() => useKeys("document:skin", { "skin.play": play }, { ref: { current: box } }));

    press(" ", {}, document.body);
    expect(play).not.toHaveBeenCalled();

    press(" ", {}, inside);
    expect(play).toHaveBeenCalledOnce();
  });

  it("skips a command whose guard fails", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const home = vi.fn();
    renderHook(() => useKeys("app", { "app.home": home }));

    press("1", { ctrlKey: true, code: "Digit1" }, input);

    expect(home).not.toHaveBeenCalled();
  });

  it("stops listening once the last scope unmounts", () => {
    const save = vi.fn();
    const { unmount } = renderHook(() => useKeys("editor", { "editor.save": save }));
    unmount();

    press("s", { ctrlKey: true });

    expect(save).not.toHaveBeenCalled();
  });
});
