// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";

import { ToastProvider } from "@/components";

import { useDocumentFind } from "../state/documentFinds";
import { type DocumentHistory, useDocumentHistory } from "../state/documentHistory";
import { useDocumentSave } from "../state/documentSaves";
import { type EditorKeysOptions, useEditorKeys } from "../useEditorKeys";

/**
 * The bindings are matched against `event.code`, which is what the library reads,
 * so every case sends the code the physical key reports rather than the
 * character it produces.
 */
function press(code: string, modifiers: Partial<KeyboardEvent> = {}) {
  act(() => {
    const init = { code, key: code, bubbles: true, ...modifiers };
    document.dispatchEvent(new KeyboardEvent("keydown", init));
    document.dispatchEvent(new KeyboardEvent("keyup", init));
  });
}

const ctrl = { ctrlKey: true };
const ctrlShift = { ctrlKey: true, shiftKey: true };
const alt = { altKey: true };

const TABS = ["alpha", "beta", "gamma"];

function keys(options: Partial<EditorKeysOptions> = {}) {
  const onActivate = vi.fn<(id: string) => void>();
  const onClose = vi.fn<(id: string) => void>();
  const onFindElsewhere = vi.fn<() => void>();

  const rendered = renderHook(
    () =>
      useEditorKeys({
        enabled: true,
        documentIds: TABS,
        activeId: "beta",
        onActivate,
        onClose,
        onFindElsewhere,
        ...options,
      }),
    { wrapper: ToastProvider },
  );

  return { onActivate, onClose, onFindElsewhere, ...rendered };
}

describe("useEditorKeys", () => {
  it("closes the active document on ctrl and w", () => {
    const { onClose } = keys();

    press("KeyW", ctrl);

    expect(onClose).toHaveBeenCalledWith("beta");
  });

  it("reopens the newest closed tab on ctrl, shift and t", () => {
    const onReopenClosed = vi.fn<() => void>();
    keys({ onReopenClosed });

    press("KeyT", ctrlShift);

    expect(onReopenClosed).toHaveBeenCalledTimes(1);
  });

  /* A strip with nothing open still answers the key, because what it puts back
     is held outside that strip. */
  it("reopens from a group holding no tabs", () => {
    const onReopenClosed = vi.fn<() => void>();
    keys({ onReopenClosed, documentIds: [], activeId: null });

    press("KeyT", ctrlShift);

    expect(onReopenClosed).toHaveBeenCalledTimes(1);
  });

  it("walks to the next tab and wraps at the end", () => {
    const { onActivate } = keys();

    press("Tab", ctrl);
    expect(onActivate).toHaveBeenLastCalledWith("gamma");

    onActivate.mockClear();
    const last = keys({ activeId: "gamma" });
    press("Tab", ctrl);
    expect(last.onActivate).toHaveBeenLastCalledWith("alpha");
  });

  it("walks to the previous tab and wraps at the start", () => {
    const { onActivate } = keys({ activeId: "alpha" });

    press("Tab", ctrlShift);

    expect(onActivate).toHaveBeenLastCalledWith("gamma");
  });

  it("walks with the page keys too", () => {
    const { onActivate } = keys();

    press("PageDown", ctrl);
    expect(onActivate).toHaveBeenLastCalledWith("gamma");

    press("PageUp", ctrl);
    expect(onActivate).toHaveBeenLastCalledWith("alpha");
  });

  it("takes a tab by index, and the last one on the ninth key", () => {
    const { onActivate } = keys();

    press("Digit1", alt);
    expect(onActivate).toHaveBeenLastCalledWith("alpha");

    press("Digit3", alt);
    expect(onActivate).toHaveBeenLastCalledWith("gamma");

    /* Nine is the last tab however many the strip holds, as Visual Studio
       Code's is, rather than the ninth of a strip that has no ninth. */
    press("Digit9", alt);
    expect(onActivate).toHaveBeenLastCalledWith("gamma");
  });

  it("leaves an index past the end of the strip alone", () => {
    const { onActivate } = keys();

    press("Digit4", alt);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("answers nothing while another group holds the focus", () => {
    const { onActivate, onClose } = keys({ enabled: false });

    press("Tab", ctrl);
    press("KeyW", ctrl);

    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("answers nothing with no document open", () => {
    const { onActivate, onClose } = keys({ documentIds: [], activeId: null });

    press("Tab", ctrl);
    press("Digit1", alt);
    press("KeyW", ctrl);

    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  /* A dialog or a menu over the editor owns the keyboard while it stands, the
     way the palette does. */
  it("answers nothing while a dialog stands over the editor", () => {
    const { onActivate } = keys();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    press("Tab", ctrl);
    dialog.remove();

    expect(onActivate).not.toHaveBeenCalled();
  });

  /* The palette is a combobox over a listbox rather than a dialog, and a key
     typed into it is the palette's. */
  it("answers nothing while the palette holds the caret", () => {
    const { onActivate, onClose } = keys();
    const box = document.createElement("div");
    box.setAttribute("role", "combobox");
    const field = document.createElement("input");
    box.appendChild(field);
    document.body.appendChild(box);
    field.focus();

    press("Tab", ctrl);
    press("KeyW", ctrl);
    box.remove();

    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("writes the active document on ctrl and s", () => {
    const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderHook(
      () => {
        useDocumentSave("beta", save);
        useEditorKeys({
          enabled: true,
          documentIds: TABS,
          activeId: "beta",
          onActivate: vi.fn(),
          onClose: vi.fn(),
        });
      },
      { wrapper: ToastProvider },
    );

    press("KeyS", ctrl);

    expect(save).toHaveBeenCalledOnce();
  });

  /* A game archive publishes no write, and the key is not an error there. */
  it("writes nothing for a document that offers no save", () => {
    const { onClose } = keys();

    press("KeyS", ctrl);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("reaches the active document's own search box on ctrl and f", () => {
    const reveal = vi.fn<() => void>();
    const onFindElsewhere = vi.fn<() => void>();
    renderHook(
      () => {
        useDocumentFind("beta", reveal);
        useEditorKeys({
          enabled: true,
          documentIds: TABS,
          activeId: "beta",
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onFindElsewhere,
        });
      },
      { wrapper: ToastProvider },
    );

    press("KeyF", ctrl);

    expect(reveal).toHaveBeenCalledOnce();
    expect(onFindElsewhere).not.toHaveBeenCalled();
  });

  it("falls back for a document with no search box of its own", () => {
    const { onFindElsewhere } = keys();

    press("KeyF", ctrl);

    expect(onFindElsewhere).toHaveBeenCalledOnce();
  });

  it("steps the active document's history on ctrl and z, and redoes on ctrl, shift and z or y", () => {
    const history = vi.fn<DocumentHistory>(() => true);
    renderHook(() => useDocumentHistory("beta", history, true));
    keys();

    press("KeyZ", ctrl);
    press("KeyZ", ctrlShift);
    press("KeyY", ctrl);

    expect(history.mock.calls.map(([step]) => step)).toEqual(["undo", "redo", "redo"]);
  });

  it("leaves the history alone for a document that offers none", () => {
    const history = vi.fn<DocumentHistory>(() => true);
    renderHook(() => useDocumentHistory("beta", history, false));
    keys();

    press("KeyZ", ctrl);

    expect(history).not.toHaveBeenCalled();
  });
});
