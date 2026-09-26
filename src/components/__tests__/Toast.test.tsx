// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { type ToastTask, useToast } from "../Toast";
import { ToastProvider } from "../ToastProvider";

/** Raises one toast on mount, which is how every caller reaches the manager. */
function Raise({ action, timeout }: { action?: () => void; timeout?: number }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.toast({
          title: "Detected issues with mods",
          timeout,
          action: action && { label: "Show me", onClick: action },
        })
      }
    >
      Raise
    </button>
  );
}

async function raise(props: { action?: () => void; timeout?: number } = {}) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <Raise {...props} />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Raise" }));
  return user;
}

const line = () => screen.queryByText("Detected issues with mods");

describe("ToastItem", () => {
  /* Story: the reader pressed Show me, the panel opened, and the toast stayed
     sitting over it - the same press asked for twice. */
  it("closes itself when its action is taken", async () => {
    const action = vi.fn();
    const user = await raise({ action });
    expect(line()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show me" }));

    expect(action).toHaveBeenCalled();
    await waitFor(() => expect(line()).not.toBeInTheDocument());
  });

  it("goes away when its countdown runs out", async () => {
    await raise({ timeout: 200 });
    expect(line()).toBeInTheDocument();

    await waitFor(() => expect(line()).not.toBeInTheDocument(), { timeout: 3000 });
  });
});

describe("useToast", () => {
  /* Story: the sweep reported twice per mod, and every card in the library
     drew itself again on each report, seconds behind the backend. */
  it("re-renders no caller when a task reports", async () => {
    let renders = 0;
    let task: ToastTask | undefined;
    function Bystander() {
      useToast();
      renders += 1;
      return null;
    }
    function Runner() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            task = toast.task("Checking your mods");
          }}
        >
          Start
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Bystander />
        <Runner />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    const before = renders;

    act(() => {
      task?.report(50, "20 of 41");
      task?.report(75, "30 of 41");
    });

    expect(await screen.findByText("30 of 41")).toBeInTheDocument();
    expect(renders).toBe(before);
  });

  /* Story: an install check used the CPU for minutes and its toast had no
     button to stop it. */
  it("keeps a task's stop action through its reports", async () => {
    const stop = vi.fn();
    let task: ToastTask | undefined;
    function Runner() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            task = toast.task("Checking your mods", undefined, { label: "Stop", onClick: stop });
          }}
        >
          Start
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Runner />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));

    act(() => task?.report(50, "0 of 1"));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(stop).toHaveBeenCalled();
  });

  /* Story: the sweep announced what it found from its mount effect, which ran
     before the provider had started listening, and nothing was shown. */
  it("shows a toast raised from a mount effect", async () => {
    function Announcer() {
      const toast = useToast();
      useEffect(() => {
        toast.info("Some of your mods contain non-fatal issues");
      }, [toast]);
      return null;
    }
    render(
      <ToastProvider>
        <Announcer />
      </ToastProvider>,
    );

    expect(
      await screen.findByText("Some of your mods contain non-fatal issues"),
    ).toBeInTheDocument();
  });
});
