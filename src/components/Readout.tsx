import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  use,
  useRef,
  useState,
} from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { FieldDiscardContext } from "./FieldDiscardContext";
import { InputDefaultContext } from "./InputDefaultContext";
import { stepNumber } from "./stepNumber";

export interface ReadoutProps {
  /**
   * The value as text, which is the only shape that carries every kind.
   *
   * A 64-bit integer does not survive a JS number, so a caller holding one passes the
   * digits it was given rather than parsing them.
   */
  value: string;
  /** Placeholder text for an implicit value, including an empty string. */
  placeholder?: string;
  /** The letter naming one component of a vector or a colour, drawn left of the value. */
  label?: string;
  labelClassName?: string;
  "aria-label"?: string;
  /** The room the value takes. Not the label, which is as wide as its letter. */
  className?: string;
  /** Take an edit, as the text the field holds when it is left or Enter is pressed. */
  onCommit?: (text: string) => void;
  /** The last text the field committed was refused. */
  invalid?: boolean;
  /** Focus the field and select its text on mount, for a field that opens to be typed in. */
  autoFocus?: boolean;
  /** The field was left, after any commit. */
  onLeave?: () => void;
  /** The field was left by a bare `Enter`, after the commit and `onLeave`. */
  onEnter?: () => void;
  /** Arrow and button steps. Integer steps preserve all digits and ignore the fine modifier. */
  step?: number | "integer";
}

/**
 * A value in the field it is edited in, or will be.
 *
 * The field is drawn at rest rather than on hover, so a value reads as something the
 * document holds rather than as text laid over the row. A read-only one takes no focus,
 * because a document of them would otherwise be a tab order thousands of stops long.
 * An editable one holds its draft until the value it was typed over changes.
 */
export function Readout({
  value,
  placeholder: placeholderText,
  label,
  labelClassName,
  "aria-label": ariaLabel,
  className,
  onCommit,
  invalid = false,
  autoFocus = false,
  onLeave,
  onEnter,
  step,
}: ReadoutProps) {
  const implicit = use(InputDefaultContext);
  const discard = use(FieldDiscardContext);
  const [draft, setDraft] = useState<{ text: string; over: string; implicit: boolean } | null>(
    null,
  );
  if (draft !== null && (draft.over !== value || draft.implicit !== implicit)) {
    setDraft(null);
  }

  /* An Escape blurs the field in the same handler, before the discarded draft re-renders. */
  const discarding = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editable = onCommit !== undefined;
  const wrapped = label !== undefined || (editable && step !== undefined);
  const hasDraft = draft !== null && draft.over === value && draft.implicit === implicit;
  const placeholder = implicit && !hasDraft;
  const shown = hasDraft ? draft.text : implicit ? "" : value;

  function commit() {
    if (discarding.current) {
      discarding.current = false;
    } else if (hasDraft && (draft.text !== value || implicit)) {
      onCommit?.(draft.text);
    }

    onLeave?.();
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (
      step !== undefined &&
      !event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      event.stopPropagation();
      nudge(event.key === "ArrowUp" ? 1 : -1, event.ctrlKey || event.metaKey, event.shiftKey);

      return;
    }

    if (event.key === "Enter") {
      event.currentTarget.blur();
      if (!event.ctrlKey && !event.metaKey) {
        onEnter?.();
      }
    }

    if (event.key === "Escape") {
      discarding.current = true;
      setDraft(null);
      discard?.();
      event.currentTarget.blur();
    }
  }

  function nudge(direction: number, fine: boolean, coarse: boolean) {
    if (step === undefined) {
      return;
    }

    const next = stepNumber(placeholder ? value : shown, step, direction, fine, coarse);
    if (next !== null) {
      setDraft({ text: next, over: value, implicit });
    }
  }

  const field = (
    <input
      ref={input}
      type="text"
      readOnly={!editable}
      tabIndex={editable ? 0 : -1}
      value={shown}
      placeholder={implicit ? (placeholderText ?? value) : undefined}
      aria-label={ariaLabel ?? label}
      aria-invalid={invalid || undefined}
      title={step !== undefined && editable ? m.common_number_step_hint() : undefined}
      data-draft={(hasDraft && (shown !== value || implicit)) || undefined}
      data-value-field={editable || undefined}
      autoFocus={autoFocus}
      onFocus={autoFocus ? (event) => event.currentTarget.select() : undefined}
      data-ui="Readout"
      className={twMerge(
        "h-[var(--readout-height,auto)] min-w-0 bg-surface-veil-soft px-[var(--readout-padding-x,0.375rem)] py-0.5",
        "font-mono text-surface-200 tabular-nums select-text focus:outline-none",
        editable ? "cursor-text" : "cursor-default",
        /* DS-VEIL, DS-HOVER, DS-RADIUS. The wrapper draws them for a labelled one. */
        !wrapped &&
          "rounded-sm border border-surface-veil transition-colors hover:border-accent-hover",
        !wrapped && editable && "focus:border-accent-500",
        !wrapped && invalid && "border-danger",
        placeholder &&
          "border-dashed bg-transparent placeholder:text-surface-400 focus:border-solid",
        className,
      )}
      onClick={keepRowShut}
      onChange={
        editable
          ? (event) => setDraft({ text: event.target.value, over: value, implicit })
          : undefined
      }
      onKeyDown={editable ? keys : undefined}
      onBlur={editable ? commit : undefined}
    />
  );

  if (!wrapped) {
    return field;
  }

  /* The letter rides a rung above the value, so the pair reads as one control with a
     named half rather than as a caption beside a box. */
  return (
    <span
      /* DS-VEIL, DS-HOVER, DS-RADIUS */
      className={twMerge(
        "inline-flex min-w-0 items-stretch overflow-hidden rounded-sm border border-surface-veil transition-colors hover:border-accent-hover",
        editable && "focus-within:border-accent-500",
        invalid && "border-danger",
        placeholder && "border-dashed focus-within:border-solid",
      )}
    >
      {label !== undefined && (
        <span
          aria-hidden
          /* DS-WEIGHT-TIER: weight rather than size, which a dense row has no room for. */
          className={twMerge(
            "flex items-center bg-surface-veil px-[var(--readout-padding-x,0.375rem)] font-mono font-semibold text-surface-300 select-none",
            labelClassName,
            placeholder && "bg-transparent text-surface-400",
          )}
        >
          {label}
        </span>
      )}
      {field}
      {editable && step !== undefined && (
        <span className="flex shrink-0 flex-col border-l border-surface-veil">
          {[1, -1].map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={
                direction === 1
                  ? m.common_number_increase_action()
                  : m.common_number_decrease_action()
              }
              className="flex h-[calc(var(--readout-height,1.5rem)/2)] w-[var(--readout-step-width,1rem)] items-center justify-center text-fine text-surface-400 hover:bg-surface-veil hover:text-surface-100"
              onMouseDown={(event) => {
                event.preventDefault();
                input.current?.focus();
              }}
              onClick={(event) => {
                event.stopPropagation();
                input.current?.focus();
                nudge(direction, event.ctrlKey || event.metaKey, event.shiftKey);
              }}
            >
              {direction === 1 && "+"}
              {direction === -1 && "−"}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/* The field is a control of its own, so a click that lands in it is not the row's. */
function keepRowShut(event: ReactMouseEvent<HTMLInputElement>) {
  event.stopPropagation();
}
