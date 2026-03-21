import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Root
export interface SelectRootProps extends BaseSelect.Root.Props<string> {
  children?: ReactNode;
}

export const SelectRoot = ({ children, ...props }: SelectRootProps) => {
  return <BaseSelect.Root<string> {...props}>{children}</BaseSelect.Root>;
};
SelectRoot.displayName = "Select.Root";

// Trigger
export interface SelectTriggerProps extends Omit<BaseSelect.Trigger.Props, "className"> {
  className?: string;
  hasError?: boolean;
  children?: ReactNode;
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, hasError, children, ...props }, ref) => {
    return (
      <BaseSelect.Trigger
        ref={ref}
        className={twMerge(
          "flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-sm transition-colors",
          "bg-surface-700 text-surface-50",
          "border-surface-500 hover:border-surface-400",
          "focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[placeholder]:text-surface-400",
          hasError && "border-red-500 focus:border-red-500 focus:ring-red-500",
          className,
        )}
        {...props}
      >
        {children}
      </BaseSelect.Trigger>
    );
  },
);
SelectTrigger.displayName = "Select.Trigger";

// Value
export interface SelectValueProps extends Omit<BaseSelect.Value.Props, "className" | "children"> {
  className?: string;
  prefix?: string;
  children?: BaseSelect.Value.Props["children"];
}

export const SelectValue = ({ className, prefix, children, ...props }: SelectValueProps) => {
  if (prefix) {
    return (
      <span className={className}>
        <span className="text-surface-400">{prefix} </span>
        <BaseSelect.Value {...props}>{children}</BaseSelect.Value>
      </span>
    );
  }

  return (
    <BaseSelect.Value className={className} {...props}>
      {children}
    </BaseSelect.Value>
  );
};
SelectValue.displayName = "Select.Value";

// Icon
export interface SelectIconProps extends Omit<BaseSelect.Icon.Props, "className"> {
  className?: string;
}

export const SelectIcon = forwardRef<HTMLSpanElement, SelectIconProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseSelect.Icon
        ref={ref}
        className={twMerge(
          "text-surface-400 transition-transform",
          "data-[popup-open]:rotate-180",
          className,
        )}
        {...props}
      >
        <ChevronDown className="h-4 w-4" />
      </BaseSelect.Icon>
    );
  },
);
SelectIcon.displayName = "Select.Icon";

// Portal
export interface SelectPortalProps extends BaseSelect.Portal.Props {
  children?: ReactNode;
}

export const SelectPortal = ({ children, ...props }: SelectPortalProps) => {
  return <BaseSelect.Portal {...props}>{children}</BaseSelect.Portal>;
};
SelectPortal.displayName = "Select.Portal";

// Positioner
export interface SelectPositionerProps extends Omit<BaseSelect.Positioner.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const SelectPositioner = forwardRef<HTMLDivElement, SelectPositionerProps>(
  (
    {
      className,
      children,
      side = "bottom",
      sideOffset = 4,
      alignItemWithTrigger = false,
      ...props
    },
    ref,
  ) => {
    return (
      <BaseSelect.Positioner
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className={twMerge("z-50", className)}
        {...props}
      >
        {children}
      </BaseSelect.Positioner>
    );
  },
);
SelectPositioner.displayName = "Select.Positioner";

// Popup
export interface SelectPopupProps extends Omit<BaseSelect.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const SelectPopup = forwardRef<HTMLDivElement, SelectPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseSelect.Popup
        ref={ref}
        className={twMerge(
          "max-h-60 overflow-y-auto",
          "rounded-lg border border-surface-600 bg-surface-700 py-1 shadow-xl",
          "transition-[opacity,transform] duration-150 ease-out",
          "data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0",
          "data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseSelect.Popup>
    );
  },
);
SelectPopup.displayName = "Select.Popup";

// Item
export interface SelectItemProps extends Omit<BaseSelect.Item.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseSelect.Item
        ref={ref}
        className={twMerge(
          "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-none select-none",
          "text-surface-200 data-[highlighted]:bg-surface-600",
          "data-[disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        <BaseSelect.ItemIndicator className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <Check className="h-3.5 w-3.5" />
        </BaseSelect.ItemIndicator>
        <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      </BaseSelect.Item>
    );
  },
);
SelectItem.displayName = "Select.Item";

// Separator
export interface SelectSeparatorProps extends Omit<BaseSelect.Separator.Props, "className"> {
  className?: string;
}

export const SelectSeparator = forwardRef<HTMLDivElement, SelectSeparatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseSelect.Separator
        ref={ref}
        className={twMerge("my-1 border-t border-surface-600", className)}
        {...props}
      />
    );
  },
);
SelectSeparator.displayName = "Select.Separator";

// Group
export interface SelectGroupProps extends Omit<BaseSelect.Group.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const SelectGroup = forwardRef<HTMLDivElement, SelectGroupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseSelect.Group ref={ref} className={className} {...props}>
        {children}
      </BaseSelect.Group>
    );
  },
);
SelectGroup.displayName = "Select.Group";

// GroupLabel
export interface SelectGroupLabelProps extends Omit<BaseSelect.GroupLabel.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const SelectGroupLabel = forwardRef<HTMLDivElement, SelectGroupLabelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseSelect.GroupLabel
        ref={ref}
        className={twMerge("px-3 py-1.5 text-xs font-medium text-surface-500", className)}
        {...props}
      >
        {children}
      </BaseSelect.GroupLabel>
    );
  },
);
SelectGroupLabel.displayName = "Select.GroupLabel";

// Compound export
export const Select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Icon: SelectIcon,
  Portal: SelectPortal,
  Positioner: SelectPositioner,
  Popup: SelectPopup,
  Item: SelectItem,
  Separator: SelectSeparator,
  Group: SelectGroup,
  GroupLabel: SelectGroupLabel,
};

// --- Simplified SelectField for common use cases ---

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  triggerClassName?: string;
}

export function SelectField({
  label,
  description,
  error,
  required,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  className,
  triggerClassName,
}: SelectFieldProps) {
  // Field layout is imported from FormField module but kept inline here
  // to avoid circular dependency with compound Field exports
  return (
    <div className={twMerge("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-surface-200">
          {label}
          {required && <span className="ml-1 text-red-400">*</span>}
        </label>
      )}
      {description && <p className="text-xs text-surface-400">{description}</p>}
      <SelectRoot
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <SelectTrigger hasError={!!error} className={triggerClassName}>
          <SelectValue />
          <SelectIcon />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </SelectRoot>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
SelectField.displayName = "SelectField";
