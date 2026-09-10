import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode } from "react";

import { twMerge } from "@/utils";

export type AlertBoxVariant = "neutral" | "info" | "success" | "warning" | "error";

interface AlertBoxBase {
  variant?: AlertBoxVariant;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  "data-ui"?: string;
}

/**
 * A pressable box carries no dismiss, since the two would nest one button in another.
 */
export type AlertBoxProps = AlertBoxBase &
  (
    | { onClick?: undefined; disabled?: undefined; onDismiss?: () => void }
    | { onClick: () => void; disabled?: boolean; onDismiss?: never }
  );

/* The status token tinting its own border and fill, as the wiki's asides do.
   The icon takes the -text variant: a base-amber glyph on a pale amber fill is
   near-invisible in light mode. */
const variantStyles: Record<AlertBoxVariant, { border: string; bg: string; icon: string }> = {
  neutral: {
    border: "border-surface-700/60",
    bg: "bg-surface-800/40",
    icon: "text-surface-400",
  },
  info: {
    border: "border-info/30",
    bg: "bg-info/8",
    icon: "text-info-text",
  },
  success: {
    border: "border-success/30",
    bg: "bg-success/8",
    icon: "text-success-text",
  },
  warning: {
    border: "border-warning/30",
    bg: "bg-warning/8",
    icon: "text-warning-text",
  },
  error: {
    border: "border-danger/30",
    bg: "bg-danger/8",
    icon: "text-danger-text",
  },
};

/** The wash a step up, so a pressable box answers the pointer in its own hue. */
const hoverStyles: Record<AlertBoxVariant, string> = {
  neutral: "hover:bg-surface-800/70",
  info: "hover:bg-info/12",
  success: "hover:bg-success/12",
  warning: "hover:bg-warning/12",
  error: "hover:bg-danger/12",
};

const defaultIcons: Record<AlertBoxVariant, ReactNode> = {
  neutral: <Info className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />,
  success: <CircleCheck className="h-5 w-5" />,
  warning: <CircleAlert className="h-5 w-5" />,
  error: <CircleX className="h-5 w-5" />,
};

export function AlertBox({
  variant = "info",
  title,
  children,
  icon,
  actions,
  onClick,
  disabled,
  onDismiss,
  className,
  "data-ui": dataUi,
}: AlertBoxProps) {
  const styles = variantStyles[variant];
  const resolvedIcon = icon ?? defaultIcons[variant];

  const body = (
    <>
      <div className={twMerge("shrink-0", styles.icon)}>{resolvedIcon}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-medium text-surface-100">{title}</p>}
        {children && <div className="text-sm text-surface-400">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        data-ui={dataUi}
        disabled={disabled}
        onClick={onClick}
        /* Aligned to the top, so a title that wraps runs under itself and the
           actions stay on the first line rather than centring against a block. */
        className={twMerge(
          "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 text-left transition-colors duration-150",
          styles.border,
          styles.bg,
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
          "disabled:cursor-not-allowed disabled:opacity-70",
          hoverStyles[variant],
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      role="alert"
      data-ui={dataUi}
      className={twMerge(
        "flex items-center gap-2 rounded-lg border px-2 py-2",
        styles.border,
        styles.bg,
        className,
      )}
    >
      {body}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
