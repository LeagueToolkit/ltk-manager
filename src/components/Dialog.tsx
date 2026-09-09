import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import { twMerge } from "@/utils";

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
          "fixed inset-0 z-40 bg-scrim backdrop-blur-sm",
          "transition-opacity duration-200",
          "data-ending-style:opacity-0 data-starting-style:opacity-0",
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
          "rounded-xl border border-surface-600 bg-surface-800 shadow-2xl outline-none",
          "transition-[opacity,transform] duration-200 ease-out",
          "data-starting-style:scale-95 data-starting-style:opacity-0",
          "data-ending-style:scale-95 data-ending-style:opacity-0",
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

// Sheet (a dialog that arrives from an edge rather than the middle)
export type DialogSheetSide = "left" | "right";

const sheetSideClasses: Record<DialogSheetSide, string> = {
  left: "inset-y-0 left-0 data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
  right:
    "inset-y-0 right-0 data-ending-style:translate-x-full data-starting-style:translate-x-full",
};

export interface DialogSheetProps extends Omit<BaseDialog.Popup.Props, "className"> {
  /** Which edge it arrives from, and returns to. */
  side?: DialogSheetSide;
  className?: string;
  children?: ReactNode;
}

/**
 * A dialog anchored to an edge, for content the reader works through beside
 * their page rather than instead of it.
 *
 * It slides rather than scales, because a panel the height of the window has no
 * centre to grow from. Width is the caller's - `Dialog.Overlay`'s size ramp is
 * about how much text a centred dialog should hold, which is a different
 * question.
 */
export const DialogSheet = forwardRef<HTMLDivElement, DialogSheetProps>(
  ({ side = "right", className, children, ...props }, ref) => {
    return (
      <BaseDialog.Popup
        ref={ref}
        className={twMerge(
          "fixed z-50 flex max-w-full flex-col bg-surface-800 shadow-2xl outline-none",
          "transition-transform duration-200 ease-out",
          sheetSideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    );
  },
);
DialogSheet.displayName = "Dialog.Sheet";

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
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md",
          "text-surface-200 transition-colors hover:bg-danger/15 hover:text-danger-text",
          "active:bg-danger/25",
          className,
        )}
        aria-label="Close"
        {...props}
      >
        <X className="h-5 w-5" />
      </BaseDialog.Close>
    );
  },
);
DialogClose.displayName = "Dialog.Close";

// Header (layout: title + close button row)
export type DialogHeaderTone = "default" | "accent";

const headerToneClasses: Record<DialogHeaderTone, string> = {
  default: "border-surface-600",
  accent: "border-accent-500/20 bg-linear-to-r from-accent-600/12 to-accent-500/5",
};

export interface DialogHeaderProps {
  tone?: DialogHeaderTone;
  className?: string;
  children?: ReactNode;
}

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ tone = "default", className, children }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          "flex items-center justify-between border-b px-6 py-4",
          headerToneClasses[tone],
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

// Shell (the whole frame: root, portal, backdrop, overlay and a title header)
export interface DialogShellProps extends Omit<
  BaseDialog.Popup.Props,
  "className" | "children" | "title"
> {
  open: boolean;
  /** Run when the reader dismisses, whether by the close button, Escape or the backdrop. */
  onClose: () => void;
  title: ReactNode;
  /** A second line under the title, for what the dialog is about. */
  description?: ReactNode;
  size?: DialogOverlaySize;
  tone?: DialogHeaderTone;
  /** Whether the header offers a close button. A dialog mid-task withholds it. */
  closable?: boolean;
  /** Lands on the title itself, for a title that lays an icon out beside its text. */
  titleClassName?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A dialog's frame, from the backdrop down to the title row.
 *
 * `children` are the `Dialog.Body` and `Dialog.Footer` under that header. A
 * dialog whose header is not a title and a close button builds its own frame
 * from the parts instead.
 */
export const DialogShell = forwardRef<HTMLDivElement, DialogShellProps>(
  (
    {
      open,
      onClose,
      title,
      description,
      size,
      tone,
      closable = true,
      titleClassName,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <DialogRoot open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogOverlay ref={ref} size={size} className={className} {...props}>
            <DialogHeader tone={tone}>
              {description === undefined && (
                <DialogTitle className={titleClassName}>{title}</DialogTitle>
              )}
              {description !== undefined && (
                <div className="min-w-0">
                  <DialogTitle className={titleClassName}>{title}</DialogTitle>
                  <DialogDescription className="mt-0.5">{description}</DialogDescription>
                </div>
              )}
              {closable && <DialogClose />}
            </DialogHeader>
            {children}
          </DialogOverlay>
        </DialogPortal>
      </DialogRoot>
    );
  },
);
DialogShell.displayName = "Dialog.Shell";

// Compound export
export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Overlay: DialogOverlay,
  Sheet: DialogSheet,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
  Shell: DialogShell,
};
