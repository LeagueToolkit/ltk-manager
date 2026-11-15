// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetHelpDialog } from "@/stores/getHelp";
import { useNotificationsStore } from "@/stores/notifications";

import { type ToastData, type ToastTask, toastToEvict, useToast } from "../Toast";
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

/** Raises whatever `raiseAll` raises, from one button under the provider. */
async function raiseWith(raiseAll: (toast: ReturnType<typeof useToast>) => void) {
  function Raiser() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => raiseAll(toast)}>
        Raise
      </button>
    );
  }
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <Raiser />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Raise" }));
  return user;
}

const countdowns = () => document.querySelectorAll("[data-toast-countdown]");

describe("the toast stack", () => {
  beforeEach(() => useNotificationsStore.getState().dismissAll());

  it("gives an error no countdown, so it stays until it is dismissed", async () => {
    const user = await raiseWith((toast) => {
      toast.error("Install failed");
      toast.success("Mod installed");
    });

    expect(await screen.findByText("Install failed")).toBeInTheDocument();
    expect(countdowns()).toHaveLength(1);

    /* Base UI hides the close buttons from the accessibility tree until the stack is entered. */
    const [dismissError] = screen.getAllByLabelText("Close").slice(-1);
    await user.click(dismissError as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Install failed")).not.toBeInTheDocument());
  });

  it("holds every countdown while the pointer is on one toast", async () => {
    const user = await raiseWith((toast) => {
      toast.toast({ title: "First", timeout: 300 });
      toast.toast({ title: "Second", timeout: 300 });
    });

    await user.hover(await screen.findByText("First"));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    await user.unhover(screen.getByText("First"));
    await waitFor(() => expect(screen.queryByText("Second")).not.toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText("First")).not.toBeInTheDocument();
  });

  it("closes the oldest timed toast for a fifth", async () => {
    await raiseWith((toast) => {
      toast.error("Kept error");
      for (const title of ["One", "Two", "Three", "Four"]) {
        toast.toast({ title, timeout: 60_000 });
      }
    });

    await waitFor(() => expect(screen.queryByText("One")).not.toBeInTheDocument());
    for (const title of ["Kept error", "Two", "Three", "Four"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });

  it("closes the oldest error where all four stay, and records it", async () => {
    await raiseWith((toast) => {
      for (const title of ["First failure", "Second", "Third", "Fourth", "Fifth"]) {
        toast.error(title, "The archive could not be read.");
      }
    });

    await waitFor(() => expect(screen.queryByText("First failure")).not.toBeInTheDocument());
    expect(screen.getByText("Fifth")).toBeInTheDocument();
    expect(useNotificationsStore.getState().notifications).toEqual([
      expect.objectContaining({
        title: "First failure",
        description: "The archive could not be read.",
        type: "error",
      }),
    ]);
  });
});

describe("toastToEvict", () => {
  const live = (id: string, data: ToastData, ending = false) =>
    ({ id, data, transitionStatus: ending ? "ending" : undefined }) as Parameters<
      typeof toastToEvict
    >[0][number];

  it("names nothing while the toasts fit", () => {
    expect(
      toastToEvict([live("b", { timeout: 5000 }), live("a", { timeout: 5000 })], 2),
    ).toBeNull();
  });

  it("does not count a toast that is already leaving", () => {
    const toasts = [live("c", {}), live("b", {}, true), live("a", {})];

    expect(toastToEvict(toasts, 2)).toBeNull();
  });

  it("never closes a running task for room", () => {
    const toasts = [live("c", {}), live("b", { progress: 40 }), live("a", { progress: 10 })];

    expect(toastToEvict(toasts, 2)).toBeNull();
  });

  it("prefers a timed toast to an older one that stays", () => {
    const toasts = [live("c", {}), live("b", { timeout: 5000 }), live("a", {})];

    expect(toastToEvict(toasts, 2)?.id).toBe("b");
  });
});

describe("a failure toast", () => {
  beforeEach(() => {
    useNotificationsStore.getState().dismissAll();
    useGetHelpDialog.getState().close();
  });

  const diskFull = { code: "IO", detail: "disk full", ref: "ab12cd34" };
  const noLeague = { code: "LEAGUE_NOT_FOUND", ref: "ef56ab78" };

  it("shows the code, the detail text and the reference under Details", async () => {
    const user = await raiseWith((toast) => toast.failure("Could not save the file", diskFull));
    expect(screen.queryByText("ab12cd34")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Details" }));

    const details = document.querySelector("[data-ui='Toast:details']");
    expect(details).toHaveTextContent("IO");
    expect(details).toHaveTextContent("ab12cd34");
    expect(details).toHaveTextContent("disk full");
  });

  it("opens Get help with the code and the reference of an unexpected error", async () => {
    const user = await raiseWith((toast) => toast.failure("Could not save the file", diskFull));

    await user.click(await screen.findByRole("button", { name: "Get help" }));

    expect(useGetHelpDialog.getState().payload).toEqual({
      origin: {
        kind: "error",
        error: { title: "Could not save the file", code: "IO", kind: null, ref: "ab12cd34" },
      },
    });
    await waitFor(() =>
      expect(screen.queryByText("Could not save the file")).not.toBeInTheDocument(),
    );
  });

  it("offers Get help for a routine error under Details only", async () => {
    const user = await raiseWith((toast) => toast.failure("Could not start", noLeague));
    await screen.findByText("Could not start");
    expect(screen.queryByRole("button", { name: "Get help" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByRole("button", { name: "Get help" })).toBeInTheDocument();
  });

  it("offers no Details for a value that is not a backend error", async () => {
    await raiseWith((toast) => toast.failure("Could not copy", new Error("denied")));

    expect(await screen.findByText("denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
  });

  it("keeps the code and the reference with the notification", async () => {
    await raiseWith((toast) =>
      toast.failure("Could not save the file", diskFull, { notify: true }),
    );

    const [notification] = useNotificationsStore.getState().notifications;
    expect(notification?.error).toEqual({
      code: "IO",
      kind: null,
      detail: "disk full",
      ref: "ab12cd34",
    });
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
