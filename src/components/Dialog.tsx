import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Root
export interface DialogRootProps extends BaseDialog.Root.Props {
  children?: ReactNode;
}

export const DialogRoot = ({ children, ...props }: DialogRootProps) => {
  return <BaseDialog.Root {...props}>{children}</BaseDialog.Root>;
};
DialogRoot.displayName = "Dialog.Root";

// Trigger
export interface DialogTriggerProps extends Omit<BaseDialog.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const DialogTrigger = forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseDialog.Trigger ref={ref} className={className} {...props}>
        {children}
      </BaseDialog.Trigger>
    );
  },
);
DialogTrigger.displayName = "Dialog.Trigger";

// Portal
export interface DialogPortalProps extends BaseDialog.Portal.Props {
  children?: ReactNode;
}

export const DialogPortal = ({ children, ...props }: DialogPortalProps) => {
  return <BaseDialog.Portal {...props}>{children}</BaseDialog.Portal>;
};
DialogPortal.displayName = "Dialog.Portal";

// Backdrop
export interface DialogBackdropProps extends Omit<BaseDialog.Backdrop.Props, "className"> {
  className?: string;
}

export const DialogBackdrop = forwardRef<HTMLDivElement, DialogBackdropProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseDialog.Backdrop
        ref={ref}
        className={twMerge(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm",
          "transition-opacity duration-200",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      />
    );
  },
);
DialogBackdrop.displayName = "Dialog.Backdrop";

// Overlay (wraps Dialog.Popup with centered layout)
export type DialogOverlaySize = "sm" | "md" | "lg" | "xl";

const overlaySizeClasses: Record<DialogOverlaySize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export interface DialogOverlayProps extends Omit<BaseDialog.Popup.Props, "className"> {
  size?: DialogOverlaySize;
  className?: string;
  children?: ReactNode;
}

export const DialogOverlay = forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ size = "md", className, children, ...props }, ref) => {
    return (
      <BaseDialog.Popup
        ref={ref}
        className={twMerge(
          "fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2",
          "rounded-xl border border-surface-600 bg-surface-800 shadow-2xl",
          "transition-[opacity,transform] duration-200 ease-out",
          "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
          overlaySizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    );
  },
);
DialogOverlay.displayName = "Dialog.Overlay";

// Title
export interface DialogTitleProps extends Omit<BaseDialog.Title.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseDialog.Title
        ref={ref}
        className={twMerge("text-lg font-semibold text-surface-100", className)}
        {...props}
      >
        {children}
      </BaseDialog.Title>
    );
  },
);
DialogTitle.displayName = "Dialog.Title";

// Description
export interface DialogDescriptionProps extends Omit<BaseDialog.Description.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const DialogDescription = forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseDialog.Description
        ref={ref}
        className={twMerge("text-sm text-surface-400", className)}
        {...props}
      >
        {children}
      </BaseDialog.Description>
    );
  },
);
DialogDescription.displayName = "Dialog.Description";

// Close (renders as IconButton with X icon)
export interface DialogCloseProps extends Omit<BaseDialog.Close.Props, "className" | "children"> {
  className?: string;
}

export const DialogClose = forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseDialog.Close
        ref={ref}
        className={twMerge(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          "text-surface-200 transition-colors hover:bg-surface-700 active:bg-surface-800",
          className,
        )}
        {...props}
      >
        <X className="h-5 w-5" />
      </BaseDialog.Close>
    );
  },
);
DialogClose.displayName = "Dialog.Close";

// Header (layout: title + close button row)
export interface DialogHeaderProps {
  className?: string;
  children?: ReactNode;
}

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, children }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          "flex items-center justify-between border-b border-surface-600 px-6 py-4",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
DialogHeader.displayName = "Dialog.Header";

// Body (layout: padded content area)
export interface DialogBodyProps {
  className?: string;
  children?: ReactNode;
}

export const DialogBody = forwardRef<HTMLDivElement, DialogBodyProps>(
  ({ className, children }, ref) => {
    return (
      <div ref={ref} className={twMerge("px-6 py-4", className)}>
        {children}
      </div>
    );
  },
);
DialogBody.displayName = "Dialog.Body";

// Footer (layout: right-aligned action buttons)
export interface DialogFooterProps {
  className?: string;
  children?: ReactNode;
}

export const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ className, children }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          "flex justify-end gap-3 border-t border-surface-600 px-6 py-4",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
DialogFooter.displayName = "Dialog.Footer";

// Compound export
export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Overlay: DialogOverlay,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
};
