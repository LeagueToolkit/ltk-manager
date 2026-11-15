import { type ComponentProps, Fragment, useState } from "react";

import { m } from "@/paraglide/messages";
import { twMerge } from "@/utils";
import { type ErrorDetails, errorDetailsText, isUnexpectedCode } from "@/utils/errors";

import { focusRing } from "./focus";

/** One action in the row under the description of a toast. */
export function ToastActionButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={twMerge(
        "cursor-pointer rounded-sm text-sm font-medium text-accent-400 transition-colors hover:text-accent-300",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

interface ToastErrorActionsProps {
  /** The title of the toast, which `Copy` puts on the first line. */
  title: string;
  details: ErrorDetails;
  /** Whether the toast shows the details block. */
  expanded: boolean;
  onToggle: () => void;
  onGetHelp: () => void;
}

/**
 * The actions of a toast that reports a backend error: `Details`, `Get help` and `Copy`.
 *
 * `Get help` shows beside `Details` for a code that the manager does not expect in normal use.
 * A routine code offers it under `Details` only, so that a refusal such as a League path that
 * is not set does not invite a report.
 */
export function ToastErrorActions({
  title,
  details,
  expanded,
  onToggle,
  onGetHelp,
}: ToastErrorActionsProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(errorDetailsText(title, details)).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <>
      <ToastActionButton aria-expanded={expanded} onClick={onToggle}>
        {m.common_error_details_action()}
      </ToastActionButton>
      {(expanded || isUnexpectedCode(details.code)) && (
        <ToastActionButton onClick={onGetHelp}>{m.common_get_help_action()}</ToastActionButton>
      )}
      {expanded && (
        <ToastActionButton onClick={handleCopy}>
          {copied && m.common_error_details_copied_label()}
          {!copied && m.common_error_details_copy_action()}
        </ToastActionButton>
      )}
    </>
  );
}

/** The code, the kind and the reference of an error as rows, and its detail text under them. */
export function ErrorDetailsBlock({ details }: { details: ErrorDetails }) {
  const rows: Array<[label: string, value: string | null]> = [
    [m.common_error_details_code_label(), details.code],
    [m.common_error_details_kind_label(), details.kind],
    [m.common_error_details_ref_label(), details.ref],
  ];

  return (
    <div
      data-ui="Toast:details"
      className="mt-1 flex flex-col gap-1.5 rounded-md bg-surface-900 px-2.5 py-2"
    >
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(
          ([label, value]) =>
            value !== null && (
              <Fragment key={label}>
                <dt className="text-surface-400">{label}</dt>
                <dd className="font-mono text-surface-200 select-text">{value}</dd>
              </Fragment>
            ),
        )}
      </dl>
      {details.detail && (
        <p className="font-mono text-xs break-words text-surface-300 select-text">
          {details.detail}
        </p>
      )}
    </div>
  );
}
