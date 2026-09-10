import { WarningIcon } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useRef } from "react";
import { create } from "zustand";

import { twMerge } from "@/utils";

import { Button } from "./Button";
import { Dialog, type DialogOverlaySize } from "./Dialog";

/** How grave the answer is, as the callout's hue and the confirm button's fill. */
export type ConfirmTone = "danger" | "warning";

const toneClasses: Record<ConfirmTone, { callout: string; heading: string }> = {
  /* DS-TEXT. */
  danger: { callout: "border-danger/30 bg-danger/10", heading: "text-danger-text" },
  warning: { callout: "border-warning/30 bg-warning/10", heading: "text-warning-text" },
};

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** What the dialog is called, in its header. */
  title: ReactNode;
  /** The question, as the callout's own line. Without it the body is plain prose. */
  heading?: ReactNode;
  /** What confirming does, under the heading. */
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: () => void;
  /** Whether the answer is still being acted on, which spins the confirm button. */
  pending?: boolean;
  tone?: ConfirmTone;
  /** The glyph beside the heading. */
  icon?: ReactNode;
  size?: DialogOverlaySize;
  /** Whatever else the reader needs to decide, under the description. */
  children?: ReactNode;
}

/**
 * A dialog that asks one question and offers one destructive answer.
 *
 * With a `heading` the body is a toned callout, and without one it is the
 * `description` as plain prose. Anything more than that is its own dialog.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  heading,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  pending,
  tone = "danger",
  icon,
  size = "sm",
  children,
}: ConfirmDialogProps) {
  const { callout, heading: headingClass } = toneClasses[tone];

  return (
    <Dialog.Shell open={open} onClose={onClose} title={title} size={size}>
      <Dialog.Body>
        {heading === undefined && (
          <div className="text-sm text-surface-400">
            {description}
            {children}
          </div>
        )}

        {heading !== undefined && (
          <div className={twMerge("flex items-start gap-3 rounded-lg border p-4", callout)}>
            <span className={twMerge("mt-0.5 shrink-0", headingClass)}>
              {icon ?? <WarningIcon className="h-5 w-5" weight="bold" />}
            </span>
            <div className="min-w-0">
              <h3 className={twMerge("font-medium", headingClass)}>{heading}</h3>
              {description !== undefined && (
                <p className="mt-1 text-sm text-surface-400">{description}</p>
              )}
              {children}
            </div>
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** What a `confirm()` call asks, minus everything the host answers for itself. */
export type ConfirmRequest = Omit<ConfirmDialogProps, "open" | "onClose" | "onConfirm" | "pending">;

interface ConfirmHostStore {
  /** The question on screen, and what to settle its promise with. */
  pending: (ConfirmRequest & { settle: (answer: boolean) => void }) | null;
  ask: (request: ConfirmRequest, settle: (answer: boolean) => void) => void;
  answer: (answer: boolean) => void;
}

const useConfirmHostStore = create<ConfirmHostStore>()((set, get) => ({
  pending: null,
  /* A second question replaces the first, which the first's caller reads as a
     refusal - nothing may act on an answer the reader never gave. */
  ask: (request, settle) => {
    get().pending?.settle(false);
    set({ pending: { ...request, settle } });
  },
  answer: (answer) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.settle(answer);
  },
}));

/**
 * Ask one destructive question, from wherever the reader asked for it.
 *
 * The dialog is mounted by `ConfirmHost` rather than by the caller, so a menu
 * that unmounts as it closes can still raise one. A question that needs its own
 * pending state or its own fields is a `ConfirmDialog` the caller mounts.
 */
export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const ask = useConfirmHostStore((s) => s.ask);
  return useCallback((request) => new Promise<boolean>((resolve) => ask(request, resolve)), [ask]);
}

/** Where every `useConfirm` question draws. Mounted once, above the router. */
export function ConfirmHost() {
  const pending = useConfirmHostStore((s) => s.pending);
  const answer = useConfirmHostStore((s) => s.answer);

  /* The request outlives its own dismissal by one transition, so the dialog
     animates out on the text it was asking rather than on nothing. */
  const shown = useRef<ConfirmRequest | null>(null);
  if (pending) shown.current = pending;
  const request = shown.current;
  if (!request) return null;

  return (
    <ConfirmDialog
      {...request}
      open={pending !== null}
      onClose={() => answer(false)}
      onConfirm={() => answer(true)}
    />
  );
}
