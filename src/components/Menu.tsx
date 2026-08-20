import { Menu as BaseMenu } from "@base-ui/react/menu";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Kbd } from "./Kbd";

// Root
export interface MenuRootProps extends BaseMenu.Root.Props {
  children?: ReactNode;
}

export const MenuRoot = ({ children, ...props }: MenuRootProps) => {
  return <BaseMenu.Root {...props}>{children}</BaseMenu.Root>;
};
MenuRoot.displayName = "Menu.Root";

// Trigger
export interface MenuTriggerProps extends Omit<BaseMenu.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const MenuTrigger = forwardRef<HTMLButtonElement, MenuTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseMenu.Trigger ref={ref} className={className} {...props}>
        {children}
      </BaseMenu.Trigger>
    );
  },
);
MenuTrigger.displayName = "Menu.Trigger";

// Portal
export interface MenuPortalProps extends BaseMenu.Portal.Props {
  children?: ReactNode;
}

export const MenuPortal = ({ children, ...props }: MenuPortalProps) => {
  return <BaseMenu.Portal {...props}>{children}</BaseMenu.Portal>;
};
MenuPortal.displayName = "Menu.Portal";

// Positioner
export interface MenuPositionerProps extends Omit<BaseMenu.Positioner.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const MenuPositioner = forwardRef<HTMLDivElement, MenuPositionerProps>(
  ({ className, children, side = "bottom", align = "end", sideOffset = 4, ...props }, ref) => {
    return (
      <BaseMenu.Positioner
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={twMerge("z-50", className)}
        {...props}
      >
        {children}
      </BaseMenu.Positioner>
    );
  },
);
MenuPositioner.displayName = "Menu.Positioner";

// Popup
export interface MenuPopupProps extends Omit<BaseMenu.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const MenuPopup = forwardRef<HTMLDivElement, MenuPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseMenu.Popup
        ref={ref}
        className={twMerge(
          "min-w-40 rounded-xl border border-surface-700 bg-surface-800 p-1 shadow-xl",
          "transition-[opacity,transform] duration-150 ease-out",
          "data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0",
          "data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseMenu.Popup>
    );
  },
);
MenuPopup.displayName = "Menu.Popup";

// Item
export type MenuItemVariant = "default" | "danger";

export interface MenuItemProps extends Omit<BaseMenu.Item.Props, "className"> {
  icon?: ReactNode;
  shortcut?: string;
  variant?: MenuItemVariant;
  className?: string;
  children?: ReactNode;
}

const itemVariantClasses: Record<MenuItemVariant, string> = {
  default: "text-surface-200 data-[highlighted]:bg-surface-veil data-[highlighted]:text-surface-50",
  /* The highlight is a fill because the label is already at its own shade: DS-TEXT. */
  danger: "text-danger-text data-[highlighted]:bg-danger/15",
};

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(
  ({ icon, shortcut, variant = "default", className, children, ...props }, ref) => {
    return (
      <BaseMenu.Item
        ref={ref}
        className={twMerge(
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm outline-none select-none",
          // Base UI stops a disabled item responding but leaves it looking
          // identical to a live one, so it needs its own resting color.
          "data-[disabled]:cursor-not-allowed data-[disabled]:text-surface-400",
          itemVariantClasses[variant],
          className,
        )}
        {...props}
      >
        {icon && <span className="h-4 w-4 shrink-0 opacity-70">{icon}</span>}
        <span className="flex-1">{children}</span>
        {shortcut && <Kbd shortcut={shortcut} />}
      </BaseMenu.Item>
    );
  },
);
MenuItem.displayName = "Menu.Item";

// Separator
export interface MenuSeparatorProps extends Omit<BaseMenu.Separator.Props, "className"> {
  className?: string;
}

export const MenuSeparator = forwardRef<HTMLDivElement, MenuSeparatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseMenu.Separator
        ref={ref}
        className={twMerge("-mx-1 my-1 border-t border-surface-700", className)}
        {...props}
      />
    );
  },
);
MenuSeparator.displayName = "Menu.Separator";

// Group
export interface MenuGroupProps extends Omit<BaseMenu.Group.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const MenuGroup = forwardRef<HTMLDivElement, MenuGroupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseMenu.Group ref={ref} className={className} {...props}>
        {children}
      </BaseMenu.Group>
    );
  },
);
MenuGroup.displayName = "Menu.Group";

// GroupLabel
export interface MenuGroupLabelProps extends Omit<BaseMenu.GroupLabel.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const MenuGroupLabel = forwardRef<HTMLDivElement, MenuGroupLabelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseMenu.GroupLabel
        ref={ref}
        className={twMerge(
          "px-2 py-1 text-[11px] font-medium tracking-wide text-surface-400 uppercase",
          className,
        )}
        {...props}
      >
        {children}
      </BaseMenu.GroupLabel>
    );
  },
);
MenuGroupLabel.displayName = "Menu.GroupLabel";

// Compound export
export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Portal: MenuPortal,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
};
