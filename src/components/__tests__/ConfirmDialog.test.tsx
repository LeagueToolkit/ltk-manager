// @vitest-environment happy-dom

import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog, ConfirmHost, useConfirm } from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  it("draws the heading in a callout and the description under it", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        title="Delete Project"
        heading="Delete Fiora VFX?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Delete Fiora VFX?" })).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("draws the description as prose when there is no heading", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        title="Close without saving?"
        description="Closing it now throws the changes away."
        confirmLabel="Discard changes"
        onConfirm={() => {}}
      />,
    );

    expect(screen.queryByRole("heading", { name: /throws/ })).not.toBeInTheDocument();
    expect(screen.getByText("Closing it now throws the changes away.")).toBeInTheDocument();
  });

  it("answers the confirm button and the cancel button apart", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        title="Delete Layer"
        confirmLabel="Delete Layer"
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete Layer" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("withholds cancel while the answer is still being acted on", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        title="Delete Layer"
        confirmLabel="Delete Layer"
        onConfirm={() => {}}
        pending
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("useConfirm", () => {
  function setup() {
    const { result } = renderHook(() => useConfirm());
    render(<ConfirmHost />);
    return result;
  }

  it("settles true once the reader confirms", async () => {
    const confirm = setup();

    let answer: boolean | undefined;
    act(() => {
      void confirm
        .current({ title: "Clear list", confirmLabel: "Clear" })
        .then((value) => (answer = value));
    });

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(answer).toBe(true);
  });

  it("settles false once the reader cancels", async () => {
    const confirm = setup();

    let answer: boolean | undefined;
    act(() => {
      void confirm
        .current({ title: "Clear list", confirmLabel: "Clear" })
        .then((value) => (answer = value));
    });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toBe(false);
  });

  it("refuses a question a second one replaced", async () => {
    const confirm = setup();

    let first: boolean | undefined;
    act(() => {
      void confirm
        .current({ title: "First", confirmLabel: "First" })
        .then((value) => (first = value));
    });
    act(() => {
      void confirm.current({ title: "Second", confirmLabel: "Second" });
    });
    await Promise.resolve();

    expect(first).toBe(false);
    expect(screen.getByRole("button", { name: "Second" })).toBeInTheDocument();
  });
});
