import { Button as BaseButton } from "@base-ui/react";
import { Loader2 } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

export type ButtonVariant = "default" | "filled" | "light" | "outline" | "ghost" | "transparent";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends Omit<BaseButton.Props, "className" | "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  compact?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs gap-1",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-10 px-5 text-base gap-2",
  xl: "h-12 px-6 text-lg gap-2.5",
};

const compactSizeClasses: Record<ButtonSize, string> = {
  xs: "h-6 px-1.5 text-xs gap-1",
  sm: "h-7 px-2 text-xs gap-1",
  md: "h-8 px-3 text-sm gap-1.5",
  lg: "h-9 px-4 text-sm gap-2",
  xl: "h-10 px-5 text-base gap-2",
};

const iconOnlySizeClasses: Record<ButtonSize, string> = {
  xs: "h-7 w-7",
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
  xl: "h-12 w-12",
};

const compactIconOnlySizeClasses: Record<ButtonSize, string> = {
  xs: "h-6 w-6",
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
  xl: "h-10 w-10",
};

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-surface-700 text-surface-100 hover:bg-surface-600 active:bg-surface-800",
  filled: "bg-accent-600 text-white hover:bg-accent-500 active:bg-accent-700",
  light: "bg-accent-600/15 text-accent-400 hover:bg-accent-600/25 active:bg-accent-600/35",
  outline:
    "bg-transparent text-surface-200 border border-surface-600 hover:bg-surface-800 active:bg-surface-700",
  ghost: "bg-transparent text-surface-200 hover:bg-surface-700 active:bg-surface-800",
  transparent: "bg-transparent text-surface-300 hover:text-surface-100",
};

const baseClasses =
  "inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 cursor-pointer select-none focus-visible:outline-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

const spinnerSizeClasses: Record<ButtonSize, string> = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
};

const iconSlotSizeClasses: Record<ButtonSize, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  xl: "h-5 w-5",
};

function IconSlot({ children, size }: { children: ReactNode; size: ButtonSize }) {
  return (
    <span
      className={twMerge(
        "inline-flex shrink-0 items-center justify-center",
        iconSlotSizeClasses[size],
      )}
    >
      {children}
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      loading = false,
      compact = false,
      left: leftIcon,
      right: rightIcon,
      children,
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    const isIconOnly = !children && !!(leftIcon || rightIcon);
    const icon = isIconOnly ? leftIcon || rightIcon : null;

    const sizeClass = match([isIconOnly, compact] as const)
      .with([true, true], () => compactIconOnlySizeClasses[size])
      .with([true, false], () => iconOnlySizeClasses[size])
      .with([false, true], () => compactSizeClasses[size])
      .with([false, false], () => sizeClasses[size])
      .exhaustive();

    const classes = twMerge(baseClasses, variantClasses[variant], sizeClass, className);

    const content = match([loading, isIconOnly] as const)
      .with([true, true], [true, false], () => (
        <>
          <span className="animate-fade-in">
            <Loader2 className={twMerge("animate-spin", spinnerSizeClasses[size])} />
          </span>
          {children && <span className="opacity-0">{children}</span>}
        </>
      ))
      .with([false, true], () => <IconSlot size={size}>{icon}</IconSlot>)
      .with([false, false], () => (
        <>
          {leftIcon && <IconSlot size={size}>{leftIcon}</IconSlot>}
          {children}
          {rightIcon && <IconSlot size={size}>{rightIcon}</IconSlot>}
        </>
      ))
      .exhaustive();

    return (
      <BaseButton ref={ref} className={classes} disabled={disabled || loading} {...props}>
        {content}
      </BaseButton>
    );
  },
);

Button.displayName = "Button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "left" | "right"> {
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, ...props }, ref) => {
    return <Button ref={ref} left={icon} {...props} />;
  },
);

IconButton.displayName = "IconButton";
