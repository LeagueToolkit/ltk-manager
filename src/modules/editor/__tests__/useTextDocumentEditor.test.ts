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
function draw(
  saved: string | null | undefined,
  save: (text: string) => Promise<unknown>,
  reader: (error: unknown) => Refusal | null = refusalOf,
) {
  return renderHook(
    (props: { saved: string | null | undefined; file: string }) =>
      useTextDocumentEditor<unknown, Refusal>({ ...props, save, refusalOf: reader }),
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

  it("takes no edit before the file is read", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = draw(undefined, save);

    act(() => result.current.setText("typed into a file nobody has read"));

    expect(result.current.text).toBe("");
    await settle(DELAY_MS * 4);
    expect(save).not.toHaveBeenCalled();

    rerender({ saved: "what the file holds\n", file: "one" });
    expect(result.current.text).toBe("what the file holds\n");
  });

  it("writes a buffer once while the file lags behind it", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();
    expect(save).toHaveBeenCalledOnce();

    /* The file still reports the old text, and the buffer is not rewritten. */
    await settle(DELAY_MS * 4);
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.saveState).toBe("clean");
  });

  it("carries on after a save that throws where it stands", async () => {
    const save = vi.fn(() => {
      throw new Error("the bridge is gone");
    });
    const { result } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();

    expect(result.current.saveState).toBe("failed");

    act(() => result.current.setText("three"));
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("carries on when the refusal reader throws", async () => {
    const save = vi.fn().mockRejectedValue("not an error at all");
    const reader = () => {
      throw new TypeError("read a field off nothing");
    };
    const { result } = draw("one\n", save, reader);

    act(() => result.current.setText("two"));
    await settle();

    expect(result.current.saveState).toBe("failed");
    expect(result.current.refusal).toBeNull();
  });

  it("leaves the new file alone when a save for the old one answers late", async () => {
    let land: (reason: unknown) => void = () => {};
    const save = vi.fn(() => new Promise<void>((_, reject) => (land = reject)));
    const { result, rerender } = draw("one\n", save);

    act(() => result.current.setText("two"));
    await settle();
    expect(result.current.saveState).toBe("saving");

    rerender({ saved: "other\n", file: "two" });
    await act(async () => {
      land(new RefusedError(9));
    });

    expect(result.current.saveState).toBe("clean");
    expect(result.current.refusal).toBeNull();

    /* The new file's buffer saves on its own, rather than waiting on a write
       that belonged to the file before it. */
    act(() => result.current.setText("edited"));
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
