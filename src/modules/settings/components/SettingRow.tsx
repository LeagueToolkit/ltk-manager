import { type ReactNode } from "react";

import { HintIcon } from "@/components";

interface SettingRowProps {
  title: ReactNode;
  /** Omit when the control already says what it does, such as a segmented picker. */
  description?: ReactNode;
  /** Detail that would crowd the description, shown on the title's hint icon. */
  hint?: ReactNode;
  control: ReactNode;
  /** An `action` row holds a button, so it must not be a label. Defaults to `toggle`. */
  kind?: "toggle" | "action";
}

/** One labelled setting and its control, sitting on opposite sides of the row. */
export function SettingRow({
  title,
  description,
  hint,
  control,
  kind = "toggle",
}: SettingRowProps) {
  const Row = kind === "toggle" ? "label" : "div";

  return (
    <Row className="flex items-center justify-between gap-4">
      <div className="max-w-xl min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
          {title}
          {hint && <HintIcon content={hint} />}
        </span>
        {description && <span className="block text-sm text-surface-400">{description}</span>}
      </div>
      <div className="shrink-0">{control}</div>
    </Row>
  );
}
