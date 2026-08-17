import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Kbd } from "./Kbd";

// Root
export interface ContextMenuRootProps extends BaseContextMenu.Root.Props {
  children?: ReactNode;
}

export const ContextMenuRoot = ({ children, ...props }: ContextMenuRootProps) => {
  return <BaseContextMenu.Root {...props}>{children}</BaseContextMenu.Root>;
};
ContextMenuRoot.displayName = "ContextMenu.Root";

// Trigger
export interface ContextMenuTriggerProps extends Omit<BaseContextMenu.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ContextMenuTrigger = forwardRef<HTMLDivElement, ContextMenuTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseContextMenu.Trigger ref={ref} className={className} {...props}>
        {children}
      </BaseContextMenu.Trigger>
    );
  },
);
ContextMenuTrigger.displayName = "ContextMenu.Trigger";

// Portal
export interface ContextMenuPortalProps extends BaseContextMenu.Portal.Props {
  children?: ReactNode;
}

export const ContextMenuPortal = ({ children, ...props }: ContextMenuPortalProps) => {
  return <BaseContextMenu.Portal {...props}>{children}</BaseContextMenu.Portal>;
};
ContextMenuPortal.displayName = "ContextMenu.Portal";

// Positioner
export interface ContextMenuPositionerProps extends Omit<
  BaseContextMenu.Positioner.Props,
  "className"
> {
  className?: string;
  children?: ReactNode;
}

export const ContextMenuPositioner = forwardRef<HTMLDivElement, ContextMenuPositionerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseContextMenu.Positioner ref={ref} className={twMerge("z-50", className)} {...props}>
        {children}
      </BaseContextMenu.Positioner>
    );
  },
);
ContextMenuPositioner.displayName = "ContextMenu.Positioner";

// Popup
export interface ContextMenuPopupProps extends Omit<BaseContextMenu.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ContextMenuPopup = forwardRef<HTMLDivElement, ContextMenuPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseContextMenu.Popup
        ref={ref}
        className={twMerge(
          "w-44 rounded-lg border border-surface-600 bg-surface-700 py-1 shadow-xl",
          "transition-[opacity,transform] duration-150 ease-out",
          "data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0",
          "data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseContextMenu.Popup>
    );
  },
);
ContextMenuPopup.displayName = "ContextMenu.Popup";

// Item, styled the same as Menu.Item
export type ContextMenuItemVariant = "default" | "danger";

export interface ContextMenuItemProps extends Omit<BaseContextMenu.Item.Props, "className"> {
  icon?: ReactNode;
  shortcut?: string;
  variant?: ContextMenuItemVariant;
  className?: string;
  children?: ReactNode;
}

const itemVariantClasses: Record<ContextMenuItemVariant, string> = {
  default: "text-surface-200 data-[highlighted]:bg-surface-600",
  danger: "text-danger-text data-[highlighted]:bg-surface-600 data-[highlighted]:text-danger",
};

export const ContextMenuItem = forwardRef<HTMLDivElement, ContextMenuItemProps>(
  ({ icon, shortcut, variant = "default", className, children, ...props }, ref) => {
    return (
      <BaseContextMenu.Item
        ref={ref}
        className={twMerge(
          "flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-none select-none",
          itemVariantClasses[variant],
          className,
        )}
        {...props}
      >
        {icon && <span className="h-4 w-4 shrink-0">{icon}</span>}
        <span className="flex-1">{children}</span>
        {shortcut && <Kbd shortcut={shortcut} />}
      </BaseContextMenu.Item>
    );
  },
);
ContextMenuItem.displayName = "ContextMenu.Item";

// Separator
export interface ContextMenuSeparatorProps extends Omit<
  BaseContextMenu.Separator.Props,
  "className"
> {
  className?: string;
}

export const ContextMenuSeparator = forwardRef<HTMLDivElement, ContextMenuSeparatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseContextMenu.Separator
        ref={ref}
        className={twMerge("my-1 border-t border-surface-600", className)}
        {...props}
      />
    );
  },
);
ContextMenuSeparator.displayName = "ContextMenu.Separator";

// Compound export
export const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Portal: ContextMenuPortal,
  Positioner: ContextMenuPositioner,
  Popup: ContextMenuPopup,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};
