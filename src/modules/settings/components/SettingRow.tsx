import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { HintIcon } from "@/components";

interface SettingRowProps {
  title: ReactNode;
  /** Omit when the control already says what it does, such as a segmented picker. */
  description?: ReactNode;
  /** Detail that would crowd the description, shown on the title's hint icon. */
  hint?: ReactNode;
  control: ReactNode;
  /** Sizes the control slot, for a control with no width of its own. */
  controlClassName?: string;
  /** An `action` row holds a button, so it must not be a label. Defaults to `toggle`. */
  kind?: "toggle" | "action";
  /** `stacked` drops a full-width control under the label, for an editor the right slot cannot hold. */
  layout?: "inline" | "stacked";
}

/** One labelled setting and its control, across the row from it or beneath it. */
export function SettingRow({
  title,
  description,
  hint,
  control,
  controlClassName,
  kind = "toggle",
  layout = "inline",
}: SettingRowProps) {
  const stacked = layout === "stacked";
  /* A stacked control is composite, so a wrapping label would aim every click at its first input. */
  const Row = kind === "toggle" && !stacked ? "label" : "div";

  return (
    <Row className={stacked ? "flex flex-col gap-2" : "flex items-center justify-between gap-4"}>
      <div className="max-w-xl min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
          {title}
          {hint && <HintIcon content={hint} />}
        </span>
        {description && <span className="block text-sm text-surface-400">{description}</span>}
      </div>
      <div className={twMerge(stacked ? "min-w-0" : "shrink-0", controlClassName)}>{control}</div>
    </Row>
  );
}
