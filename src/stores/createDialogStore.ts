import { create } from "zustand";

/** One dialog's open state, and what it was opened with. */
export interface DialogStore<T> {
  /** What the dialog was raised with, and `null` while it is closed. */
  payload: T | null;
  isOpen: boolean;
  /** Raising a dialog that carries nothing takes no argument, so a handler can be it. */
  open: [T] extends [void] ? () => void : (payload: T) => void;
  close: () => void;
}

/**
 * A store for one dialog that outlives whatever raised it.
 *
 * A menu unmounts as it closes and would take a dialog of its own with it, so
 * the confirmation lives beside the menu rather than inside it. `T` is `void`
 * for a dialog that carries nothing, which is what `isOpen` is for: a payload
 * of `undefined` cannot say whether the dialog is open.
 */
export function createDialogStore<T = void>() {
  return create<DialogStore<T>>()((set) => ({
    payload: null,
    isOpen: false,
    open: ((payload?: T) =>
      set({ payload: payload ?? null, isOpen: true })) as DialogStore<T>["open"],
    close: () => set({ payload: null, isOpen: false }),
  }));
}
