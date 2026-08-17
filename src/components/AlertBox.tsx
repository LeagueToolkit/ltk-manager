import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type AlertBoxVariant = "info" | "success" | "warning" | "error";

export interface AlertBoxProps {
  variant?: AlertBoxVariant;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/* The status token tinting its own border and fill, as the wiki's asides do.
   The icon takes the -text variant: a base-amber glyph on a pale amber fill is
   near-invisible in light mode. */
const variantStyles: Record<AlertBoxVariant, { border: string; bg: string; icon: string }> = {
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

const defaultIcons: Record<AlertBoxVariant, ReactNode> = {
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
  onDismiss,
  className,
}: AlertBoxProps) {
  const styles = variantStyles[variant];
  const resolvedIcon = icon ?? defaultIcons[variant];

  return (
    <div
      role="alert"
      className={twMerge(
        "flex items-center gap-4 rounded-lg border px-4 py-3",
        styles.border,
        styles.bg,
        className,
      )}
    >
      <div className={twMerge("shrink-0", styles.icon)}>{resolvedIcon}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-medium text-surface-100">{title}</p>}
        {children && <div className="text-sm text-surface-400">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
