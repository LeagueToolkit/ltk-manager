import { Popover as BasePopover } from "@base-ui/react/popover";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Root
export interface PopoverRootProps extends BasePopover.Root.Props {
  children?: ReactNode;
}

export const PopoverRoot = ({ children, ...props }: PopoverRootProps) => {
  return <BasePopover.Root {...props}>{children}</BasePopover.Root>;
};
PopoverRoot.displayName = "Popover.Root";

// Trigger
export interface PopoverTriggerProps extends Omit<BasePopover.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverTrigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BasePopover.Trigger ref={ref} className={className} {...props}>
        {children}
      </BasePopover.Trigger>
    );
  },
);
PopoverTrigger.displayName = "Popover.Trigger";

// Portal
export interface PopoverPortalProps extends BasePopover.Portal.Props {
  children?: ReactNode;
}

export const PopoverPortal = ({ children, ...props }: PopoverPortalProps) => {
  return <BasePopover.Portal {...props}>{children}</BasePopover.Portal>;
};
PopoverPortal.displayName = "Popover.Portal";

// Backdrop
export interface PopoverBackdropProps extends Omit<BasePopover.Backdrop.Props, "className"> {
  className?: string;
}

export const PopoverBackdrop = forwardRef<HTMLDivElement, PopoverBackdropProps>(
  ({ className, ...props }, ref) => {
    return (
      <BasePopover.Backdrop
        ref={ref}
        className={twMerge("fixed inset-0 z-40", className)}
        {...props}
      />
    );
  },
);
PopoverBackdrop.displayName = "Popover.Backdrop";

// Positioner
export interface PopoverPositionerProps extends Omit<BasePopover.Positioner.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverPositioner = forwardRef<HTMLDivElement, PopoverPositionerProps>(
  ({ className, children, side = "bottom", align = "start", sideOffset = 4, ...props }, ref) => {
    return (
      <BasePopover.Positioner
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={twMerge("z-50", className)}
        {...props}
      >
        {children}
      </BasePopover.Positioner>
    );
  },
);
PopoverPositioner.displayName = "Popover.Positioner";

// Popup
export interface PopoverPopupProps extends Omit<BasePopover.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverPopup = forwardRef<HTMLDivElement, PopoverPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BasePopover.Popup
        ref={ref}
        className={twMerge(
          "rounded-lg border border-surface-600 bg-surface-800 shadow-xl",
          "transition-[opacity,transform] duration-200 ease-out",
          "data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0",
          "data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BasePopover.Popup>
    );
  },
);
PopoverPopup.displayName = "Popover.Popup";

// Arrow
export interface PopoverArrowProps extends Omit<BasePopover.Arrow.Props, "className"> {
  className?: string;
}

export const PopoverArrow = forwardRef<HTMLDivElement, PopoverArrowProps>(
  ({ className, ...props }, ref) => {
    return (
      <BasePopover.Arrow
        ref={ref}
        className={twMerge(
          "fill-surface-800",
          "[&>path:first-child]:stroke-surface-600",
          className,
        )}
        {...props}
      />
    );
  },
);
PopoverArrow.displayName = "Popover.Arrow";

// Title
export interface PopoverTitleProps extends Omit<BasePopover.Title.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverTitle = forwardRef<HTMLHeadingElement, PopoverTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BasePopover.Title
        ref={ref}
        className={twMerge("text-sm font-semibold text-surface-100", className)}
        {...props}
      >
        {children}
      </BasePopover.Title>
    );
  },
);
PopoverTitle.displayName = "Popover.Title";

// Description
export interface PopoverDescriptionProps extends Omit<BasePopover.Description.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverDescription = forwardRef<HTMLParagraphElement, PopoverDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BasePopover.Description
        ref={ref}
        className={twMerge("text-sm text-surface-400", className)}
        {...props}
      >
        {children}
      </BasePopover.Description>
    );
  },
);
PopoverDescription.displayName = "Popover.Description";

// Close
export interface PopoverCloseProps extends Omit<BasePopover.Close.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const PopoverClose = forwardRef<HTMLButtonElement, PopoverCloseProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BasePopover.Close
        ref={ref}
        className={twMerge(
          "inline-flex cursor-pointer items-center justify-center rounded-md",
          "text-surface-200 transition-colors hover:bg-surface-700 active:bg-surface-800",
          className,
        )}
        {...props}
      >
        {children}
      </BasePopover.Close>
    );
  },
);
PopoverClose.displayName = "Popover.Close";

// Compound export
export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Portal: PopoverPortal,
  Backdrop: PopoverBackdrop,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: PopoverArrow,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
};
