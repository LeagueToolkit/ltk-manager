import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { forwardRef, type ReactElement, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Root/Provider
export interface TooltipProviderProps extends BaseTooltip.Provider.Props {
  children?: ReactNode;
}

export const TooltipProvider = ({ children, ...props }: TooltipProviderProps) => {
  return <BaseTooltip.Provider {...props}>{children}</BaseTooltip.Provider>;
};
TooltipProvider.displayName = "Tooltip.Provider";

// Root
export interface TooltipRootProps extends BaseTooltip.Root.Props {
  children?: ReactNode;
}

export const TooltipRoot = ({ children, ...props }: TooltipRootProps) => {
  return <BaseTooltip.Root {...props}>{children}</BaseTooltip.Root>;
};
TooltipRoot.displayName = "Tooltip.Root";

// Trigger
export interface TooltipTriggerProps extends Omit<BaseTooltip.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const TooltipTrigger = forwardRef<HTMLButtonElement, TooltipTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseTooltip.Trigger ref={ref} className={className} {...props}>
        {children}
      </BaseTooltip.Trigger>
    );
  },
);
TooltipTrigger.displayName = "Tooltip.Trigger";

// Portal
export interface TooltipPortalProps extends BaseTooltip.Portal.Props {
  children?: ReactNode;
}

export const TooltipPortal = ({ children, ...props }: TooltipPortalProps) => {
  return <BaseTooltip.Portal {...props}>{children}</BaseTooltip.Portal>;
};
TooltipPortal.displayName = "Tooltip.Portal";

// Positioner
export interface TooltipPositionerProps extends Omit<BaseTooltip.Positioner.Props, "className"> {
  className?: string;
  children?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export const TooltipPositioner = forwardRef<HTMLDivElement, TooltipPositionerProps>(
  ({ className, children, side = "top", align = "center", sideOffset = 8, ...props }, ref) => {
    return (
      <BaseTooltip.Positioner
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={twMerge("z-50", className)}
        {...props}
      >
        {children}
      </BaseTooltip.Positioner>
    );
  },
);
TooltipPositioner.displayName = "Tooltip.Positioner";

// Popup (content)
export interface TooltipPopupProps extends Omit<BaseTooltip.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const TooltipPopup = forwardRef<HTMLDivElement, TooltipPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseTooltip.Popup
        ref={ref}
        className={twMerge(
          "rounded-md bg-surface-800 px-3 py-1.5 text-sm text-surface-100 shadow-lg",
          "border border-surface-700",
          "animate-fade-in",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseTooltip.Popup>
    );
  },
);
TooltipPopup.displayName = "Tooltip.Popup";

// Arrow
export interface TooltipArrowProps extends Omit<BaseTooltip.Arrow.Props, "className"> {
  className?: string;
}

export const TooltipArrow = forwardRef<HTMLDivElement, TooltipArrowProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseTooltip.Arrow
        ref={ref}
        className={twMerge(
          "fill-surface-800",
          "[&>path:first-child]:stroke-surface-700",
          className,
        )}
        {...props}
      />
    );
  },
);
TooltipArrow.displayName = "Tooltip.Arrow";

// Compound export (primitives for advanced/custom tooltip layouts)
export const TooltipPrimitives = {
  Provider: TooltipProvider,
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Portal: TooltipPortal,
  Positioner: TooltipPositioner,
  Popup: TooltipPopup,
  Arrow: TooltipArrow,
};

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  showArrow?: boolean;
  /** Hover delay in ms before opening. Base UI's own default is 600. */
  delay?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  sideOffset = 8,
  showArrow = true,
  delay,
}: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
          <BaseTooltip.Popup
            className={twMerge(
              "rounded-md bg-surface-800 px-3 py-1.5 text-sm text-surface-100 shadow-lg",
              "border border-surface-700",
              "animate-fade-in",
              "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            {showArrow && (
              <BaseTooltip.Arrow className="fill-surface-800 [&>path:first-child]:stroke-surface-700" />
            )}
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
