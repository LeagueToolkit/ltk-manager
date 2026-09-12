import { createContext, type ReactNode, use, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

/** Where a shell's crumb and its Panes menu draw, in the object tab's own header row. */
export interface ShellHeaderSlots {
  readonly crumb: HTMLElement | null;
  readonly panes: HTMLElement | null;
}

export type ShellHeaderSlotName = keyof ShellHeaderSlots;

const NO_SLOTS: ShellHeaderSlots = { crumb: null, panes: null };

/**
 * The header row's slots, which a shell mounted under the tab fills.
 *
 * "One row holds the object tab's header and the crumb", "The shell" in
 * docs/ux/BIN_EDITOR.md. The crumb reads the emitter choice the class view provides, so it
 * is drawn there and portaled up rather than lifted out.
 */
export const ShellHeaderContext = createContext<ShellHeaderSlots>(NO_SLOTS);

/** The slots as the tab's header holds them, and the setter each slot registers through. */
export function useShellHeaderSlots(): [
  ShellHeaderSlots,
  (name: ShellHeaderSlotName, element: HTMLElement | null) => void,
] {
  const [slots, setSlots] = useState<ShellHeaderSlots>(NO_SLOTS);
  const register = useCallback((name: ShellHeaderSlotName, element: HTMLElement | null) => {
    setSlots((held) => (held[name] === element ? held : { ...held, [name]: element }));
  }, []);
  return [slots, register];
}

/** One slot of the header row, which registers its element as it mounts. */
export function ShellHeaderSlot({
  name,
  onElement,
  className,
}: {
  name: ShellHeaderSlotName;
  onElement: (name: ShellHeaderSlotName, element: HTMLElement | null) => void;
  className?: string;
}) {
  return (
    <span
      ref={(element) => onElement(name, element)}
      data-ui={`ShellHeaderSlot:${name}`}
      className={twMerge("flex min-w-0 items-center", className)}
    />
  );
}

/** `children` drawn in the header's `slot`, and `fallback` where the tab offers none. */
export function ShellHeaderPortal({
  slot,
  children,
  fallback = null,
}: {
  slot: ShellHeaderSlotName;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const target = use(ShellHeaderContext)[slot];
  if (target === null) return fallback;
  return createPortal(children, target);
}

/** Whether the tab's header holds the slots, which is when a shell draws no row of its own. */
export function useShellHeaderHeld(): boolean {
  return use(ShellHeaderContext).crumb !== null;
}
