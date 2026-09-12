// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTextDocumentEditor } from "../useTextDocumentEditor";

const DELAY_MS = 600;

interface Refusal {
  line: number;
}

function refusalOf(error: unknown): Refusal | null {
  if (error instanceof RefusedError) return { line: error.line };
  return null;
}

class RefusedError extends Error {
  constructor(readonly line: number) {
    super(`line ${line}`);
  }
}

/** The hook over one file, with the save the test watches. */
function draw(saved: string | null, save: (text: string) => Promise<unknown>) {
  return renderHook(
    (props: { saved: string | null; file: string }) =>
      useTextDocumentEditor<unknown, Refusal>({ ...props, save, refusalOf }),
    { initialProps: { saved, file: "one" } },
  );
}

async function settle(ms = DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTextDocumentEditor", () => {
  it("reads the file until the buffer is written", () => {
    const { result } = draw("one\n", vi.fn());

    expect(result.current.text).toBe("one\n");
    expect(result.current.saveState).toBe("clean");
  });

  it("writes a settled edit once", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = draw("one\n", save);

    act(() => result.current.setText("one\ntwo\n"));
    expect(result.current.saveState).toBe("pending");
    expect(save).not.toHaveBeenCalled();

    await settle();

    expect(save).toHaveBeenCalledExactlyOnceWith("one\ntwo\n");
  });

  it("writes a burst of edits once", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = draw("one\n", save);

    act(() => result.current.setText("a"));
    await settle(DELAY_MS / 2);
    act(() => result.current.setText("ab"));
    await settle(DELAY_MS / 2);
    act(() => result.current.setText("abc"));
    await settle();

    expect(save).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("reports the write it is running", async () => {
    let land = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
    const { result, rerender } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();
    expect(result.current.saveState).toBe("saving");

    await act(async () => {
      land();
    });
    /* The buffer is clean once the file it was written to reports the text. */
    rerender({ saved: "two", file: "one" });
    expect(result.current.saveState).toBe("clean");
  });

  it("stops writing a buffer the file refused", async () => {
    const save = vi.fn().mockRejectedValue(new RefusedError(2));
    const { result } = draw("one\n", save);

    act(() => result.current.setText("a{b"));
    await settle();

    expect(result.current.saveState).toBe("blocked");
    expect(result.current.refusal).toEqual({ line: 2 });

    await settle(DELAY_MS * 4);
    expect(save).toHaveBeenCalledOnce();
  });

  it("stops writing a buffer the write failed on", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk is gone"));
    const { result } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();

    expect(result.current.saveState).toBe("failed");
    expect(result.current.refusal).toBeNull();

    await settle(DELAY_MS * 4);
    expect(save).toHaveBeenCalledOnce();
  });

  it("asks again on the next edit", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk is gone"));
    const { result } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();

    act(() => result.current.setText("three"));
    expect(result.current.saveState).toBe("pending");
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
  });

  it("writes what the wait still holds when asked", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = draw("one\n", save);

    act(() => result.current.setText("two"));
    act(() => result.current.saveNow());

    expect(save).toHaveBeenCalledExactlyOnceWith("two");

    await settle();
    expect(save).toHaveBeenCalledOnce();
  });

  it("asks for nothing when the buffer matches the file", () => {
    const save = vi.fn();
    const { result } = draw("one\n", save);

    act(() => result.current.setText("one\n"));

    expect(result.current.saveState).toBe("clean");
    act(() => result.current.saveNow());
    expect(save).not.toHaveBeenCalled();
  });

  it("drops the buffer when the file changes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = draw("one\n", save);

    act(() => result.current.setText("edited"));
    rerender({ saved: "other\n", file: "two" });

    expect(result.current.text).toBe("other\n");
    expect(result.current.saveState).toBe("clean");

    await settle(DELAY_MS * 4);
    expect(save).not.toHaveBeenCalled();
  });

  it("follows the file again when the buffer is dropped", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = draw("one\n", save);

    act(() => result.current.setText("edited"));
    act(() => result.current.setText(null));
    rerender({ saved: "written elsewhere\n", file: "one" });

    expect(result.current.text).toBe("written elsewhere\n");
    expect(result.current.saveState).toBe("clean");

    await settle(DELAY_MS * 4);
    expect(save).not.toHaveBeenCalled();
  });

  it("reads an absent file as empty", () => {
    const { result } = draw(null, vi.fn());

    expect(result.current.text).toBe("");
    expect(result.current.saveState).toBe("clean");
  });
});
